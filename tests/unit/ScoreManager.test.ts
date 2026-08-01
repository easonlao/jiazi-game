import { describe, it, expect } from 'vitest';
import { ScoreManager } from '../../src/core/ScoreManager';

describe('ScoreManager', () => {
  it('初始分数及盈亏为0', () => {
    const score = new ScoreManager();
    expect(score.getScore()).toBe(0);
    expect(score.getTotalHoldEarnings()).toBe(0);
    expect(score.getTotalSellEarnings()).toBe(0);
  });

  it('正确计算持仓收益', () => {
    const score = new ScoreManager();
    // cardScore = 3, leverage = 1.5
    // holdEarnings = 1.2 * 3 * 1.5 = 5.4
    expect(score.calculateHoldEarnings(3, 1.5)).toBeCloseTo(5.4);
  });

  it('正确计算卖出得分', () => {
    const score = new ScoreManager();
    // currentScore = 3, buyScore = 2, leverage = 1.5
    // sellScore = ((3 - 2) * 4) * 1.5 = 4 * 1.5 = 6
    expect(score.calculateSellScore(3, 2, 1.5)).toBeCloseTo(6);
  });

  it('累加持仓与卖出收益', () => {
    const score = new ScoreManager();
    
    score.addHoldEarnings(10);
    expect(score.getScore()).toBe(10);
    expect(score.getTotalHoldEarnings()).toBe(10);

    score.addSellEarnings(25);
    expect(score.getScore()).toBe(35);
    expect(score.getTotalSellEarnings()).toBe(25);
  });

  it('重置分数正常', () => {
    const score = new ScoreManager();
    score.addHoldEarnings(10);
    score.reset();
    expect(score.getScore()).toBe(0);
    expect(score.getTotalHoldEarnings()).toBe(0);
  });
});
