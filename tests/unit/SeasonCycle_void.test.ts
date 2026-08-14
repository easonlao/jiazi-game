/**
 * V5 空亡规则·季节懒生成与双时钟吞噬（SeasonCycle 层）单元测试。
 *
 * 覆盖（mechanics.md §9 / 票 03 验收，一审 P1-② 修正为无界时钟语义）：
 * 1. 懒生成季长分布：大量采样后形状与定稿分布一致、seeded 可复现；
 * 2. 懒生成按需抽取，季节时钟**无界**（不按 60 总长 clamp，每局约 15 季；
 *    游戏总长由 TurnManager 的第 60 游戏回合终局决定）；
 * 3. 双时钟吞噬：advanceBy 跨季 / 吞掉紧邻整季 / 连吞两季 / 越过旧 60 上限继续推进；
 * 4. V1-V4 非懒路径回归：整局表总和 60、换季行为不变。
 */
import { describe, it, expect } from 'vitest';
import {
  SeasonCycle,
  LAZY_SEASON_LENGTH_DISTRIBUTION,
} from '../../src/core/SeasonCycle';
import { SeededRandomSource, type RandomSource } from '../../src/core/RandomSource';

/** 定稿分布的总权重（4:2.4 ... 12:1.9，和 = 100.2）。 */
const TOTAL_WEIGHT = LAZY_SEASON_LENGTH_DISTRIBUTION.reduce((sum, { weight }) => sum + weight, 0);

/** 脚本随机源：按固定序列吐 [0,1) 值（int 由 next 派生），用尽后默认 0.5。 */
class ScriptedRandom implements RandomSource {
  private i = 0;
  constructor(private readonly values: number[]) {}
  next(): number {
    const v = this.values[this.i] ?? 0.5;
    this.i++;
    return v;
  }
  int(min: number, maxExclusive: number): number {
    return min + Math.floor(this.next() * (maxExclusive - min));
  }
}

describe('V5 懒生成季长分布', () => {
  it('大量采样后各长度频率与定稿分布一致（±1pp，n=100000）', () => {
    const random = new SeededRandomSource(20260813);
    const n = 100000;
    const counts = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const len = SeasonCycle.sampleSeasonLength(random);
      counts.set(len, (counts.get(len) ?? 0) + 1);
    }
    for (const { length, weight } of LAZY_SEASON_LENGTH_DISTRIBUTION) {
      const expected = weight / TOTAL_WEIGHT;
      const actual = (counts.get(length) ?? 0) / n;
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.01);
    }
  });

  it('分布均值 ≈ 7.5（定稿口径）', () => {
    const mean =
      LAZY_SEASON_LENGTH_DISTRIBUTION.reduce((sum, { length, weight }) => sum + length * weight, 0) /
      TOTAL_WEIGHT;
    expect(mean).toBeGreaterThan(7.3);
    expect(mean).toBeLessThan(7.7);
  });

  it('同种子采样序列完全可复现', () => {
    const a: number[] = [];
    const b: number[] = [];
    const r1 = new SeededRandomSource(7);
    const r2 = new SeededRandomSource(7);
    for (let i = 0; i < 200; i++) {
      a.push(SeasonCycle.sampleSeasonLength(r1));
      b.push(SeasonCycle.sampleSeasonLength(r2));
    }
    expect(a).toEqual(b);
  });

  it('采样边界映射：脚本随机源精确命中定稿区间', () => {
    // 用两个随机值分别落在 4 与 12 的累积区间
    const total = TOTAL_WEIGHT;
    const expectLength = (v: number, expected: number) => {
      const random = new ScriptedRandom([v]);
      expect(SeasonCycle.sampleSeasonLength(random)).toBe(expected);
    };
    expectLength(0.0001, 4); // u = 0.0001*total ≈ 0.010 < 2.4
    expectLength(0.9999, 12); // u = 0.9999*total ≈ 100.19 > 98.3
    // 累积边界：5 的区间是 [2.4, 11.8) → u = 10 命中 5
    expectLength(10 / total, 5);
    // 7 的区间是 [30.1, 53.0) → u = 40 命中 7
    expectLength(40 / total, 7);
  });
});

describe('V5 懒生成按需抽取（无界时钟）', () => {
  it('构造时预生成首季长度；换季由 advance 预生成下一季（引擎确定性，2026-08-14 修复）', () => {
    const sc = new SeasonCycle(new SeededRandomSource(1), { lazy: true });
    // 修复后：构造即生成首季长度（确定性时机，不依赖外部首次访问）
    const lengths = sc.getSeasonLengths();
    expect(lengths).toHaveLength(1);
    expect(lengths[0]).toBeGreaterThanOrEqual(4);
    expect(lengths[0]).toBeLessThanOrEqual(12);
    // 换季时 advance 预生成下一季长度
    const springLen = lengths[0]!;
    sc.advanceBy(springLen); // 越过春 → 夏 r1
    expect(sc.getSeasonLengths()).toHaveLength(2);
    expect(sc.getSeasonLengths()[1]).toBeGreaterThanOrEqual(4);
    expect(sc.getSeasonLengths()[1]).toBeLessThanOrEqual(12);
  });

  it('外部读取季长（UI 模拟）不消耗随机数：同一 seed 后续随机序列不受读取影响（回归保护）', () => {
    // 回归：懒生成季长若由外部读取触发，会消耗共享随机源 → 客户端 UI 局与
    // 服务端纯引擎重放随机序列分叉 → V5 空亡触发点/K 值不同 → replay_rejected。
    const seqAfterRead = (seed: number): number[] => {
      const random = new SeededRandomSource(seed);
      const sc = new SeasonCycle(random, { lazy: true });
      // 模拟 UI：提前读取季长（修复前会额外消耗随机数）
      sc.getCurrentSeasonLength();
      sc.getCurrentSeasonLength();
      void sc;
      // 用同一随机源后续抽 3 个数（模拟抽牌序列）
      return [random.next(), random.next(), random.next()];
    };
    const seqNoRead = (seed: number): number[] => {
      const random = new SeededRandomSource(seed);
      new SeasonCycle(random, { lazy: true });
      // 不读取季长（服务端重放路径）
      return [random.next(), random.next(), random.next()];
    };
    // 修复后：读取季长不消耗随机数 → 两路径后续随机序列一致
    expect(seqAfterRead(42)).toEqual(seqNoRead(42));
    expect(seqAfterRead(99)).toEqual(seqNoRead(99));
  });

  it('换季时才抽取下一季长度（同种子可复现）', () => {
    const lengthsOf = (seed: number): number[] => {
      const sc = new SeasonCycle(new SeededRandomSource(seed), { lazy: true });
      sc.loadState(0, 1, [4, 4]); // 春、夏已确定
      // 跨过春（4）+ 夏（4）→ 进入秋，秋的长度此时才懒生成
      sc.advanceBy(9); // pos 1 → 10，越过春/夏边界后落在秋 r2
      return sc.getSeasonLengths();
    };
    const a = lengthsOf(11);
    const b = lengthsOf(11);
    expect(a).toEqual(b);
    // 跨过后秋的长度已在表中（懒生成完成）
    expect(a).toEqual([4, 4, expect.any(Number)]);
  });

  it('懒生成不按 60 预算 clamp：任何季都从定稿分布抽 4-12（季节时钟无界）', () => {
    const sc = new SeasonCycle(new SeededRandomSource(5), { lazy: true });
    // 春 58 回合（旧 clamp 语义下"剩余预算"只剩 2，会把夏截成 2）
    sc.loadState(0, 1, [58]);
    sc.advanceBy(58); // 穿过春（58），进入夏 r1
    expect(sc.getCurrentSeason()).toBe('summer');
    const summerLen = sc.getCurrentSeasonLength();
    // 无界语义：夏完整从分布抽取（4-12），而不是被预算截断成 2
    expect(summerLen).toBeGreaterThanOrEqual(4);
    expect(summerLen).toBeLessThanOrEqual(12);
    expect(summerLen).not.toBe(2);
    // 继续推进：季节序列不因"总长 60"而终止
    sc.advanceBy(12);
    expect(sc.getCurrentSeasonIndex()).toBeGreaterThan(1);
  });

  it('无界时钟：advanceBy 越过旧 60 上限继续推进（终局由 TurnManager 回合计数决定）', () => {
    const sc = new SeasonCycle(new SeededRandomSource(1), { lazy: true });
    sc.loadState(0, 1, [58, 2]); // 春 58 + 夏 2 = 60（旧 clamp 恰在此拦停）
    sc.advanceBy(60);
    // 无界语义：时钟越过春+夏继续进入下一季（秋 r1），而不是停在 60
    expect(sc.getCurrentSeasonIndex()).toBe(2);
    expect(sc.getCurrentSeason()).toBe('autumn');
    expect(sc.getCurrentRoundInSeason()).toBe(1);
    // 继续推进：时钟仍按规则推进，不被旧 60 上限拦停
    const idxAfter = sc.getCurrentSeasonIndex();
    sc.advanceBy(9);
    expect(
      sc.getCurrentSeasonIndex() > idxAfter ||
      (sc.getCurrentSeasonIndex() === idxAfter && sc.getCurrentRoundInSeason() > 1),
    ).toBe(true);
  });
});

describe('V5 双时钟吞噬 advanceBy', () => {
  it('K 不跨季：季内推进', () => {
    const sc = new SeasonCycle(new SeededRandomSource(1), { lazy: true });
    sc.loadState(0, 1, [12, 12, 12, 12]);
    sc.advanceBy(2);
    expect(sc.getCurrentSeason()).toBe('spring');
    expect(sc.getCurrentRoundInSeason()).toBe(3);
  });

  it('K 跨季边界：吞穿当前季进入下一季', () => {
    const sc = new SeasonCycle(new SeededRandomSource(1), { lazy: true });
    sc.loadState(0, 1, [4, 12, 12, 12]);
    // pos 1 + 5 = 6 → 春(1-4)后进入夏 r2
    sc.advanceBy(5);
    expect(sc.getCurrentSeasonIndex()).toBe(1);
    expect(sc.getCurrentSeason()).toBe('summer');
    expect(sc.getCurrentRoundInSeason()).toBe(2);
  });

  it('K 吞掉紧邻整季：该季元素窗口零回合停留', () => {
    const sc = new SeasonCycle(new SeededRandomSource(1), { lazy: true });
    sc.loadState(0, 1, [4, 4, 12, 12]);
    // pos 1 + 8 = 9 → 春 1-4、夏 1-4 全部跳过，落秋 r1
    sc.advanceBy(8);
    expect(sc.getCurrentSeasonIndex()).toBe(2);
    expect(sc.getCurrentSeason()).toBe('autumn');
    expect(sc.getCurrentRoundInSeason()).toBe(1);
  });

  it('K 连吞两短季：单次跳跃吞掉整个夏+秋', () => {
    const sc = new SeasonCycle(new SeededRandomSource(1), { lazy: true });
    sc.loadState(0, 1, [4, 4, 4, 4]);
    // pos 1 + 12 = 13 → 春尾(1) + 夏全(4) + 秋全(4) + 冬 r1
    sc.advanceBy(12);
    expect(sc.getCurrentSeasonIndex()).toBe(3);
    expect(sc.getCurrentSeason()).toBe('winter');
    expect(sc.getCurrentRoundInSeason()).toBe(1);
  });
});

describe('V1-V4 非懒路径回归（逐字节不变）', () => {
  it('非懒模式仍预生成整局表：总和 60、每段 4-12', () => {
    for (let i = 0; i < 50; i++) {
      const sc = new SeasonCycle(new SeededRandomSource(i));
      const lengths = sc.getSeasonLengths();
      expect(lengths.reduce((sum, len) => sum + len, 0)).toBe(60);
      for (const len of lengths) {
        expect(len).toBeGreaterThanOrEqual(4);
        expect(len).toBeLessThanOrEqual(12);
      }
    }
  });

  it('非懒模式 advance 换季行为不变（含跨季预览）', () => {
    const sc = new SeasonCycle(new SeededRandomSource(1));
    sc.loadState(0, 1, [4, 12, 12, 12]);
    for (let i = 1; i < 4; i++) {
      expect(sc.advance()).toBe(false);
    }
    expect(sc.advance()).toBe(true); // 春末推进换夏
    expect(sc.getCurrentSeason()).toBe('summer');
    expect(sc.getNextSeason()).toBe('summer');
  });

  it('非懒模式表外幻影季兜底仍为 12（旧行为）', () => {
    const sc = new SeasonCycle(new SeededRandomSource(1));
    sc.loadState(0, 1, [4, 4, 4, 4]);
    // 推过 60 回合总长到达表外索引
    for (let i = 0; i < 59; i++) sc.advance();
    const phantomLength = (sc as unknown as { getCurrentSeasonLength(): number }).getCurrentSeasonLength();
    expect(phantomLength).toBe(12);
  });
});
