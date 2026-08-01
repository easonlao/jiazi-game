import { describe, it, expect } from 'vitest';
import { LeverageCalculator } from '../../src/core/LeverageCalculator';

describe('LeverageCalculator - 杠杆策略边界测试', () => {
  it('应该正确计算不同季内回合的杠杆倍数（换季重置）', () => {
    const calculator = new LeverageCalculator();

    // 任意新季第1-2回合：1.0x
    expect(calculator.getLeverage(1)).toBe(1.0);
    expect(calculator.getLeverage(2)).toBe(1.0);

    // 季内第3-5回合：2.0x
    expect(calculator.getLeverage(3)).toBe(2.0);
    expect(calculator.getLeverage(5)).toBe(2.0);

    // 季内第6-8回合：2.5x
    expect(calculator.getLeverage(6)).toBe(2.5);
    expect(calculator.getLeverage(8)).toBe(2.5);

    // 季内第9-11回合：3.0x
    expect(calculator.getLeverage(9)).toBe(3.0);
    expect(calculator.getLeverage(11)).toBe(3.0);

    // 季内第12回合：3.5x；换季重新从1.0x开始
    expect(calculator.getLeverage(12)).toBe(3.5);
    expect(calculator.getLeverage(1)).toBe(1.0);
  });

  it('应该处理边界值（0和负数）', () => {
    const calculator = new LeverageCalculator();
    
    // 边界值应该返回默认值1.0
    expect(calculator.getLeverage(0)).toBe(1.0);
    expect(calculator.getLeverage(-1)).toBe(1.0);
  });

  it('应该处理超大值', () => {
    const calculator = new LeverageCalculator();
    
    // 超过季内表末返回最大杠杆3.5
    expect(calculator.getLeverage(61)).toBe(3.5);
    expect(calculator.getLeverage(100)).toBe(3.5);
  });

  it('应该正确计算反季（-3评分）高杠杆持仓气耗的精确断言', () => {
    const calculator = new LeverageCalculator();
    // 期望公式：base = max(0.5, 1.5 + 0.4 * -3) = max(0.5, 0.3) = 0.5
    // cost = base + 2.0 * 1 = 0.5 + 2 = 2.5
    expect(calculator.calculateHoldQiCost(-3, 2.0)).toBe(2.5);
  });
});
