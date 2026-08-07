/**
 * 局终评价：境界 + 行为特征画像（分数与行为解耦）
 *
 * 用户方向（2026-08-07）：
 *   - 境界 = 分数结果（运气+实力共同决定），用修仙等级命名（炼气→飞升）
 *   - 行为特征 = 怎么玩的（纯策略画像，与分数无关）
 *   不再把"分数"与"策略级别"完全挂钩（高分可能靠运气，行为才是真相）
 *
 * 境界分档（7 档经典阶梯，用 expert-lock 9 万局分布校准）：
 *   炼气 <1500 / 筑基 1500-2300 / 金丹 2300-2900 / 元婴 2900-3500 /
 *   化神 3500-4300 / 渡劫 4300-4900 / 飞升 4900+
 *   依据：expert-lock P5=2335（会玩下限）P50=3185 P90=3901 P99=4453 P99.9=4859
 *   复核（2026-08-07 终局强制平仓上线后 10000 局）：P5=2316 P50=3177 P90=3910
 *   P99=4464 P99.9=4881——终局强平对分布影响 ±0.5% 内，七档边界保持有效
 *
 * 行为特征四维（全来自真实字段）：
 *   节奏  交易频率 → 勤修/择时而行/静观（纳灵+释灵次数）
 *   进取  燃灵使用 → 进取/稳妥/保守（totalLeverageBuys）
 *   预判  牵神行为 → 未雨绸缪/随缘而动（totalLocks）
 *   风控  反噬与止损 → 稳若磐石/偶有失守/险象环生（marginCallCount + 亏损局）
 */
export interface RealmDef {
  /** 境界名 */
  name: string;
  /** 下限（含） */
  min: number;
  /** 上限（不含，最后一档为 Infinity） */
  max: number;
  /** 修行特征描述 */
  desc: string;
}

/** 七档经典境界阶梯（分数段位=境界，轻设定） */
export const REALMS: RealmDef[] = [
  { name: '炼气', min: 0, max: 1500, desc: '初涉修行，纳灵尚浅' },
  { name: '筑基', min: 1500, max: 2300, desc: '已明弃浊存清之道' },
  { name: '金丹', min: 2300, max: 2900, desc: '金丹初成，可循天时' },
  { name: '元婴', min: 2900, max: 3500, desc: '元婴凝实，驭火有度' },
  { name: '化神', min: 3500, max: 4300, desc: '化神之境，牵神以待' },
  { name: '渡劫', min: 4300, max: 4900, desc: '历劫在即，修为通玄' },
  { name: '飞升', min: 4900, max: Infinity, desc: '天时人和，大道可期' },
];

/** 按分数定境界 */
export function getRealm(score: number): RealmDef {
  return REALMS.find((r) => score >= r.min && score < r.max) ?? REALMS[REALMS.length - 1];
}

/** 行为画像输入（全来自 store 真实字段） */
export interface BehaviorInput {
  /** 纳灵次数 */
  totalBuys: number;
  /** 释灵次数 */
  totalSells: number;
  /** 调息次数 */
  totalWaits: number;
  /** 燃灵（杠杆买入）次数 */
  totalLeverageBuys: number;
  /** 牵神（锁定）次数 */
  totalLocks: number;
  /** 反噬次数 */
  marginCallCount: number;
  /** 最终修为 */
  score: number;
}

export interface BehaviorProfile {
  /** 节奏维度 */
  tempo: { label: string; desc: string };
  /** 进取维度 */
  aggression: { label: string; desc: string };
  /** 预判维度 */
  foresight: { label: string; desc: string };
  /** 风控维度 */
  risk: { label: string; desc: string };
  /** 综合评语（叙事，可复算） */
  verdict: string;
}

/** 节奏：交易频率（纳灵+释灵次数） */
function evalTempo(b: BehaviorInput): { label: string; desc: string } {
  const trades = b.totalBuys + b.totalSells;
  if (trades >= 25) return { label: '勤修不辍', desc: '纳灵释灵频繁，不辍于道' };
  if (trades >= 15) return { label: '张弛有度', desc: '纳灵释灵有节，张弛得宜' };
  if (trades >= 8) return { label: '择时而行', desc: '少动而精，择时而行' };
  return { label: '静观其变', desc: '多静观而少操作，保守蓄力' };
}

/** 进取：燃灵（杠杆）使用 */
function evalAggression(b: BehaviorInput): { label: string; desc: string } {
  if (b.totalLeverageBuys >= 4) return { label: '燃灵进取', desc: '善借燃灵之势，行险求进' };
  if (b.totalLeverageBuys >= 1) return { label: '择机燃灵', desc: '偶燃灵火，有度而进' };
  return { label: '稳守不燃', desc: '不轻燃灵，稳守道基' };
}

/** 预判：牵神（锁定）次数 */
function evalForesight(b: BehaviorInput): { label: string; desc: string } {
  if (b.totalLocks >= 4) return { label: '未雨绸缪', desc: '常牵神以待，预知旺时' };
  if (b.totalLocks >= 1) return { label: '偶有预谋', desc: '偶牵灵气，略窥先机' };
  return { label: '随缘而动', desc: '不牵神预置，随缘而纳' };
}

/** 风控：反噬次数 + 亏损局 */
function evalRisk(b: BehaviorInput): { label: string; desc: string } {
  if (b.marginCallCount === 0) return { label: '稳若磐石', desc: '未遭反噬，心神稳固' };
  if (b.marginCallCount === 1) return { label: '偶有失守', desc: '曾逢反噬，险而能回' };
  if (b.marginCallCount <= 3) return { label: '险象环生', desc: '数度反噬，险象环生' };
  return { label: '九死一生', desc: '屡遭反噬，近乎道崩' };
}

/** 综合评语：按境界 + 四维拼接一段叙事 */
function buildVerdict(realm: RealmDef, b: BehaviorInput): string {
  const tempo = evalTempo(b);
  const aggression = evalAggression(b);
  const foresight = evalForesight(b);
  const risk = evalRisk(b);
  const parts = [tempo.desc, aggression.desc, foresight.desc, risk.desc];
  return `汝${parts.slice(0, 3).join('，')}。${parts[3]}。终至${realm.name}境，${realm.desc}。`;
}

/**
 * 生成局终评价：境界（分数）+ 行为画像（四维）。
 * 纯函数，可单测；输入全来自 store 真实字段。
 */
export function evaluateGame(b: BehaviorInput): { realm: RealmDef; profile: BehaviorProfile } {
  const realm = getRealm(b.score);
  const tempo = evalTempo(b);
  const aggression = evalAggression(b);
  const foresight = evalForesight(b);
  const risk = evalRisk(b);
  return {
    realm,
    profile: {
      tempo,
      aggression,
      foresight,
      risk,
      verdict: buildVerdict(realm, b),
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 决策质量评估（2026-08-07 用户方向，数据定义最优，无循环论证）
//
// 方法：游戏运行时记录每次行动时的「情境 × 实际动作」（decisionLog）。
// 每个情境的"最优动作"由 2 万局蒙特卡罗分析得出（平均分最高的动作）：
//   good_card_available    → buy（好牌当前应纳灵）
//   bad_card_holding       → sell（坏牌在手应释灵止损）
//   future_good_card       → sell（未来好牌，但锁定费拖累，该卖就卖）
//   qi_low                 → wait（神识告急应调息避险）
//   strong_card_leverage   → buy（强牌杠杆应燃灵）
// 决策质量 = 每类情境下选对最优动作的比例 → 反向生成行动建议。
// ═══════════════════════════════════════════════════════════

import type { DecisionEntry } from '@core/index';

/** 各情境的最优动作（数据定义，2 万局蒙特卡罗校准） */
export const OPTIMAL_ACTION: Record<string, string> = {
  good_card_available: 'buy',
  bad_card_holding: 'sell',
  future_good_card: 'sell',
  qi_low: 'wait',
  strong_card_leverage: 'buy',
};

/** 情境中文名 */
export const SCENARIO_LABEL: Record<string, string> = {
  good_card_available: '择机',
  bad_card_holding: '止损',
  future_good_card: '预判',
  qi_low: '避险',
  strong_card_leverage: '进取',
};

/** 情境描述（建议用） */
export const SCENARIO_DESC: Record<string, string> = {
  good_card_available: '好牌当前，当果断纳灵',
  bad_card_holding: '坏牌在手，当弃浊存清（止损）',
  future_good_card: '未来好牌，当顺势而为',
  qi_low: '神识告急，当调息避险',
  strong_card_leverage: '强牌当前，当燃灵进取',
};

/** 单情境决策质量结果 */
export interface ScenarioQuality {
  /** 情境 key */
  scenario: string;
  /** 情境名（如"止损"） */
  label: string;
  /** 遇到次数 */
  total: number;
  /** 做对次数 */
  right: number;
  /** 做对率 0~1 */
  rate: number;
  /** 建议（rate < 0.6 时给） */
  advice: string | null;
}

/**
 * 从决策日志计算五维决策质量。
 * 每类情境：做对率 = 选最优动作次数 / 遇到次数。
 * 建议：做对率 < 60% 的情境给出反向行动建议。
 */
export function evaluateDecisions(decisionLog: DecisionEntry[]): ScenarioQuality[] {
  const stat = new Map<string, { total: number; right: number }>();
  for (const d of decisionLog) {
    const s = stat.get(d.scenario) ?? { total: 0, right: 0 };
    s.total++;
    if (d.action === OPTIMAL_ACTION[d.scenario]) s.right++;
    stat.set(d.scenario, s);
  }
  const result: ScenarioQuality[] = [];
  for (const [scenario, s] of stat) {
    const rate = s.total > 0 ? s.right / s.total : 0;
    result.push({
      scenario,
      label: SCENARIO_LABEL[scenario] ?? scenario,
      total: s.total,
      right: s.right,
      rate,
      advice: rate < 0.6 ? SCENARIO_DESC[scenario] ?? null : null,
    });
  }
  // 按做对率升序（最需要改进的在前）
  result.sort((a, b) => a.rate - b.rate);
  return result;
}

/** 综合决策质量分（0~100，加权：止损/择机权重高） */
export function decisionQualityScore(quality: ScenarioQuality[]): number {
  const weights: Record<string, number> = {
    bad_card_holding: 3,
    good_card_available: 3,
    qi_low: 2,
    future_good_card: 1,
    strong_card_leverage: 1,
  };
  let wSum = 0;
  let score = 0;
  for (const q of quality) {
    const w = weights[q.scenario] ?? 1;
    wSum += w;
    score += q.rate * w;
  }
  return wSum > 0 ? Math.round((score / wSum) * 100) : 0;
}

