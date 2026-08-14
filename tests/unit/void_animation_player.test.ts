/**
 * 空亡动画编排器（createVoidAnimationPlayer）单元测试——P1-1 防回归 + 四阶段时间线。
 *
 * 项目无组件测试基建（无 jsdom/@testing-library/react-test-renderer，vitest 仅 include
 * tests 目录下的 *.test.ts），且「不新增依赖」约束下不引入 React 渲染测试；本测试直接对
 * 编排器复现 StrictMode 的 effect 生命周期（setup→cleanup→setup）：
 * 修复前 cleanup 不清消费锚点 → 二次 start 被去重跳过、定时器不再重排 → 覆盖层永久卡住。
 * 修复后 cancel() 清定时器 + 锚点归零 → 二次 start 重新调度 → 动画正常播完并恢复 gameState。
 *
 * 2026-08-14 重构：时间线由「K 张字幕卡轮播 + 收尾」改为固定四阶段
 * （空亡牌展示 → 吞噬 → 跳转最终季 → 收尾），总时长恒定，不随 K 变化。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createVoidAnimationPlayer,
  VOID_REVEAL_MS,
  VOID_SWALLOW_MS,
  VOID_JUMP_MS,
  VOID_FINALE_MS,
  VOID_TOTAL_MS,
} from '../../app/src/lib/voidAnimationPlayer';
import { useGameStore } from '../../app/src/store';

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
      onJump: () => {},
      onFinale: () => {},
      onEnd: () => useGameStore.getState().endVoidRoundAnimation(),
    });
    const evt = { id: 1, k: 2, prevSeason: 'spring', nextSeason: 'autumn' };

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

    // 推进到动画结束：总时长固定（VOID_TOTAL_MS），与 K 无关
    vi.advanceTimersByTime(VOID_TOTAL_MS);
    expect(useGameStore.getState().gameState).toBe('player_action');
    expect(useGameStore.getState()._voidAnimationTrueState).toBeNull();

    // 同一事件消费后去重
    expect(player.start(evt)).toBe(false);
  });

  it('同一 id 去重：start 只调度一次，onEnd 只触发一次', () => {
    let ends = 0;
    const player = createVoidAnimationPlayer({
      onReveal: () => {}, onSwallow: () => {}, onJump: () => {}, onFinale: () => {}, onEnd: () => { ends++; },
    });
    const evt = { id: 7, k: 1, prevSeason: 'spring', nextSeason: 'summer' };
    expect(player.start(evt)).toBe(true);
    expect(player.start(evt)).toBe(false);
    vi.advanceTimersByTime(VOID_TOTAL_MS + 100);
    expect(ends).toBe(1);
    expect(player.start(evt)).toBe(false); // 结束后仍去重
  });

  it('时间线：四阶段按序 reveal → swallow → jump → finale → end', () => {
    const seq: string[] = [];
    const player = createVoidAnimationPlayer({
      onReveal: () => seq.push('reveal'),
      onSwallow: () => seq.push('swallow'),
      onJump: () => seq.push('jump'),
      onFinale: () => seq.push('finale'),
      onEnd: () => seq.push('end'),
    });
    player.start({ id: 3, k: 3, prevSeason: 'spring', nextSeason: 'winter' });
    vi.advanceTimersByTime(VOID_TOTAL_MS + 10);
    expect(seq).toEqual(['reveal', 'swallow', 'jump', 'finale', 'end']);
  });

  it('时间线边界：各阶段在各自时长常量处精确切换', () => {
    const seq: string[] = [];
    const player = createVoidAnimationPlayer({
      onReveal: () => seq.push('reveal'),
      onSwallow: () => seq.push('swallow'),
      onJump: () => seq.push('jump'),
      onFinale: () => seq.push('finale'),
      onEnd: () => seq.push('end'),
    });
    player.start({ id: 9, k: 8, prevSeason: 'autumn', nextSeason: 'winter' });
    // reveal 之后、swallow 之前（边界前 1ms）
    vi.advanceTimersByTime(VOID_REVEAL_MS - 1);
    expect(seq).toEqual(['reveal']);
    vi.advanceTimersByTime(1);
    expect(seq).toEqual(['reveal', 'swallow']);
    vi.advanceTimersByTime(VOID_SWALLOW_MS - 1);
    expect(seq).toEqual(['reveal', 'swallow']);
    vi.advanceTimersByTime(1);
    expect(seq).toEqual(['reveal', 'swallow', 'jump']);
    vi.advanceTimersByTime(VOID_JUMP_MS - 1);
    expect(seq).toEqual(['reveal', 'swallow', 'jump']);
    vi.advanceTimersByTime(1);
    expect(seq).toEqual(['reveal', 'swallow', 'jump', 'finale']);
    vi.advanceTimersByTime(VOID_FINALE_MS);
    expect(seq).toEqual(['reveal', 'swallow', 'jump', 'finale', 'end']);
  });

  it('总时长固定：K 不改变时间线（K=2 与 K=12 结束点相同，均为 VOID_TOTAL_MS）', () => {
    expect(VOID_TOTAL_MS).toBe(VOID_REVEAL_MS + VOID_SWALLOW_MS + VOID_JUMP_MS + VOID_FINALE_MS);
    expect(VOID_TOTAL_MS).toBe(4100);

    let ends1 = 0;
    const p1 = createVoidAnimationPlayer({
      onReveal: () => {}, onSwallow: () => {}, onJump: () => {}, onFinale: () => {}, onEnd: () => { ends1++; },
    });
    p1.start({ id: 1, k: 2, prevSeason: 'spring', nextSeason: 'autumn' });
    vi.advanceTimersByTime(VOID_TOTAL_MS - 1);
    expect(ends1).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ends1).toBe(1);

    let ends2 = 0;
    const p2 = createVoidAnimationPlayer({
      onReveal: () => {}, onSwallow: () => {}, onJump: () => {}, onFinale: () => {}, onEnd: () => { ends2++; },
    });
    p2.start({ id: 1, k: 12, prevSeason: 'spring', nextSeason: 'winter' });
    vi.advanceTimersByTime(VOID_TOTAL_MS - 1);
    expect(ends2).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ends2).toBe(1);
  });

  it('cancel 清定时器：cancel 后不再触发任何阶段回调（只保留同步 onReveal）', () => {
    let calls = 0;
    const player = createVoidAnimationPlayer({
      onReveal: () => calls++,
      onSwallow: () => calls++,
      onJump: () => calls++,
      onFinale: () => calls++,
      onEnd: () => calls++,
    });
    player.start({ id: 5, k: 5, prevSeason: 'spring', nextSeason: 'autumn' });
    player.cancel();
    vi.advanceTimersByTime(10 * VOID_TOTAL_MS);
    expect(calls).toBe(1); // 只有 onReveal
  });

  it('新事件覆盖旧动画：start 新 id 清掉旧定时器，各阶段回调不重复', () => {
    const phases: string[] = [];
    const player = createVoidAnimationPlayer({
      onReveal: () => phases.push('reveal'),
      onSwallow: () => phases.push('swallow'),
      onJump: () => phases.push('jump'),
      onFinale: () => phases.push('finale'),
      onEnd: () => phases.push('end'),
    });
    player.start({ id: 1, k: 4, prevSeason: 'spring', nextSeason: 'autumn' });
    player.start({ id: 2, k: 1, prevSeason: 'autumn', nextSeason: 'winter' });
    vi.advanceTimersByTime(VOID_TOTAL_MS + 100);
    // 旧动画（id=1）定时器已被清：除两次 start 各自同步的 onReveal 外，
    // 各阶段回调只按新动画时间线触发一次（时间线固定，与 K 无关）
    expect(phases).toEqual(['reveal', 'reveal', 'swallow', 'jump', 'finale', 'end']);
  });
});
