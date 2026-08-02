import { describe, it, expect } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { SeasonCycle } from '../../src/core/SeasonCycle';
import { DEFAULT_BALANCE_CONFIG, CANDIDATE_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import { SeededRandomSource } from '../../src/core/RandomSource';

class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
(globalThis as any).localStorage = new LocalStorageMock();

describe('Codex 审查 P1 回归：强平随机源确定性', () => {
  it('两张杠杆牌强平：同 seed 两次对局结果完全一致', async () => {
    const run = async () => {
      const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(777));
      await tm.initialize();
      tm.startGame();
      // 买入两张杠杆牌
      expect(tm.executeBuy(0, true)).toBe(true);
      expect(tm.executeBuy(0, true)).toBe(true);
      const handIds = tm.getHand().filter((s) => s !== null).map((s) => s!.card.id);
      expect(handIds.length).toBe(2);
      // 全局杠杆表下第 1-2 回合杠杆 1.0x，气耗仅 base（≥0.5/张）；
      // qi 压到 0.5 保证两张牌扣气后必为负 → 爆仓强平
      (tm as any).qiManager.setQi(0.5);
      tm.executeWait();
      return {
        handAfter: tm.getHand().map((s) => (s ? s.card.id : null)),
        score: tm.getScore(),
      };
    };

    const a = await run();
    const b = await run();
    expect(a).toEqual(b); // 同 seed 必须逐字段一致
  });

  it('不同 seed 强平结果允许不同（不强制，只验证可复现路径存在）', async () => {
    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(1));
    await tm.initialize();
    tm.startGame();
    expect(tm.executeBuy(0, true)).toBe(true);
    expect(tm.executeBuy(0, true)).toBe(true);
    (tm as any).qiManager.setQi(0.5);
    tm.executeWait();
    expect(tm.getHand().filter((s) => s !== null).length).toBeLessThan(2); // 至少强平一张
  });
});

describe('Codex 审查 P1 回归：季节段下限 3-12', () => {
  it('固定 seed 100 次：每段均在 3-12，总和恰好 60', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const sc = new SeasonCycle(new SeededRandomSource(seed));
      const lengths = sc.getSeasonLengths();
      const total = lengths.reduce((a, b) => a + b, 0);
      expect(total).toBe(60);
      for (const len of lengths) {
        expect(len).toBeGreaterThanOrEqual(3);
        expect(len).toBeLessThanOrEqual(12);
      }
    }
  });
});

describe('Codex 审查 P1 回归：强平罚分系数配置化', () => {
  it('默认与候选配置均声明 marginCallPenaltyPerScore = 3', () => {
    expect(DEFAULT_BALANCE_CONFIG.marginCallPenaltyPerScore).toBe(3);
    expect(CANDIDATE_BALANCE_CONFIG.marginCallPenaltyPerScore).toBe(3);
  });

  it('非 6 系数配置：强平说明文本与实际扣分同源（读同一配置值）', async () => {
    const customConfig = {
      ...DEFAULT_BALANCE_CONFIG,
      marginCallPenaltyPerScore: 10,
    };
    const tm = new TurnManager(customConfig, new SeededRandomSource(99));
    await tm.initialize();
    tm.startGame();
    // 杠杆买入一张牌
    expect(tm.executeBuy(0, true)).toBe(true);
    // 压低气触发爆仓
    (tm as any).qiManager.setQi(0.1);
    tm.executeWait();

    const detail = tm.getLastSettlementDetail();
    expect(detail?.marginCallTriggered).toBe(true);
    expect(detail?.marginCallDetails.length).toBeGreaterThan(0);
    const reason = detail!.marginCallDetails[0].reason;
    // 说明文本必须使用配置系数 10，而不是写死 6
    expect(reason).toContain('× 10');
    expect(reason).not.toContain('× 6');
  });
});
