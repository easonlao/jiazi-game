import { describe, it, expect } from 'vitest';
import { SeasonCycle } from '../../src/core/SeasonCycle';

describe('SeasonCycle', () => {
  it('初始状态验证', () => {
    const cycle = new SeasonCycle();
    expect(cycle.getCurrentSeason()).toBe('spring');
    expect(cycle.getCurrentRoundInSeason()).toBe(1);
    expect(cycle.getFollowingSeason()).toBe('summer');
    // 非季末时，结算季仍是春；卡面趋势季固定指向夏。
    expect(cycle.getNextSeason()).toBe('spring');
  });

  it('下一季展示语义不依赖回合边界，并覆盖冬到春', () => {
    const cycle = new SeasonCycle();
    cycle.loadState(0, 1, [12, 12, 12, 12]);
    expect(cycle.getCurrentSeason()).toBe('spring');
    expect(cycle.getFollowingSeason()).toBe('summer');
    expect(cycle.getNextSeason()).toBe('spring');

    cycle.loadState(3, 1, [12, 12, 12, 12]);
    expect(cycle.getCurrentSeason()).toBe('winter');
    expect(cycle.getFollowingSeason()).toBe('spring');
    expect(cycle.getNextSeason()).toBe('winter');
  });

  it('随机季节长度应在3-12之间', () => {
    const cycle = new SeasonCycle();
    const length = cycle.getCurrentSeasonLength();
    expect(length).toBeGreaterThanOrEqual(3);
    expect(length).toBeLessThanOrEqual(12);
  });

  it('推进回合直到换季', () => {
    const cycle = new SeasonCycle();
    const length = cycle.getCurrentSeasonLength();
    
    // 推进 length - 1 次都不应该换季
    for (let i = 1; i < length; i++) {
      const changed = cycle.advance();
      expect(changed).toBe(false);
      expect(cycle.getCurrentRoundInSeason()).toBe(i + 1);
    }

    // 此时在这一季的最后一回合，再推进一次，应该换季
    const changed = cycle.advance();
    expect(changed).toBe(true);
    expect(cycle.getCurrentRoundInSeason()).toBe(1);
    expect(cycle.getCurrentSeason()).toBe('summer');
  });

  it('重置功能正常', () => {
    const cycle = new SeasonCycle();
    cycle.advance();
    cycle.reset();
    expect(cycle.getCurrentSeason()).toBe('spring');
    expect(cycle.getCurrentRoundInSeason()).toBe(1);
  });
});
