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
  /** 炼化收益累计（上限对齐评价用，store 可提供） */
  totalHoldEarnings?: number;
  /** 释灵收益累计（上限对齐评价用） */
  totalSellEarnings?: number;
  /** 出清收益累计（上限对齐评价用） */
  totalSettleEarnings?: number;
  /** 反噬罚分累计（上限对齐评价用） */
  totalMarginCallPenalty?: number;
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
  if (b.marginCallCount === 0) return { label: '稳若磐石', desc: '未遭反噬，神识稳固' };
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
  bad_card_holding: '坏牌在手，当弃浊存清',
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
export function evaluateDecisions(decisionLog: readonly DecisionEntry[]): ScenarioQuality[] {
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

// ═══════════════════════════════════════════════════════════
// 上限对齐评价（2026-08-08 重写，替代旧"情境做对率"决策质量分）
//
// 背景：旧决策质量分 = 情境做对率加权，与最终分数脱钩（高手策略分数 P50≈3164
// 但决策质量分仅 P50≈19）。根因：① 情境阈值与高分机制错位——strong_card_leverage
// 要求 qi>50+cur≥20，而真引擎调参验证的高分路径是 cur≤13 潜力牌 + 季初就杠杆 +
// 持有为主；② 做对率度量"动作是否符合预设表"，不度量收益贡献。
//
// 新方法：六维评价，每个维度直接锚定 2026-08-08 三轮参数扫描 + 20000 局大样本
// 验证过的冲顶机制（最优簇：levThreshold=15 / lockFuturePeak=30 / buyMinCur=13 /
// leverageTiming='any' / 持有为主 / 冲顶局 hold 占比 95%+）。评价度量"行为离上限
// 打法有多近"，靠近上限打法 → 分数高，故评价分与分数强相关（由
// tests/unit/ceiling_validation.test.ts 真引擎实测 Spearman ρ）。
// ═══════════════════════════════════════════════════════════

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 单维度上限对齐结果 */
export interface CeilingDim {
  /** 维度 key */
  key: string;
  /** 维度名（如"炼化为本"） */
  label: string;
  /** 权重（0~1，和为 1） */
  weight: number;
  /** 得分（0~1） */
  score: number;
  /** 行为描述 */
  desc: string;
}

/** 上限对齐评价输入：行为统计 + 决策日志（决策日志缺省时按时序维度中性处理） */
export interface CeilingInput {
  b: BehaviorInput;
  decisionLog?: DecisionEntry[];
}

/**
 * 上限对齐评价：行为与冲顶打法对齐度（0~100）。
 *
 * 六维（权重锚定分数主引擎——炼化收益占绝对主力）：
 *   炼化为本 0.30  收益构成中持有占比（冲顶局 hold≈95%+）
 *   燃灵进取 0.20  好牌杠杆运用率（上限打法：高分牌必杠杆）
 *   燃灵及时 0.15  首次杠杆的季内时机（any：季初就该杠杆，不死等 3.5x）
 *   反噬可承 0.15  爆仓罚分占收益比例（上限打法爆仓率高但罚分被炼化覆盖）
 *   弃浊存清 0.10  坏牌止损做对率
 *   牵神预置 0.10  锁定高峰频率
 */
export function evaluateCeiling(b: BehaviorInput, decisionLog: readonly DecisionEntry[] = []): { dims: CeilingDim[]; total: number } {
  const hold = Math.abs(b.totalHoldEarnings ?? 0);
  const sell = Math.abs(b.totalSellEarnings ?? 0);
  const settle = Math.abs(b.totalSettleEarnings ?? 0);
  const mcPen = Math.abs(b.totalMarginCallPenalty ?? 0);
  const posTotal = hold + sell + settle + mcPen;

  // 1. 炼化为本：持有收益占比（冲顶局 0.95+）× 炼化绝对量门槛（≥1500 才给满占比分，
  //    防止"只买一手牌持有"的摆烂局在占比维度虚高）
  const holdShare = posTotal > 0 ? hold / posTotal : 0;
  const holdScore = clamp01(holdShare / 0.95) * clamp01(hold / 1500);
  const holdDesc = holdScore >= 0.85 ? '炼化为本，收益几近全来自持有'
    : holdScore >= 0.5 ? '炼化为主，偶有释灵'
    : '释灵过频，错失炼化复利';

  // 2. 燃灵进取：杠杆买入占买入比例（上限打法：好牌必杠杆，约 8 成买入杠杆）
  const levRatio = b.totalBuys > 0 ? b.totalLeverageBuys / b.totalBuys : 0;
  const aggScore = clamp01(levRatio / 0.8);
  const aggDesc = aggScore >= 0.8 ? '燃灵进取，好牌必燃灵'
    : aggScore >= 0.4 ? '择机燃灵，收放有度'
    : '少燃灵，收益放大不足';

  // 3. 燃灵及时：strong_card_leverage 情境首次杠杆的季内时机
  //    any 打法允许季初（回合≤5）就杠杆；late 打法死等回合≥8 的 3.5x——大样本证实 any 远优。
  //    未燃灵的局给中性 0.3（"有无杠杆"已由燃灵进取维度度量，此处只评燃灵者的时机早晚，
  //    避免与 leverage 维度共线造成双重惩罚）；档位单调：未燃灵 < 过晚 < 偏晚 < 及时
  const levEntries = decisionLog.filter((d) => d.scenario === 'strong_card_leverage' && d.action === 'buy');
  let timingScore = 0.3;
  if (levEntries.length > 0) {
    const minInSeason = Math.min(...levEntries.map((d) => ((d.round - 1) % 15) + 1));
    timingScore = minInSeason <= 5 ? 1 : minInSeason <= 8 ? 0.75 : minInSeason <= 11 ? 0.55 : 0.4;
  }
  const timingDesc = timingScore >= 0.7 ? '燃灵及时，季初即燃灵'
    : timingScore >= 0.5 ? '燃灵偏晚，仍可'
    : timingScore >= 0.35 ? '燃灵过晚，倍数太贪'
    : '未燃灵，时机无从谈起';

  // 4. 反噬可承：爆仓罚分占收益比例（上限打法 mc%≈80% 但罚分被炼化收益覆盖，冲顶局 mc=0）。
  //    反噬是燃灵的风险——未燃灵谈不上反噬（中性 0.5，不奖励摆烂局"没爆仓"）；
  //    燃灵过则看罚分占比：零罚分（冲顶局）满分，占比越高越不可承。
  //    收益为负是炼化/释灵维度的事，反噬可承只评"燃灵反噬是否伤本"
  const mcScore = b.totalLeverageBuys === 0 ? 0.5
    : mcPen <= 0 ? 1
    : 1 - clamp01(mcPen / Math.max(1, posTotal) / 0.5);
  const mcDesc = mcScore >= 0.8 ? '反噬可承，爆仓不伤大局'
    : mcScore >= 0.4 ? '反噬略重，仍有余力'
    : '反噬伤本，燃灵失控';

  // 5. 弃浊存清：坏牌止损做对率（无坏牌局面中性 0.5）
  const stopEntries = decisionLog.filter((d) => d.scenario === 'bad_card_holding');
  const stopRate = stopEntries.length > 0 ? stopEntries.filter((d) => d.action === 'sell').length / stopEntries.length : 0.5;
  const stopDesc = stopRate >= 0.8 ? '弃浊存清，弃浊果断'
    : stopRate >= 0.5 ? '弃浊偶有迟疑'
    : '浊气缠手，弃之无力';

  // 6. 牵神预置：锁定高峰频率（上限打法 lockFuturePeak=30，best 局 lock=4~9）
  const locks = b.totalLocks;
  const lockScore = locks === 0 ? 0.2 : locks <= 12 ? (locks >= 2 ? 1 : 0.6) : 0.5;
  const lockDesc = lockScore >= 0.8 ? '牵神预置，锁定高峰'
    : lockScore >= 0.4 ? '偶有牵神'
    : '不预置，随缘而纳';

  const dims: CeilingDim[] = [
    { key: 'hold', label: '炼化为本', weight: 0.3, score: holdScore, desc: holdDesc },
    { key: 'leverage', label: '燃灵进取', weight: 0.2, score: aggScore, desc: aggDesc },
    { key: 'timing', label: '燃灵及时', weight: 0.15, score: timingScore, desc: timingDesc },
    { key: 'mc', label: '反噬可承', weight: 0.15, score: mcScore, desc: mcDesc },
    { key: 'stop', label: '弃浊存清', weight: 0.1, score: stopRate, desc: stopDesc },
    { key: 'lock', label: '牵神预置', weight: 0.1, score: lockScore, desc: lockDesc },
  ];
  const total = Math.round(dims.reduce((s, d) => s + d.weight * d.score, 0) * 100);
  return { dims, total };
}

