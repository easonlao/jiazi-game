import { describe, it, expect } from 'vitest';
import { ScoreManager } from '../../src/core/ScoreManager';

describe('ScoreManager - 分数计算边界测试', () => {
  it('应该正确计算持仓收益', () => {
    const scoreManager = new ScoreManager();
    
    // 持仓收益 = HOLD_BONUS(1.2) * 评分 * 杠杆
    // 评分4.0，杠杆1.0时：1.2 * 4.0 * 1.0 = 4.8
    const earning = scoreManager.calculateHoldEarning(4.0, 1.0);
    expect(earning).toBeCloseTo(4.8, 1);
  });

  it('应该正确计算卖出得分', () => {
    const scoreManager = new ScoreManager();
    
    // 卖出得分 = (SELL_BASE(8.0) + (当前评分 - 买入评分) * SPREAD_MULTIPLIER(4.0)) * 杠杆
    // 当前评分4.0，买入评分-3.0，杠杆1.0时：
    // (8.0 + (4.0 - (-3.0)) * 4.0) * 1.0 = (8.0 + 7.0 * 4.0) * 1.0 = (8.0 + 28.0) * 1.0 = 36.0
    const score = scoreManager.calculateSellScore(4.0, -3.0, 1.0);
    expect(score).toBeCloseTo(36.0, 1);
  });

  it('应该处理负评分的卖出得分', () => {
    const scoreManager = new ScoreManager();
    
    // 负评分卖出：当前评分-3.0，买入评分4.0，杠杆1.0时：
    // (8.0 + (-3.0 - 4.0) * 4.0) * 1.0 = (8.0 + (-7.0) * 4.0) * 1.0 = (8.0 - 28.0) * 1.0 = -20.0
    const score = scoreManager.calculateSellScore(-3.0, 4.0, 1.0);
    expect(score).toBeCloseTo(-20.0, 1);
  });

  it('应该处理杠杆对分数的影响', () => {
    const scoreManager = new ScoreManager();
    
    // 杠杆2.0时，收益应该翻倍
    const earning = scoreManager.calculateHoldEarning(4.0, 2.0);
    expect(earning).toBeCloseTo(9.6, 1); // 4.8 * 2.0
  });
});
