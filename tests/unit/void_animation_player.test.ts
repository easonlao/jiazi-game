/**
 * 空亡动画编排器（createVoidAnimationPlayer）单元测试——P1-1 防回归 + 掷骰 + K 步倒数
 * + 队列连播时间线（票 08 / 票 01 重构）。
 *
 * 项目无组件测试基建（无 jsdom/@testing-library/react-test-renderer，vitest 仅 include
 * tests 目录下的 *.test.ts），且「不新增依赖」约束下不引入 React 渲染测试；本测试直接对
 * 编排器复现 StrictMode 的 effect 生命周期（setup→cleanup→setup）：
 * 修复前 cleanup 不清消费锚点 → 二次 start 被去重跳过、定时器不再重排 → 覆盖层永久卡住。
 * 修复后 cancel() 清定时器 + 锚点归零 + 清残留队列 → 二次 start 重新调度 → 动画正常播完。
 *
 * 票 01 时间线：reveal → swallow → dice（1.2s 掷骰）→ step×（K+1 帧，起点帧 + K 步，
 * 剩余从 K 递减到 0）→ zero → finale → end。多张连触逐张接播（当前张收尾后自动开始下一张
 * 的现世/掷骰），全部播完才触发一次最终 onEnd。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createVoidAnimationPlayer,
  VOID_REVEAL_MS,
  VOID_SWALLOW_MS,
  VOID_DICE_MS,
  VOID_STEP_MS,
  VOID_HOLD_MS,
  VOID_FINALE_MS,
  voidTotalMs,
} from '../../app/src/lib/voidAnimationPlayer';
import { buildVoidCountdown } from '../../app/src/lib/voidSeasonScroll';
import { useGameStore } from '../../app/src/store';
import type { FxVoidTriggerEvent } from '../../app/src/store/fx-events';

/**
 * 构造带完整 path 的触发事件：从 (season, start) 逐回合推进 k 步，季长 length 换季
 * （季节轮 spring→summer→autumn→winter，与引擎 SeasonCycle 一致）。
 * prevSeason/prevRoundInSeason = 触发前位置（票 01 起点帧数据源）。
 */
function makeEvent(id: number, k: number, start = 3, season = 'summer', length = 7): FxVoidTriggerEvent {
  const order = ['spring', 'summer', 'autumn', 'winter'];
  let s = season;
  let r = start;
  const path: { season: string; roundInSeason: number }[] = [];
  for (let i = 0; i < k; i++) {
    r++;
    if (r > length) {
      r = 1;
      s = order[(order.indexOf(s) + 1) % 4]!;
    }
    path.push({ season: s, roundInSeason: r });
  }
  return { id, k, prevSeason: season, prevRoundInSeason: start, nextSeason: path[path.length - 1]!.season, path };
}

describe('createVoidAnimationPlayer（票 08 编排 / 票 01 掷骰+队列 / P1-1 StrictMode 语义）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useGameStore.setState({
      gameState: 'player_action',
      _voidAnimationTrueState: null,
      turnManager: null,
      voidTriggerQueue: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('StrictMode：setup→cleanup→setup 后二次 start 重新调度，动画播完且 gameState 恢复', () => {
    const player = createVoidAnimationPlayer({
      onReveal: () => useGameStore.getState().beginVoidRoundAnimation(),
      onSwallow: () => {}, onDiceStart: () => {}, onStep: () => {}, onZero: () => {}, onFinale: () => {},
      onEnd: () => useGameStore.getState().endVoidRoundAnimation(),
    });
    const evt = makeEvent(1, 2);

    // StrictMode 按「全 setup → 全 cleanup → 全 setup」重放两个 effect：
    //   setup(A 动画) → setup(B 兜底) → cleanup(A cancel) → cleanup(B end) → setup(A) → setup(B)
    // 第一次 setup：消费并调度，gameState 覆盖为 void_round
    expect(player.start(evt)).toBe(true);
    expect(useGameStore.getState().gameState).toBe('void_round');

    // cleanup(A)：动画 effect 的 cleanup —— 清定时器 + 消费锚点归零 + 清残留队列（P1-1 修复点）
    player.cancel();
    // cleanup(B)：`[]` 兜底 effect 的 cleanup —— 恢复 gameState（不得残留）
    useGameStore.getState().endVoidRoundAnimation();
    expect(useGameStore.getState().gameState).toBe('player_action');

    // 第二次 setup：必须重新消费（回归点——修复前被去重跳过，覆盖层永久卡住）
    expect(player.start(evt)).toBe(true);
    expect(useGameStore.getState().gameState).toBe('void_round');

    // 推进到动画结束：总时长 = voidTotalMs(K+1 帧)（K=2 → 3 帧）
    vi.advanceTimersByTime(voidTotalMs(3));
    expect(useGameStore.getState().gameState).toBe('player_action');
    expect(useGameStore.getState()._voidAnimationTrueState).toBeNull();

    // 同一事件消费后去重
    expect(player.start(evt)).toBe(false);
  });

  it('同一 id 去重：start 只调度一次，onEnd 只触发一次', () => {
    let ends = 0;
    const player = createVoidAnimationPlayer({
      onReveal: () => {}, onSwallow: () => {}, onDiceStart: () => {}, onStep: () => {}, onZero: () => {}, onFinale: () => {},
      onEnd: () => { ends++; },
    });
    const evt = makeEvent(7, 1);
    expect(player.start(evt)).toBe(true);
    expect(player.start(evt)).toBe(false);
    vi.advanceTimersByTime(voidTotalMs(2) + 100); // K=1 → 2 帧
    expect(ends).toBe(1);
    expect(player.start(evt)).toBe(false); // 结束后仍去重
  });

  it('时间线：reveal → swallow → dice → step×（K+1 帧）→ zero → finale → end', () => {
    const seq: string[] = [];
    const steps: number[] = [];
    const player = createVoidAnimationPlayer({
      onReveal: () => seq.push('reveal'),
      onSwallow: () => seq.push('swallow'),
      onDiceStart: () => seq.push('dice'),
      onStep: (index) => { seq.push(`step${index}`); steps.push(index); },
      onZero: () => seq.push('zero'),
      onFinale: () => seq.push('finale'),
      onEnd: () => seq.push('end'),
    });
    const k = 4;
    player.start(makeEvent(3, k));
    vi.advanceTimersByTime(voidTotalMs(k + 1) + 10);
    // 帧数 = K+1（起点帧 + K 步推进）：onStep 索引 0..k 逐一触发
    expect(seq).toEqual(['reveal', 'swallow', 'dice', 'step0', 'step1', 'step2', 'step3', 'step4', 'zero', 'finale', 'end']);
    expect(steps).toEqual([0, 1, 2, 3, 4]);
    expect(steps).toHaveLength(k + 1);
  });

  it('掷骰阶段：onDiceStart 在吞噬后开启，整段 VOID_DICE_MS 轮转后才进入倒数', () => {
    const seq: string[] = [];
    const player = createVoidAnimationPlayer({
      onReveal: () => seq.push('reveal'),
      onSwallow: () => seq.push('swallow'),
      onDiceStart: () => seq.push('dice'),
      onStep: () => seq.push('step'),
      onZero: () => seq.push('zero'),
      onFinale: () => seq.push('finale'),
      onEnd: () => seq.push('end'),
    });
    const k = 1;
    player.start(makeEvent(21, k));
    vi.advanceTimersByTime(VOID_REVEAL_MS + VOID_SWALLOW_MS);
    expect(seq).toEqual(['reveal', 'swallow', 'dice']);
    // 掷骰整段 VOID_DICE_MS 内不进入倒数（数字轮转由展示层渲染，编排器只把控时长）
    vi.advanceTimersByTime(VOID_DICE_MS - 1);
    expect(seq).toEqual(['reveal', 'swallow', 'dice']);
    vi.advanceTimersByTime(1);
    expect(seq).toEqual(['reveal', 'swallow', 'dice', 'step']);
  });

  it('时间线边界：各阶段在各自时长常量处精确切换（含掷骰）', () => {
    const seq: string[] = [];
    const player = createVoidAnimationPlayer({
      onReveal: () => seq.push('reveal'),
      onSwallow: () => seq.push('swallow'),
      onDiceStart: () => seq.push('dice'),
      onStep: () => seq.push('step'),
      onZero: () => seq.push('zero'),
      onFinale: () => seq.push('finale'),
      onEnd: () => seq.push('end'),
    });
    const k = 2;
    const evt = makeEvent(9, k);
    player.start(evt);
    // reveal 之后、swallow 之前（边界前 1ms）
    vi.advanceTimersByTime(VOID_REVEAL_MS - 1);
    expect(seq).toEqual(['reveal']);
    vi.advanceTimersByTime(1);
    expect(seq).toEqual(['reveal', 'swallow']);
    vi.advanceTimersByTime(VOID_SWALLOW_MS - 1);
    expect(seq).toEqual(['reveal', 'swallow']);
    // 掷骰开启
    vi.advanceTimersByTime(1);
    expect(seq).toEqual(['reveal', 'swallow', 'dice']);
    vi.advanceTimersByTime(VOID_DICE_MS - 1);
    expect(seq).toEqual(['reveal', 'swallow', 'dice']);
    // 倒数开始：每帧 VOID_STEP_MS，帧数 = K+1 = 3
    vi.advanceTimersByTime(1);
    expect(seq).toEqual(['reveal', 'swallow', 'dice', 'step']);
    vi.advanceTimersByTime(VOID_STEP_MS - 1);
    expect(seq).toEqual(['reveal', 'swallow', 'dice', 'step']);
    vi.advanceTimersByTime(1);
    expect(seq).toEqual(['reveal', 'swallow', 'dice', 'step', 'step']);
    vi.advanceTimersByTime(VOID_STEP_MS);
    expect(seq).toEqual(['reveal', 'swallow', 'dice', 'step', 'step', 'step']);
    // 归零停留 VOID_HOLD_MS：zero 在最后一帧后立即触发，finale 在停留结束时
    vi.advanceTimersByTime(VOID_STEP_MS);
    expect(seq).toEqual(['reveal', 'swallow', 'dice', 'step', 'step', 'step', 'zero']);
    vi.advanceTimersByTime(VOID_HOLD_MS - 1);
    expect(seq).toEqual(['reveal', 'swallow', 'dice', 'step', 'step', 'step', 'zero']);
    vi.advanceTimersByTime(1);
    expect(seq).toEqual(['reveal', 'swallow', 'dice', 'step', 'step', 'step', 'zero', 'finale']);
    vi.advanceTimersByTime(VOID_FINALE_MS);
    expect(seq).toEqual(['reveal', 'swallow', 'dice', 'step', 'step', 'step', 'zero', 'finale', 'end']);
  });

  it('每帧展示的 remaining 从 k 递减到 0（含起点帧），位置逐回合递增', () => {
    const k = 4;
    const evt = makeEvent(11, k, 4, 'summer', 7); // 夏4 起：起点帧 夏4 rem4 → 夏5…夏7 → 秋1 rem0
    const seq = buildVoidCountdown(evt.path, evt.k, evt.prevSeason, evt.prevRoundInSeason);
    // 票 01：起点帧（触发前位置 + 剩余 K）在 path 前插入，剩余递减到 0
    expect(seq.map((s) => s.remaining)).toEqual([4, 3, 2, 1, 0]);
    expect(seq.map((s) => `${s.season}${s.roundInSeason}`)).toEqual(['summer4', 'summer5', 'summer6', 'summer7', 'autumn1']);

    const got: number[] = [];
    const player = createVoidAnimationPlayer({
      onReveal: () => {}, onSwallow: () => {}, onDiceStart: () => {}, onStep: (i) => got.push(i), onZero: () => {}, onFinale: () => {}, onEnd: () => {},
    });
    player.start(evt);
    vi.advanceTimersByTime(voidTotalMs(k + 1) + 10);
    expect(got).toEqual([0, 1, 2, 3, 4]);
    // onStep(index) 显示第 index 帧：index=0 为起点帧（触发前位置 + 剩余 K），
    // index>=1 对应 path[index-1]（剩余 = k - index）
    got.forEach((index) => {
      const step = seq[index]!;
      expect(step.remaining).toBe(k - index);
      if (index === 0) {
        expect(step.season).toBe(evt.prevSeason);
        expect(step.roundInSeason).toBe(evt.prevRoundInSeason);
      } else {
        expect(step.season).toBe(evt.path[index - 1]!.season);
        expect(step.roundInSeason).toBe(evt.path[index - 1]!.roundInSeason);
      }
    });
  });

  it('总时长随 K 线性增长：K=2 与 K=8（帧数 = K+1）结束点不同（差 = 6×单帧）', () => {
    // 帧数 = K+1：K=2 → 3 帧；K=8 → 9 帧
    expect(voidTotalMs(3)).toBe(VOID_REVEAL_MS + VOID_SWALLOW_MS + VOID_DICE_MS + 3 * VOID_STEP_MS + VOID_HOLD_MS + VOID_FINALE_MS);
    expect(voidTotalMs(3)).toBe(5540);
    expect(voidTotalMs(9)).toBe(7820);
    expect(voidTotalMs(9) - voidTotalMs(3)).toBe(6 * VOID_STEP_MS);

    let ends1 = 0;
    const p1 = createVoidAnimationPlayer({
      onReveal: () => {}, onSwallow: () => {}, onDiceStart: () => {}, onStep: () => {}, onZero: () => {}, onFinale: () => {}, onEnd: () => { ends1++; },
    });
    p1.start(makeEvent(1, 2));
    vi.advanceTimersByTime(voidTotalMs(3) - 1);
    expect(ends1).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ends1).toBe(1);

    let ends2 = 0;
    const p2 = createVoidAnimationPlayer({
      onReveal: () => {}, onSwallow: () => {}, onDiceStart: () => {}, onStep: () => {}, onZero: () => {}, onFinale: () => {}, onEnd: () => { ends2++; },
    });
    p2.start(makeEvent(2, 8));
    vi.advanceTimersByTime(voidTotalMs(9) - 1);
    expect(ends2).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ends2).toBe(1);
  });

  it('cancel 清定时器：cancel 后不再触发任何阶段回调（只保留同步 onReveal）', () => {
    let calls = 0;
    const player = createVoidAnimationPlayer({
      onReveal: () => calls++,
      onSwallow: () => calls++,
      onDiceStart: () => calls++,
      onStep: () => calls++,
      onZero: () => calls++,
      onFinale: () => calls++,
      onEnd: () => calls++,
    });
    player.start(makeEvent(5, 5));
    player.cancel();
    vi.advanceTimersByTime(10 * voidTotalMs(6));
    expect(calls).toBe(1); // 只有 onReveal
  });

  it('新事件覆盖旧动画：start 新 id 清掉旧定时器，各阶段回调不重复', () => {
    const phases: string[] = [];
    const player = createVoidAnimationPlayer({
      onReveal: () => phases.push('reveal'),
      onSwallow: () => phases.push('swallow'),
      onDiceStart: () => phases.push('dice'),
      onStep: () => phases.push('step'),
      onZero: () => phases.push('zero'),
      onFinale: () => phases.push('finale'),
      onEnd: () => phases.push('end'),
    });
    player.start(makeEvent(1, 4));
    player.start(makeEvent(2, 1));
    vi.advanceTimersByTime(voidTotalMs(2) + 100); // K=1 → 2 帧
    // 旧动画（id=1）定时器已被清：除两次 start 各自同步的 onReveal 外，
    // 各阶段回调只按新动画（K=1，2 帧）时间线触发一次
    expect(phases).toEqual(['reveal', 'reveal', 'swallow', 'dice', 'step', 'step', 'zero', 'finale', 'end']);
  });

  it('队列连播：第一张完整播完（含收尾）自动接播第二张（第二张同样掷骰），全部播完才最终 onEnd 一次', () => {
    const seq: string[] = [];
    let ends = 0;
    const player = createVoidAnimationPlayer({
      onReveal: (evt) => seq.push(`reveal-${evt.id}`),
      onSwallow: () => seq.push('swallow'),
      onDiceStart: () => seq.push('dice'),
      onStep: () => seq.push('step'),
      onZero: () => seq.push('zero'),
      onFinale: () => seq.push('finale'),
      onEnd: () => { seq.push('end'); ends++; },
    });
    const evt1 = makeEvent(1, 2); // K=2 → 3 帧
    const evt2 = makeEvent(2, 1); // K=1 → 2 帧
    expect(player.start([evt1, evt2])).toBe(true);

    // 第一张完整播完（含收尾）→ 第二张自动接播（同样掷骰）→ 全部播完最终 onEnd
    vi.advanceTimersByTime(voidTotalMs(3) + voidTotalMs(2) + 10);
    expect(seq).toEqual([
      'reveal-1', 'swallow', 'dice', 'step', 'step', 'step', 'zero', 'finale',
      'reveal-2', 'swallow', 'dice', 'step', 'step', 'zero', 'finale',
      'end',
    ]);
    expect(ends).toBe(1);
  });

  it('队列连播的中间时间点：第一张收尾结束前不触发第二张 reveal', () => {
    const seq: string[] = [];
    const player = createVoidAnimationPlayer({
      onReveal: (evt) => seq.push(`reveal-${evt.id}`),
      onSwallow: () => {}, onDiceStart: () => {}, onStep: () => {}, onZero: () => {}, onFinale: () => {}, onEnd: () => seq.push('end'),
    });
    player.start([makeEvent(1, 1), makeEvent(2, 1)]);
    // 第一张 K=1（2 帧）总时长 = voidTotalMs(2)；收尾结束前一毫秒，第二张未开始
    vi.advanceTimersByTime(voidTotalMs(2) - 1);
    expect(seq).toEqual(['reveal-1']);
    // 第一张收尾结束：第二张现世自动开始
    vi.advanceTimersByTime(1);
    expect(seq).toEqual(['reveal-1', 'reveal-2']);
  });

  it('StrictMode + 队列：cancel 清残留队列，二次 start 同一队列可重新完整消费', () => {
    const reveals: number[] = [];
    const player = createVoidAnimationPlayer({
      onReveal: (evt) => reveals.push(evt.id),
      onSwallow: () => {}, onDiceStart: () => {}, onStep: () => {}, onZero: () => {}, onFinale: () => {}, onEnd: () => {},
    });
    const events = [makeEvent(1, 2), makeEvent(2, 1)];
    expect(player.start(events)).toBe(true);
    expect(reveals).toEqual([1]); // 只播第一张
    player.cancel(); // 清定时器 + 锚点归零 + 清残留队列
    expect(player.start(events)).toBe(true); // 二次 setup 重新完整消费（含两张）
    expect(reveals).toEqual([1, 1]);
    vi.advanceTimersByTime(voidTotalMs(3) + voidTotalMs(2) + 10);
    // 两张都播完（第二张 reveal 也已触发）
    expect(reveals).toEqual([1, 1, 2]);
  });
});
