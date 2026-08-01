import { describe, it, expect } from 'vitest';
import { SeededRandomSource, MathRandomSource } from '../../src/core/RandomSource';
import { DEFAULT_BALANCE_CONFIG, CANDIDATE_BALANCE_CONFIG } from '../../src/core/BalanceConfig';

describe('SeededRandomSource 确定性', () => {
  it('相同 seed 产生相同序列', () => {
    const a = new SeededRandomSource(42);
    const b = new SeededRandomSource(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('不同 seed 产生不同序列', () => {
    const a = new SeededRandomSource(1);
    const b = new SeededRandomSource(2);
    let same = 0;
    for (let i = 0; i < 20; i++) {
      if (a.next() === b.next()) same++;
    }
    expect(same).toBeLessThan(10); // 不可能全部相同
  });

  it('next() 返回 [0, 1) 区间', () => {
    const r = new SeededRandomSource(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(min, maxExclusive) 返回正确范围且覆盖边界', () => {
    const r = new SeededRandomSource(99);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(0, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
      seen.add(v);
    }
    expect(seen.has(0)).toBe(true);
    expect(seen.has(1)).toBe(true);
    expect(seen.has(2)).toBe(true);
  });

  it('MathRandomSource 可用', () => {
    const r = new MathRandomSource();
    const v = r.int(0, 5);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(5);
  });
});

describe('BalanceConfig', () => {
  it('默认配置与现状一致', () => {
    expect(DEFAULT_BALANCE_CONFIG.baseRecovery).toBe(10);
    expect(DEFAULT_BALANCE_CONFIG.waitBonus).toBe(10);
    expect(DEFAULT_BALANCE_CONFIG.sellCost).toBe(4);
    expect(DEFAULT_BALANCE_CONFIG.buyEntryFee).toBe(2);
    expect(DEFAULT_BALANCE_CONFIG.baseBuyCost).toBe(11);
    expect(DEFAULT_BALANCE_CONFIG.maxQi).toBe(80);
    expect(DEFAULT_BALANCE_CONFIG.leverageTable).toEqual([
      [2, 1.0],
      [5, 1.5],
      [8, 2.0],
      [11, 2.5],
      [12, 3.0],
    ]);
  });

  it('候选配置：套利修复参数', () => {
    expect(CANDIDATE_BALANCE_CONFIG.baseRecovery).toBe(4);
    expect(CANDIDATE_BALANCE_CONFIG.waitBonus).toBe(8);
    expect(CANDIDATE_BALANCE_CONFIG.buyEntryFee).toBe(3);
    expect(CANDIDATE_BALANCE_CONFIG.sellCost).toBe(5);
    // 其他参数继承默认
    expect(CANDIDATE_BALANCE_CONFIG.baseBuyCost).toBe(DEFAULT_BALANCE_CONFIG.baseBuyCost);
    expect(CANDIDATE_BALANCE_CONFIG.lqc).toBe(DEFAULT_BALANCE_CONFIG.lqc);
  });
});
