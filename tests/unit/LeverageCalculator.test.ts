import { describe, it, expect } from 'vitest';
import { LeverageCalculator } from '../../src/core/LeverageCalculator';

describe('LeverageCalculator', () => {
  const lc = new LeverageCalculator();

  it('获取不同季内回合对应的杠杆倍数（每季重置）', () => {
    // 每 3 个季内回合升一档；第 1-2 回合仍为预埋 1.0x
    expect(lc.getMultiplier(1)).toBe(1.0);
    expect(lc.getMultiplier(2)).toBe(1.0);

    // 第 3-5 回合 -> 2.0
    expect(lc.getMultiplier(3)).toBe(2.0);
    expect(lc.getMultiplier(5)).toBe(2.0);

    // 第 6-8 回合 -> 2.5
    expect(lc.getMultiplier(6)).toBe(2.5);
    expect(lc.getMultiplier(8)).toBe(2.5);

    // 第 9-11 回合 -> 3.0
    expect(lc.getMultiplier(9)).toBe(3.0);
    expect(lc.getMultiplier(11)).toBe(3.0);

    // 第 12 回合 -> 3.5；换季后重新传入 1 即回到 1.0
    expect(lc.getMultiplier(12)).toBe(3.5);
    expect(lc.getMultiplier(1)).toBe(1.0);

    // 超出季内上限时保持最高档
    expect(lc.getMultiplier(13)).toBe(3.5);
  });

  it('计算持仓气耗', () => {
    // cardScore = 3, leverage = 2.0
    // base = max(0.5, 1.5 + 0.4 * 3) = max(0.5, 2.7) = 2.7
    // cost = base + 2.0 * 2 = 2.7 + 4 = 6.7
    expect(lc.calculateHoldQiCost(3, 2.0)).toBeCloseTo(6.7, 1);
    // 3.5x 的额外持气耗为 3.5 * 2 = 7
    expect(lc.calculateHoldQiCost(0, 3.5)).toBeCloseTo(8.5, 1);

    // cardScore = -5, leverage = 1.0（无杠杆）
    // base = max(0.5, 1.5 + 0.4 * -5) = max(0.5, -0.5) = 0.5
    // cost = base (无杠杆额外) = 0.5
    expect(lc.calculateHoldQiCost(-5, 1.0)).toBeCloseTo(0.5, 1);

    // cardScore = 0, leverage = 1.5
    // base = 1.5, cost = 1.5 + 1.5 * 2 = 4.5
    expect(lc.calculateHoldQiCost(0, 1.5)).toBeCloseTo(4.5, 1);
  });

  it('爆仓强平判定', () => {
    expect(lc.checkMarginCall(10)).toBe(false);
    expect(lc.checkMarginCall(1)).toBe(false);
    expect(lc.checkMarginCall(0)).toBe(true);
    expect(lc.checkMarginCall(-5)).toBe(true);
  });
});
