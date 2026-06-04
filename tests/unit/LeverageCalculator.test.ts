import { describe, it, expect } from 'vitest';
import { LeverageCalculator } from '../../src/core/LeverageCalculator';

describe('LeverageCalculator', () => {
  const lc = new LeverageCalculator();

  it('获取不同季节回合对应的杠杆倍数', () => {
    // 1-3 -> 1.0
    expect(lc.getMultiplier(1)).toBe(1.0);
    expect(lc.getMultiplier(3)).toBe(1.0);
    
    // 4-6 -> 1.5
    expect(lc.getMultiplier(4)).toBe(1.5);
    expect(lc.getMultiplier(6)).toBe(1.5);

    // 7-9 -> 2.0
    expect(lc.getMultiplier(7)).toBe(2.0);
    expect(lc.getMultiplier(9)).toBe(2.0);

    // 10-11 -> 2.5
    expect(lc.getMultiplier(10)).toBe(2.5);
    expect(lc.getMultiplier(11)).toBe(2.5);

    // 12 -> 3.0
    expect(lc.getMultiplier(12)).toBe(3.0);
    
    // 超出限制时默认值 3.0
    expect(lc.getMultiplier(13)).toBe(3.0);
  });

  it('计算持仓气耗', () => {
    // cardScore = 3, leverage = 1.5
    // cost = Math.max(0.5, (1.5 + 0.4 * 3) * 1.5) = Math.max(0.5, 2.7 * 1.5) = Math.max(0.5, 4.05) = 4.05
    expect(lc.calculateHoldQiCost(3, 1.5)).toBeCloseTo(4.05);

    // cardScore = -5, leverage = 1.0
    // cost = Math.max(0.5, (1.5 + 0.4 * -5) * 1) = Math.max(0.5, (1.5 - 2) * 1) = Math.max(0.5, -0.5) = 0.5
    expect(lc.calculateHoldQiCost(-5, 1.0)).toBe(0.5);
  });

  it('爆仓强平判定', () => {
    expect(lc.checkMarginCall(10)).toBe(false);
    expect(lc.checkMarginCall(1)).toBe(false);
    expect(lc.checkMarginCall(0)).toBe(true);
    expect(lc.checkMarginCall(-5)).toBe(true);
  });
});
