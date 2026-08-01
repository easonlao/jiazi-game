import { describe, it, expect } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { LeverageCalculator } from '../../src/core/LeverageCalculator';
import { QiManager } from '../../src/core/QiManager';
import { CANDIDATE_BALANCE_CONFIG, DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import { SeededRandomSource } from '../../src/core/RandomSource';

// TurnManager 内部依赖 localStorage（saveGame/loadGame），mock 掉
class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
(globalThis as any).localStorage = new LocalStorageMock();

/** 辅助：创建注入固定 seed + 配置的 TurnManager */
function makeTm(config: typeof CANDIDATE_BALANCE_CONFIG) {
  const tm = new TurnManager(config, new SeededRandomSource(42));
  return tm;
}

describe('经济规则验收（Codex handoff Phase 3 候选配置）', () => {
  it('候选配置：「买入→持有一回合→卖出」不得净回气', async () => {
    const tm = makeTm(CANDIDATE_BALANCE_CONFIG);
    await tm.initialize();
    tm.startGame();

    const qiBefore = tm.getQi();
    expect(qiBefore).toBe(54); // 50 初始 + 4 自然回气

    const buyOk = tm.executeBuy(0, false);
    expect(buyOk).toBe(true);

    const sellOk = tm.executeSell(0);
    expect(sellOk).toBe(true);

    // 卖出后总气必须比买入前少（套利被消除）
    expect(tm.getQi()).toBeLessThan(qiBefore);
  });

  it('默认配置：同一循环存在净回气（证明 Codex 指出的套利）', async () => {
    const tm = makeTm(DEFAULT_BALANCE_CONFIG);
    await tm.initialize();
    tm.startGame();

    const qiBefore = tm.getQi();
    tm.executeBuy(0, false);
    tm.executeSell(0);

    // 默认配置下卖出后总气比买入前多 → 套利成立
    expect(tm.getQi()).toBeGreaterThan(qiBefore);
  });

  it('第 60 回合禁止买入', async () => {
    const tm = makeTm(DEFAULT_BALANCE_CONFIG);
    await tm.initialize();
    tm.startGame();

    // 推进 59 次等待到第 60 回合
    for (let i = 0; i < 59; i++) {
      expect(tm.executeWait()).toBe(true);
    }
    expect(tm.getCurrentRound()).toBe(60);
    expect(tm.getState()).toBe('player_action');

    // 最后一回合买入应被拒绝
    const buyOk = tm.executeBuy(0, false);
    expect(buyOk).toBe(false);
    // 卖出/等待仍可用
    expect(tm.executeWait()).toBe(true);
  });
});

describe('满仓维持性（公式级）', () => {
  it('候选配置下：三张高评分普通牌总气耗 > 自然回复', () => {
    const lc = new LeverageCalculator(CANDIDATE_BALANCE_CONFIG);
    const qi = new QiManager(undefined, CANDIDATE_BALANCE_CONFIG);

    // 3 张 +3.2 分普通牌（理论最高评分）无杠杆持仓
    const perCard = lc.calculateHoldQiCost(3.2, 1);
    const totalCost = perCard * 3;
    const recovery = qi.getBaseRecovery();

    expect(totalCost).toBeGreaterThan(recovery);
    expect(perCard).toBeCloseTo(Math.max(0.5, 1.5 + 0.4 * 3.2), 5); // 2.78
  });

  it('默认配置下：满仓高评分牌反而净回气（Codex 发现的问题）', () => {
    const lc = new LeverageCalculator(DEFAULT_BALANCE_CONFIG);
    const qi = new QiManager(undefined, DEFAULT_BALANCE_CONFIG);

    const totalCost = lc.calculateHoldQiCost(3.2, 1) * 3;
    const recovery = qi.getBaseRecovery();

    expect(totalCost).toBeLessThan(recovery); // 8.34 < 10
  });
});
