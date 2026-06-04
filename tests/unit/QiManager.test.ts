import { describe, it, expect } from 'vitest';
import { QiManager } from '../../src/core/QiManager';

describe('QiManager', () => {
  it('初始气值应为50', () => {
    const qi = new QiManager();
    expect(qi.getQi()).toBe(50);
  });
  
  it('消耗气后应正确扣除', () => {
    const qi = new QiManager();
    const success = qi.spend(10);
    expect(success).toBe(true);
    expect(qi.getQi()).toBe(40);
  });
  
  it('气不足时消耗应失败并保持原值', () => {
    const qi = new QiManager();
    const success = qi.spend(100);
    expect(success).toBe(false);
    expect(qi.getQi()).toBe(50);
  });
  
  it('回复气不应超过上限', () => {
    const qi = new QiManager();
    qi.recover(100);
    expect(qi.getQi()).toBe(80); // MAX_QI = 80
  });

  it('计算买入消耗应符合公式', () => {
    const qi = new QiManager();
    // cardScore = 3, useLeverage = false
    // cost = Math.ceil(11 * (1 + 0.05 * 3)) = Math.ceil(11 * 1.15) = Math.ceil(12.65) = 13
    expect(qi.calculateBuyCost(3, false)).toBe(13);

    // cardScore = 3, useLeverage = true
    // cost = 13 + 10 = 23
    expect(qi.calculateBuyCost(3, true)).toBe(23);
  });
});
