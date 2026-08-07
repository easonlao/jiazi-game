/**
 * 局终评价（境界+行为特征）纯函数测试。
 *
 * 核心断言：
 * 1. 境界七档边界正确（炼气/筑基/金丹/元婴/化神/渡劫/飞升）
 * 2. 行为四维映射合理（节奏/进取/预判/风控）
 * 3. 评语可复算（同输入同输出）
 */
import { describe, it, expect } from 'vitest';
import { getRealm, evaluateGame, REALMS, evaluateDecisions, decisionQualityScore, type BehaviorInput } from '../../app/src/lib/gameReview';

const base: BehaviorInput = {
  totalBuys: 10,
  totalSells: 8,
  totalWaits: 20,
  totalLeverageBuys: 1,
  totalLocks: 2,
  marginCallCount: 0,
  score: 2000,
};

describe('getRealm 境界分档', () => {
  it('七档阶梯完整', () => {
    expect(REALMS.map((r) => r.name)).toEqual(['炼气', '筑基', '金丹', '元婴', '化神', '渡劫', '飞升']);
  });

  it('边界分数命中正确境界', () => {
    expect(getRealm(0).name).toBe('炼气');
    expect(getRealm(1499).name).toBe('炼气');
    expect(getRealm(1500).name).toBe('筑基');
    expect(getRealm(2299).name).toBe('筑基');
    expect(getRealm(2300).name).toBe('金丹');
    expect(getRealm(2899).name).toBe('金丹');
    expect(getRealm(2900).name).toBe('元婴');
    expect(getRealm(3499).name).toBe('元婴');
    expect(getRealm(3500).name).toBe('化神');
    expect(getRealm(4299).name).toBe('化神');
    expect(getRealm(4300).name).toBe('渡劫');
    expect(getRealm(4899).name).toBe('渡劫');
    expect(getRealm(4900).name).toBe('飞升');
    expect(getRealm(5613).name).toBe('飞升');
  });
});

describe('evaluateGame 行为特征', () => {
  it('勤修 + 择机燃灵 + 偶有预谋 + 稳若磐石', () => {
    const r = evaluateGame({ ...base, totalBuys: 14, totalSells: 10, totalLeverageBuys: 2, totalLocks: 2, marginCallCount: 0 });
    expect(r.profile.tempo.label).toBe('张弛有度');
    expect(r.profile.aggression.label).toBe('择机燃灵');
    expect(r.profile.foresight.label).toBe('偶有预谋');
    expect(r.profile.risk.label).toBe('稳若磐石');
  });

  it('高频交易 → 勤修不辍', () => {
    const r = evaluateGame({ ...base, totalBuys: 20, totalSells: 18 });
    expect(r.profile.tempo.label).toBe('勤修不辍');
  });

  it('低频交易 → 静观其变', () => {
    const r = evaluateGame({ ...base, totalBuys: 3, totalSells: 2 });
    expect(r.profile.tempo.label).toBe('静观其变');
  });

  it('重杠杆 → 燃灵进取', () => {
    const r = evaluateGame({ ...base, totalLeverageBuys: 6 });
    expect(r.profile.aggression.label).toBe('燃灵进取');
  });

  it('多锁定 → 未雨绸缪', () => {
    const r = evaluateGame({ ...base, totalLocks: 6 });
    expect(r.profile.foresight.label).toBe('未雨绸缪');
  });

  it('多次反噬 → 险象环生', () => {
    const r = evaluateGame({ ...base, marginCallCount: 3 });
    expect(r.profile.risk.label).toBe('险象环生');
  });

  it('评语包含境界与行为描述（可复算）', () => {
    const a = evaluateGame(base);
    const b = evaluateGame(base);
    expect(a.profile.verdict).toBe(b.profile.verdict);
    expect(a.profile.verdict).toContain('筑基');
    expect(a.profile.verdict).toContain('纳灵释灵有节');
    expect(a.realm.name).toBe('筑基');
  });
});

describe('evaluateDecisions 决策质量', () => {
  it('止损情境：做对率高 → 无建议', () => {
    const log = [
      { round: 1, scenario: 'bad_card_holding', action: 'sell' },
      { round: 2, scenario: 'bad_card_holding', action: 'sell' },
      { round: 3, scenario: 'bad_card_holding', action: 'sell' },
    ] as any;
    const q = evaluateDecisions(log);
    const stop = q.find((x) => x.scenario === 'bad_card_holding');
    expect(stop!.rate).toBe(1);
    expect(stop!.advice).toBeNull();
  });

  it('择机情境：常错过 → 给建议', () => {
    const log = [
      { round: 1, scenario: 'good_card_available', action: 'wait' },
      { round: 2, scenario: 'good_card_available', action: 'wait' },
      { round: 3, scenario: 'good_card_available', action: 'buy' },
    ] as any;
    const q = evaluateDecisions(log);
    const good = q.find((x) => x.scenario === 'good_card_available');
    expect(good!.rate).toBeCloseTo(0.333);
    expect(good!.advice).toContain('纳灵');
  });

  it('神识告急最优是调息：wait 算做对', () => {
    const log = [
      { round: 1, scenario: 'qi_low', action: 'wait' },
      { round: 2, scenario: 'qi_low', action: 'buy' },
    ] as any;
    const q = evaluateDecisions(log);
    const low = q.find((x) => x.scenario === 'qi_low');
    expect(low!.rate).toBeCloseTo(0.5);
  });

  it('综合分加权（止损权重高）', () => {
    const log = [
      { round: 1, scenario: 'bad_card_holding', action: 'sell' },
      { round: 2, scenario: 'good_card_available', action: 'wait' },
    ] as any;
    const q = evaluateDecisions(log);
    const score = decisionQualityScore(q);
    expect(score).toBe(50);
  });

  it('空日志 → 空结果 + 0 分', () => {
    expect(evaluateDecisions([])).toEqual([]);
    expect(decisionQualityScore([])).toBe(0);
  });
});
