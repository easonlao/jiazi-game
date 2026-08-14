/**
 * 空亡动画编排器（createVoidAnimationPlayer）单元测试——P1-1 防回归 + K 步倒数时间线。
 *
 * 项目无组件测试基建（无 jsdom/@testing-library/react-test-renderer，vitest 仅 include
 * tests 目录下的 *.test.ts），且「不新增依赖」约束下不引入 React 渲染测试；本测试直接对
 * 编排器复现 StrictMode 的 effect 生命周期（setup→cleanup→setup）：
 * 修复前 cleanup 不清消费锚点 → 二次 start 被去重跳过、定时器不再重排 → 覆盖层永久卡住。
 * 修复后 cancel() 清定时器 + 锚点归零 → 二次 start 重新调度 → 动画正常播完并恢复 gameState。
 *
 * 2026-08-14 重构：时间线由「季节快进字幕 / 跳转最终季」改为 **K 步数字倒数**——
 * 每步固定时长 VOID_STEP_MS，步数 = 引擎 path 长度 = K；onStep(index) 逐步触发，
 * 归零停留 VOID_HOLD_MS 后收尾。总时长随 K 线性增长（不再固定 4.1s）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createVoidAnimationPlayer,
  VOID_REVEAL_MS,
  VOID_SWALLOW_MS,
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
  return { id, k, prevSeason: season, nextSeason: path[path.length - 1]!.season, path };
}

describe('createVoidAnimationPlayer（票 08 编排 / P1-1 StrictMode 语义）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useGameStore.setState({
      gameState: 'player_action',
      _voidAnimationTrueState: null,
      turnManager: null,
      voidTriggerEvent: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('StrictMode：setup→cleanup→setup 后二次 start 重新调度，动画播完且 gameState 恢复', () => {
    const player = createVoidAnimationPlayer({
      onReveal: () => useGameStore.getState().beginVoidRoundAnimation(),
      onSwallow: () => {},
      onStep: () => {},
      onZero: () => {},
      onFinale: () => {},
      onEnd: () => useGameStore.getState().endVoidRoundAnimation(),
    });
    const evt = makeEvent(1, 2);

    // StrictMode 按「全 setup → 全 cleanup → 全 setup」重放两个 effect：
    //   setup(A 动画) → setup(B 兜底) → cleanup(A cancel) → cleanup(B end) → setup(A) → setup(B)
    // 第一次 setup：消费并调度，gameState 覆盖为 void_round
    expect(player.start(evt)).toBe(true);
    expect(useGameStore.getState().gameState).toBe('void_round');

    // cleanup(A)：动画 effect 的 cleanup —— 清定时器 + 消费锚点归零（P1-1 修复点）
    player.cancel();
    // cleanup(B)：`[]` 兜底 effect 的 cleanup —— 恢复 gameState（不得残留）
    useGameStore.getState().endVoidRoundAnimation();
    expect(useGameStore.getState().gameState).toBe('player_action');

    // 第二次 setup：必须重新消费（回归点——修复前被去重跳过，覆盖层永久卡住）
    expect(player.start(evt)).toBe(true);
    expect(useGameStore.getState().gameState).toBe('void_round');

    // 推进到动画结束：总时长随 K 变化（K=2 → voidTotalMs(2)）
    vi.advanceTimersByTime(voidTotalMs(2));
    expect(useGameStore.getState().gameState).toBe('player_action');
    expect(useGameStore.getState()._voidAnimationTrueState).toBeNull();

    // 同一事件消费后去重
    expect(player.start(evt)).toBe(false);
  });

  it('同一 id 去重：start 只调度一次，onEnd 只触发一次', () => {
    let ends = 0;
    const player = createVoidAnimationPlayer({
      onReveal: () => {}, onSwallow: () => {}, onStep: () => {}, onZero: () => {}, onFinale: () => {}, onEnd: () => { ends++; },
    });
    const evt = makeEvent(7, 1);
    expect(player.start(evt)).toBe(true);
    expect(player.start(evt)).toBe(false);
    vi.advanceTimersByTime(voidTotalMs(1) + 100);
    expect(ends).toBe(1);
    expect(player.start(evt)).toBe(false); // 结束后仍去重
  });

  it('时间线：reveal → swallow → step×k（步数 = path.length = k）→ zero → finale → end', () => {
    const seq: string[] = [];
    const steps: number[] = [];
    const player = createVoidAnimationPlayer({
      onReveal: () => seq.push('reveal'),
      onSwallow: () => seq.push('swallow'),
      onStep: (index) => { seq.push(`step${index}`); steps.push(index); },
      onZero: () => seq.push('zero'),
      onFinale: () => seq.push('finale'),
      onEnd: () => seq.push('end'),
    });
    const k = 4;
    player.start(makeEvent(3, k));
    vi.advanceTimersByTime(voidTotalMs(k) + 10);
    expect(seq).toEqual(['reveal', 'swallow', 'step0', 'step1', 'step2', 'step3', 'zero', 'finale', 'end']);
    // 步数 = 引擎 path 长度 = k（onStep 索引 0..k-1 逐一触发）
    expect(steps).toEqual([0, 1, 2, 3]);
    expect(steps).toHaveLength(k);
  });

  it('时间线边界：各阶段在各自时长常量处精确切换', () => {
    const seq: string[] = [];
    const player = createVoidAnimationPlayer({
      onReveal: () => seq.push('reveal'),
      onSwallow: () => seq.push('swallow'),
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
    // 倒数开始：每步 VOID_STEP_MS
    vi.advanceTimersByTime(1);
    expect(seq).toEqual(['reveal', 'swallow', 'step']);
    vi.advanceTimersByTime(VOID_STEP_MS - 1);
    expect(seq).toEqual(['reveal', 'swallow', 'step']);
    vi.advanceTimersByTime(1);
    expect(seq).toEqual(['reveal', 'swallow', 'step', 'step']);
    // 归零停留 VOID_HOLD_MS：zero 在最后一步后立即触发，finale 在停留结束时
    vi.advanceTimersByTime(VOID_STEP_MS);
    expect(seq).toEqual(['reveal', 'swallow', 'step', 'step', 'zero']);
    vi.advanceTimersByTime(VOID_HOLD_MS - 1);
    expect(seq).toEqual(['reveal', 'swallow', 'step', 'step', 'zero']);
    vi.advanceTimersByTime(1);
    expect(seq).toEqual(['reveal', 'swallow', 'step', 'step', 'zero', 'finale']);
    vi.advanceTimersByTime(VOID_FINALE_MS);
    expect(seq).toEqual(['reveal', 'swallow', 'step', 'step', 'zero', 'finale', 'end']);
  });

  it('每步展示的 remaining 从 k 递减到 1（与 buildVoidCountdown 序列一致），位置逐回合递增', () => {
    const k = 4;
    const evt = makeEvent(11, k, 4, 'summer', 7); // 夏4 起：夏5→夏6→夏7→秋1（跨季）
    const seq = buildVoidCountdown(evt.path, evt.k);
    expect(seq.map((s) => s.remaining)).toEqual([4, 3, 2, 1]);
    expect(seq.map((s) => `${s.season}${s.roundInSeason}`)).toEqual(['summer5', 'summer6', 'summer7', 'autumn1']);

    const got: number[] = [];
    const player = createVoidAnimationPlayer({
      onReveal: () => {}, onSwallow: () => {}, onStep: (i) => got.push(i), onZero: () => {}, onFinale: () => {}, onEnd: () => {},
    });
    player.start(evt);
    vi.advanceTimersByTime(voidTotalMs(k) + 10);
    expect(got).toEqual([0, 1, 2, 3]);
    // onStep(index) 显示第 index 步：remaining = k - index，位置 = path[index]
    got.forEach((index) => {
      expect(seq[index]!.remaining).toBe(k - index);
      expect(seq[index]!.season).toBe(evt.path[index]!.season);
      expect(seq[index]!.roundInSeason).toBe(evt.path[index]!.roundInSeason);
    });
  });

  it('总时长随 K 线性增长：K=2 与 K=12 结束点不同（K=12 = K=2 + 10×单步）', () => {
    expect(voidTotalMs(2)).toBe(VOID_REVEAL_MS + VOID_SWALLOW_MS + 2 * VOID_STEP_MS + VOID_HOLD_MS + VOID_FINALE_MS);
    expect(voidTotalMs(2)).toBe(3960);
    expect(voidTotalMs(12)).toBe(7760);
    expect(voidTotalMs(12) - voidTotalMs(2)).toBe(10 * VOID_STEP_MS);

    let ends1 = 0;
    const p1 = createVoidAnimationPlayer({
      onReveal: () => {}, onSwallow: () => {}, onStep: () => {}, onZero: () => {}, onFinale: () => {}, onEnd: () => { ends1++; },
    });
    p1.start(makeEvent(1, 2));
    vi.advanceTimersByTime(voidTotalMs(2) - 1);
    expect(ends1).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ends1).toBe(1);

    let ends2 = 0;
    const p2 = createVoidAnimationPlayer({
      onReveal: () => {}, onSwallow: () => {}, onStep: () => {}, onZero: () => {}, onFinale: () => {}, onEnd: () => { ends2++; },
    });
    p2.start(makeEvent(2, 12));
    vi.advanceTimersByTime(voidTotalMs(12) - 1);
    expect(ends2).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ends2).toBe(1);
  });

  it('cancel 清定时器：cancel 后不再触发任何阶段回调（只保留同步 onReveal）', () => {
    let calls = 0;
    const player = createVoidAnimationPlayer({
      onReveal: () => calls++,
      onSwallow: () => calls++,
      onStep: () => calls++,
      onZero: () => calls++,
      onFinale: () => calls++,
      onEnd: () => calls++,
    });
    player.start(makeEvent(5, 5));
    player.cancel();
    vi.advanceTimersByTime(10 * voidTotalMs(5));
    expect(calls).toBe(1); // 只有 onReveal
  });

  it('新事件覆盖旧动画：start 新 id 清掉旧定时器，各阶段回调不重复', () => {
    const phases: string[] = [];
    const player = createVoidAnimationPlayer({
      onReveal: () => phases.push('reveal'),
      onSwallow: () => phases.push('swallow'),
      onStep: () => phases.push('step'),
      onZero: () => phases.push('zero'),
      onFinale: () => phases.push('finale'),
      onEnd: () => phases.push('end'),
    });
    player.start(makeEvent(1, 4));
    player.start(makeEvent(2, 1));
    vi.advanceTimersByTime(voidTotalMs(1) + 100);
    // 旧动画（id=1）定时器已被清：除两次 start 各自同步的 onReveal 外，
    // 各阶段回调只按新动画（K=1）时间线触发一次
    expect(phases).toEqual(['reveal', 'reveal', 'swallow', 'step', 'zero', 'finale', 'end']);
  });
});
