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

describe('经济规则验收（最终 core 候选配置）', () => {
  it('候选配置与默认配置完全一致，避免预览/生产漂移', () => {
    expect(CANDIDATE_BALANCE_CONFIG).toEqual(DEFAULT_BALANCE_CONFIG);
  });

  it('core 杠杆额外持气耗按实际倍率计费', () => {
    const lc = new LeverageCalculator(DEFAULT_BALANCE_CONFIG);
    // 评分×10 + 气ceil：base(0) = ceil(1.5) = 2
    // 2.0x 额外 = ceil(2.0*2)=4 → 2+4=6；3.5x 额外 = ceil(3.5*2)=7 → 2+7=9
    expect(lc.calculateHoldQiCost(0, 2)).toBe(6);
    expect(lc.calculateHoldQiCost(0, 3.5)).toBe(9);
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
  it('默认配置下：三张高评分普通牌基础气耗仍低于自然回复', () => {
    const lc = new LeverageCalculator(CANDIDATE_BALANCE_CONFIG);
    const qi = new QiManager(undefined, CANDIDATE_BALANCE_CONFIG);

    // 3 张 +32 分普通牌（评分×10后理论最高）无杠杆持仓
    const perCard = lc.calculateHoldQiCost(32, 1);
    const totalCost = perCard * 3;
    const recovery = qi.getBaseRecovery();

    expect(totalCost).toBeLessThan(recovery);
    // ceil(1.5 + 0.04*32) = ceil(2.78) = 3
    expect(perCard).toBe(3); // 3张=9 < 回气10
  });

  it('杠杆仓位按实际倍率叠加持续气压', () => {
    const lc = new LeverageCalculator(DEFAULT_BALANCE_CONFIG);
    const qi = new QiManager(undefined, DEFAULT_BALANCE_CONFIG);

    const totalCost = lc.calculateHoldQiCost(32, 2) * 3;
    const recovery = qi.getBaseRecovery();

    expect(totalCost).toBeGreaterThan(recovery);
  });
});
