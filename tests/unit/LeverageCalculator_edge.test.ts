import { describe, it, expect } from 'vitest';
import { LeverageCalculator } from '../../src/core/LeverageCalculator';

describe('LeverageCalculator - 杠杆策略边界测试', () => {
  it('应该正确计算不同季节进度的杠杆倍数', () => {
    const calculator = new LeverageCalculator();
    
    // 季节第1-3回合：1.0x
    expect(calculator.getLeverage(1)).toBe(1.0);
    expect(calculator.getLeverage(2)).toBe(1.0);
    expect(calculator.getLeverage(3)).toBe(1.0);
    
    // 季节第4-6回合：1.5x
    expect(calculator.getLeverage(4)).toBe(1.5);
    expect(calculator.getLeverage(5)).toBe(1.5);
    expect(calculator.getLeverage(6)).toBe(1.5);
    
    // 季节第7-9回合：2.0x
    expect(calculator.getLeverage(7)).toBe(2.0);
    expect(calculator.getLeverage(8)).toBe(2.0);
    expect(calculator.getLeverage(9)).toBe(2.0);
    
    // 季节第10-11回合：2.5x
    expect(calculator.getLeverage(10)).toBe(2.5);
    expect(calculator.getLeverage(11)).toBe(2.5);
    
    // 季节第12回合：3.0x
    expect(calculator.getLeverage(12)).toBe(3.0);
  });

  it('应该处理边界值（0和负数）', () => {
    const calculator = new LeverageCalculator();
    
    // 边界值应该返回默认值1.0
    expect(calculator.getLeverage(0)).toBe(1.0);
    expect(calculator.getLeverage(-1)).toBe(1.0);
  });

  it('应该处理超大值', () => {
    const calculator = new LeverageCalculator();
    
    // 超大值应该返回最大杠杆3.0
    expect(calculator.getLeverage(13)).toBe(3.0);
    expect(calculator.getLeverage(100)).toBe(3.0);
  });

  it('应该正确计算反季（-3评分）高杠杆持仓气耗的精确断言', () => {
    const calculator = new LeverageCalculator();
    // 期望公式：Math.max(0.5, 1.5 + 0.4 * -3) * 2.0 = 0.5 * 2.0 = 1.0
    expect(calculator.calculateHoldQiCost(-3, 2.0)).toBe(1.0);
  });
});
