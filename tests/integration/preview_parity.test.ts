import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGameStore } from '../../app/src/store';
import { TurnManager } from '../../src/core/TurnManager';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import { SeededRandomSource } from '../../src/core/RandomSource';

// TurnManager 依赖 localStorage（存档路径），mock 掉
class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
(globalThis as any).localStorage = new LocalStorageMock();

// Node 环境无 CardDataBank 的 JSON 资源：stub fetch 抛错走默认牌库 fallback
vi.stubGlobal('fetch', () => Promise.reject(new Error('no fetch in test env')));

const origLog = console.log;
const origWarn = console.warn;

/** 创建并注入固定 seed 的 TurnManager 到 store，返回干净开局 */
async function freshGame(seed: number) {
  const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(seed));
  await tm.initialize();
  useGameStore.setState({ turnManager: tm, lastSettlement: null });
  useGameStore.getState().startGame();
  useGameStore.getState()._sync();
  return tm;
}

describe('等待预览与真实结算一致性（Codex 第二轮 P1）', () => {
  beforeEach(() => {
    console.log = () => {};
    console.warn = () => {};
  });

  afterEach(() => {
    console.log = origLog;
    console.warn = origWarn;
  });

  it('气在上限附近无持仓：预览封顶到 80，与真实等待一致', async () => {
    const tm = await freshGame(1);
    (tm as any).qiManager.setQi(75);
    useGameStore.getState()._sync();

    const { afterQi } = useGameStore.getState().previewWaitQi();
    expect(afterQi).toBe(80); // 75 + 10 + 10 = 95 → 封顶 80

    useGameStore.getState().executeWait();
    expect(useGameStore.getState().qi).toBe(80);
  });

  it('锁定/解锁后：神识下回合扣除预览立即增减锁定成本', async () => {
    const tm = await freshGame(6);
    (tm as any).qiManager.setQi(40);
    useGameStore.getState()._sync();
    expect(useGameStore.getState().previewWaitQi().lockedQiCost).toBe(0);

    useGameStore.getState().toggleLockCard(0);
    expect(useGameStore.getState().previewWaitQi().lockedQiCost).toBe(TurnManager.LOCK_COST_PER_CARD);

    useGameStore.getState().toggleLockCard(0);
    expect(useGameStore.getState().previewWaitQi().lockedQiCost).toBe(0);
  });

  it('最后一回合：等待预览返回当前气、零气耗（等待直接结束，不回气）', async () => {
    const tm = await freshGame(2);
    // 直接推进到最后一回合（第 60 回合）
    (tm as any).currentRound = 60;
    (tm as any).qiManager.setQi(33);
    useGameStore.getState()._sync();

    const preview = useGameStore.getState().previewWaitQi();
    expect(preview.holdQiCost).toBe(0);
    expect(preview.afterQi).toBe(33); // 不是 33+20=53

    // 真实等待后游戏直接结束
    useGameStore.getState().executeWait();
    expect(useGameStore.getState().gameState).toBe('game_over');
  });

  it('跨季边界：明确选牌买入，预览与真实结算一致', async () => {
    const tm = await freshGame(3);
    // 气设满保证买入成功
    (tm as any).qiManager.setQi(80);
    // 构造季末：spring 第 11 回合（当季长度 11），下一回合换季到 summer
    (tm as any).seasonCycle.loadState(0, 11, [11, 12, 12, 12, 12, 12, 12]);
    useGameStore.getState()._sync();

    // 明确选牌（第 0 张公共牌）再买入，失败即断言失败（禁止假绿）
    useGameStore.getState().selectPublicCard(0);
    const buyOk = useGameStore.getState().executeBuy();
    expect(buyOk).toBe(true);
    const qiAfterBuy = useGameStore.getState().qi;

    const preview = useGameStore.getState().previewWaitQi();
    expect(preview.holdQiCost).toBeGreaterThan(0); // 有持仓才有意义
    expect(preview.afterQi).toBeLessThanOrEqual(80);

    // 真实等待：结算季（summer）评分扣气耗 → 回气（封顶 80）
    useGameStore.getState().executeWait();
    const realQi = useGameStore.getState().qi;
    const expected = Math.min(80, qiAfterBuy - preview.holdQiCost + 10 + 10);
    expect(realQi).toBeCloseTo(expected, 0);
  });

  it('杠杆强平：真实开启杠杆，预览标记不确定性，等待后强平真实发生', async () => {
    const tm = await freshGame(4);
    // 开启杠杆并买入一张杠杆牌
    useGameStore.getState().toggleLeverage();
    useGameStore.getState().selectPublicCard(0);
    expect(useGameStore.getState().executeBuy()).toBe(true);
    expect(useGameStore.getState().hand.filter((s) => s !== null).length).toBe(1);

    // 压低气：任何持仓气耗都会使扣气后中间气量 ≤ 0 → 触发强平
    (tm as any).qiManager.setQi(0.1);
    useGameStore.getState()._sync();

    const preview = useGameStore.getState().previewWaitQi();
    expect(preview.hasLeverage).toBe(true);
    expect(preview.willMarginCall).toBe(true); // 预览明确标记爆仓风险
    expect(preview.willQiDeplete).toBe(true);
    expect(preview.midQi).toBeLessThanOrEqual(0);

    // 真实执行等待：断言强平真实发生（杠杆牌被卖出）
    const scoreBefore = useGameStore.getState().score;
    useGameStore.getState().executeWait();
    const handAfter = useGameStore.getState().hand.filter((s) => s !== null);
    expect(handAfter.length).toBeLessThan(1); // 杠杆牌被强平卖出
    void scoreBefore;
  });

  it('普通仓位扣气后归零：不触发强平，预览给出可验证的最终回气', async () => {
    const tm = await freshGame(5);
    useGameStore.getState().selectPublicCard(0);
    expect(useGameStore.getState().executeBuy()).toBe(true);
    (tm as any).qiManager.setQi(0.1);
    useGameStore.getState()._sync();

    const preview = useGameStore.getState().previewWaitQi();
    expect(preview.willQiDeplete).toBe(true);
    expect(preview.willMarginCall).toBe(false);

    useGameStore.getState().executeWait();
    expect(useGameStore.getState().marginCallCount).toBe(0);
    expect(useGameStore.getState().qi).toBeCloseTo(preview.afterQi, 0);
  });
});
