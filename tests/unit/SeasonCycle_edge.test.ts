import { describe, it, expect } from 'vitest';
import { SeasonCycle } from '../../src/core/SeasonCycle';

describe('SeasonCycle - 极端季节序列测试', () => {
  it('应该处理连续12回合的长季节', () => {
    const seasonCycle = new SeasonCycle();
    
    // 强制设定前几个季节长度为符合特定逻辑，或模拟推进。
    // 在真实代码中，季节长度随机在 3-12 之间，如果想模拟连续12回合春天：
    // 我们可以通过 loadState 来载入包含 12 个回合长度的春季。
    // 比如：loadState(index = 0, roundInSeason = 1, lengths = [12, 12, 12, 12, 12])
    seasonCycle.loadState(0, 1, [12, 12, 12, 12, 12]);
    
    for (let i = 0; i < 11; i++) {
      seasonCycle.advanceRound();
    }
    
    expect(seasonCycle.getCurrentSeason()).toBe('spring');
    expect(seasonCycle.getSeasonRound()).toBe(12);
  });

  it('应该处理连续3回合的短季节', () => {
    const seasonCycle = new SeasonCycle();
    
    // 强制设定春天长度为 3
    seasonCycle.loadState(0, 1, [3, 12, 12, 12, 12, 12]);
    
    for (let i = 0; i < 2; i++) {
      seasonCycle.advanceRound();
    }
    
    // 第4回合推进应该换季到夏天
    seasonCycle.advanceRound();
    expect(seasonCycle.getCurrentSeason()).toBe('summer');
  });

  it('应该处理60回合的完整游戏', () => {
    const seasonCycle = new SeasonCycle();
    
    // 推进 60 回合并验证运行正常
    let totalRounds = 0;
    for (let i = 0; i < 60; i++) {
      seasonCycle.advanceRound();
      totalRounds++;
    }
    
    expect(totalRounds).toBe(60);
    expect(seasonCycle.getTotalRounds()).toBe(60);
  });
});
