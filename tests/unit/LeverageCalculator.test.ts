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
    // 评分×10 整数化 + 气ceil取整（2026-08-03）
    // holdQiScoreFactor: 0.4 → 0.04（评分×10后÷10补偿）
    // cardScore = 3, leverage = 2.0
    // base = ceil(max(0.5, 1.5 + 0.04 * 3)) = ceil(1.62) = 2
    // cost = 2 + ceil(2.0 * 2) = 2 + 4 = 6
    expect(lc.calculateHoldQiCost(3, 2.0)).toBe(6);
    // 3.5x 额外持气耗 = ceil(3.5 * 2) = 7
    // base(0) = ceil(1.5) = 2, cost = 2 + 7 = 9
    expect(lc.calculateHoldQiCost(0, 3.5)).toBe(9);

    // cardScore = -5, leverage = 1.0（无杠杆）
    // base = ceil(max(0.5, 1.5 + 0.04 * -5)) = ceil(1.3) = 2
    expect(lc.calculateHoldQiCost(-5, 1.0)).toBe(2);

    // cardScore = 0, leverage = 1.5
    // base = ceil(1.5) = 2, cost = 2 + ceil(1.5 * 2) = 2 + 3 = 5
    expect(lc.calculateHoldQiCost(0, 1.5)).toBe(5);
  });

  it('爆仓强平判定', () => {
    expect(lc.checkMarginCall(10)).toBe(false);
    expect(lc.checkMarginCall(1)).toBe(false);
    expect(lc.checkMarginCall(0)).toBe(true);
    expect(lc.checkMarginCall(-5)).toBe(true);
  });
});
