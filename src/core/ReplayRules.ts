import {
  RULES_VERSION_BALANCED_TRADE,
  RULES_VERSION_BRANCH_ROLL,
  RULES_VERSION_CLEAN_POOL,
  RULES_VERSION_SINGLE_VOID,
  RULES_VERSION_RELATIONSHIP_RESPONSE,
  RULES_VERSION_TRADE,
  RULES_VERSION_TREND_WINDOW,
  RULES_VERSION_VOID,
  type SupportedRulesVersion,
} from './RulesConstants.ts';
import { BALANCED_TRADE_SCORE_RULES, TRADE_SCORE_RULES, type ScoreRules } from './ScoreManager.ts';
import { BAND_FACTOR, type ScoreVolatilityConfig } from './ScoreVolatility.ts';
import { BRANCH_ROLL_DELTA } from './BranchRoll.ts';
import { VOID_CARD_COUNT } from './VoidCard.ts';
import type { BalanceConfig } from './BalanceConfig.ts';
import {
  type BalanceProfile,
  getBalanceProfileById,
} from './BalanceProfile.ts';

/** 服务端和客户端共同使用的、可序列化的规则快照。 */
export interface ReplayRulesSnapshot {
  rulesVersion: SupportedRulesVersion;
  gameMode: 'volatility_trade';
  volatilityEnabled: true;
  volatility: ScoreVolatilityConfig;
  scoreRules: ScoreRules;
  /** 平衡档案标识（可选：旧存档/历史会话无此字段） */
  balanceProfileId?: string;
  /** 平衡档案版本（可选） */
  balanceProfileVersion?: number;
  /** 平衡数值配置快照（可选） */
  balanceConfig?: Partial<BalanceConfig>;
  /** EA 试验标识（可选：参与试验时记录） */
  experimentId?: string | null;
  /** EA 试验变体标识（可选） */
  variantId?: string | null;
}

/** V3 规则快照冻结值；仅用于旧存档和历史重放兼容。 */
export const TRADE_REPLAY_RULES: ReplayRulesSnapshot = {
  rulesVersion: RULES_VERSION_TRADE,
  gameMode: 'volatility_trade',
  volatilityEnabled: true,
  volatility: {
    enabled: true,
    model: 'conflict_banded',
    minDuration: 1,
    maxDuration: 3,
    maxScoreDelta: 2,
    scale: 4,
    bandFactors: { ...BAND_FACTOR, conflict: 6 },
  },
  scoreRules: { ...TRADE_SCORE_RULES },
};

/** 当前生产 V4：冲突因子 3，释灵系数 6。 */
export const BALANCED_TRADE_REPLAY_RULES: ReplayRulesSnapshot = {
  rulesVersion: RULES_VERSION_BALANCED_TRADE,
  gameMode: 'volatility_trade',
  volatilityEnabled: true,
  volatility: {
    enabled: true,
    model: 'conflict_banded',
    minDuration: 1,
    maxDuration: 3,
    maxScoreDelta: 2,
    scale: 4,
    bandFactors: { ...BAND_FACTOR, conflict: 3 },
  },
  scoreRules: { ...BALANCED_TRADE_SCORE_RULES },
};

/** V5 空亡增量字段（V6 继承同形）。 */
export interface VoidReplayFields {
  /** 空亡牌堆数量（60 甲子 + voidCardCount 张空亡）。 */
  voidCardCount: number;
  /** 空亡时间吞噬 K 下界（含端点）。 */
  voidKMin: number;
  /** 空亡时间吞噬 K 上界（含端点）。 */
  voidKMax: number;
  /** 季节长度懒生成：换季时从种子随机源抽下一季长度。 */
  lazySeason: true;
}

/**
 * V5 空亡规则快照（rulesVersion=5）：V4 计分 + 空亡机制。
 *
 * 在 V4 基础上仅增量附加空亡字段（docs/mechanics.md §9，2026-08-13 定稿）：
 * - voidCardCount：空亡牌堆数量（牌堆 = 60 甲子 + N 空亡）；
 * - voidKMin/voidKMax：空亡时间吞噬 K ~ uniform[voidKMin, voidKMax]（含端点）；
 * - lazySeason：季节长度懒生成（换季时从种子随机源抽下一季长度）。
 * gameMode/volatility/scoreRules 与 V4 同形（V5 计分 = V4 计分，一审 P1-① 定案），
 * volatilityEnabled: true 保持成立。
 */
export interface VoidReplayRulesSnapshot extends ReplayRulesSnapshot, VoidReplayFields {
  rulesVersion: typeof RULES_VERSION_VOID;
}

/** V5 空亡规则快照冻结值；显式实验/后续生产接线用，不改变 CURRENT_REPLAY_RULES。 */
export const VOID_REPLAY_RULES: VoidReplayRulesSnapshot = {
  rulesVersion: RULES_VERSION_VOID,
  gameMode: 'volatility_trade',
  volatilityEnabled: true,
  volatility: {
    ...BALANCED_TRADE_REPLAY_RULES.volatility,
    bandFactors: { ...BALANCED_TRADE_REPLAY_RULES.volatility.bandFactors },
  },
  scoreRules: { ...BALANCED_TRADE_SCORE_RULES },
  voidCardCount: 3,
  voidKMin: 2,
  voidKMax: 8,
  lazySeason: true,
};

/** V6 地支波动的服务端冻结参数（docs/mechanics.md §10，2026-08-15 设计定稿）。 */
export interface BranchRollReplayConfig {
  /** 地支偏移幅度 δ（均匀 ±δ/坐标）。 */
  delta: number;
  /** 地支波动机制开关。 */
  enabled: true;
}

/**
 * V6 地支波动规则快照（rulesVersion=6）：V5 计分 + 地支 roll 一层。
 *
 * 在 V5（VOID_REPLAY_RULES）基础上仅增量附加 branchRoll 字段
 * （docs/mechanics.md §10，2026-08-15 设计定稿）：
 * - delta：地支偏移幅度 δ=2（均匀 ±2/坐标）；
 * - enabled：机制开关（false 时规则版本仍为 6，但 roll 不注入，仅供对照）。
 * gameMode/volatility/scoreRules/空亡字段与 V5 同形（V6 计分 = V5 计分 + roll 一层）。
 */
export interface BranchRollReplayRulesSnapshot extends ReplayRulesSnapshot, VoidReplayFields {
  rulesVersion: typeof RULES_VERSION_BRANCH_ROLL;
  /** 地支波动增量字段。 */
  branchRoll: BranchRollReplayConfig;
}

/** V6 地支波动规则快照冻结值；显式实验/后续生产接线用，不改变 CURRENT_REPLAY_RULES。 */
export const BRANCH_ROLL_REPLAY_RULES: BranchRollReplayRulesSnapshot = {
  rulesVersion: RULES_VERSION_BRANCH_ROLL,
  gameMode: 'volatility_trade',
  volatilityEnabled: true,
  volatility: {
    ...VOID_REPLAY_RULES.volatility,
    bandFactors: { ...VOID_REPLAY_RULES.volatility.bandFactors },
  },
  scoreRules: { ...BALANCED_TRADE_SCORE_RULES },
  voidCardCount: 3,
  voidKMin: 2,
  voidKMax: 8,
  lazySeason: true,
  branchRoll: { delta: 2, enabled: true },
};

/**
 * V7 趋势窗口波动规则快照（rulesVersion=7）：V6 计分 + trend_window 波动模型 + 集中度溢价。
 *
 * 在 V6（BRANCH_ROLL_REPLAY_RULES）基础上仅增量附加 trendWindow 与 concentrationPremiumFactor
 * 字段：volatility.model 切换为 'trend_window'，concentrationPremiumFactor = 1（启用）。
 * 继承 BranchRollReplayRulesSnapshot 的全部字段（含 branchRoll），但 rulesVersion 覆盖为 7。
 */
export interface TrendWindowReplayRulesSnapshot extends Omit<BranchRollReplayRulesSnapshot, 'rulesVersion'> {
  rulesVersion: typeof RULES_VERSION_TREND_WINDOW;
  trendWindow: { enabled: true };
  concentrationPremiumFactor: number;
}

/** V7 趋势窗口波动规则快照冻结值。 */
export const TREND_WINDOW_REPLAY_RULES: TrendWindowReplayRulesSnapshot = {
  ...BRANCH_ROLL_REPLAY_RULES,
  rulesVersion: RULES_VERSION_TREND_WINDOW,
  // V7 已发布对局固定为 2 张，不能随新局默认值漂移。
  voidCardCount: 2,
  volatility: {
    ...BRANCH_ROLL_REPLAY_RULES.volatility,
    model: 'trend_window',
  },
  trendWindow: { enabled: true },
  concentrationPremiumFactor: 1,
};

/**
 * V8 完整牌池守恒快照（rulesVersion=8）：V7 计分 + 严格单向牌池归属与锁定守恒。
 */
export interface CleanPoolReplayRulesSnapshot extends Omit<BranchRollReplayRulesSnapshot, 'rulesVersion'> {
  rulesVersion: typeof RULES_VERSION_CLEAN_POOL;
  trendWindow: { enabled: true };
  concentrationPremiumFactor: number;
}

/** V8 完整牌池守恒规则快照冻结值；生产默认。 */
export const CLEAN_POOL_REPLAY_RULES: CleanPoolReplayRulesSnapshot = {
  ...TREND_WINDOW_REPLAY_RULES,
  rulesVersion: RULES_VERSION_CLEAN_POOL,
  // V8 已发布对局固定为 2 张，不能随新局默认值漂移。
  voidCardCount: 2,
};

/** V9 单空亡平衡快照：继承 V8 完整牌池守恒，供新局使用。 */
export interface SingleVoidReplayRulesSnapshot extends Omit<CleanPoolReplayRulesSnapshot, 'rulesVersion'> {
  rulesVersion: typeof RULES_VERSION_SINGLE_VOID;
}

export const SINGLE_VOID_REPLAY_RULES: SingleVoidReplayRulesSnapshot = {
  ...CLEAN_POOL_REPLAY_RULES,
  rulesVersion: RULES_VERSION_SINGLE_VOID,
  voidCardCount: VOID_CARD_COUNT,
};

/**
 * V10 干支关系响应：保留 V9 的牌池、空亡与交易结算，只替换季内评分的显现节奏。
 * 这不是玩家订单流：状态完全由开季 entry/target、季内进度与既有干支关系推导。
 */
export interface RelationshipResponseReplayRulesSnapshot extends Omit<SingleVoidReplayRulesSnapshot, 'rulesVersion'> {
  rulesVersion: typeof RULES_VERSION_RELATIONSHIP_RESPONSE;
  relationshipResponse: { enabled: true; formulaVersion: 1 };
}

export const RELATIONSHIP_RESPONSE_REPLAY_RULES: RelationshipResponseReplayRulesSnapshot = {
  ...SINGLE_VOID_REPLAY_RULES,
  rulesVersion: RULES_VERSION_RELATIONSHIP_RESPONSE,
  volatility: {
    ...SINGLE_VOID_REPLAY_RULES.volatility,
    model: 'relationship_response',
  },
  relationshipResponse: { enabled: true, formulaVersion: 1 },
};

/**
 * 服务端可创建/校验的新会话规则版本注册表（按版本号升序）。
 *
 * 2026-08-14 用户拍板：生产默认翻转为 V5（空亡）——排行榜清理 V4 旧数据后，
 * 新局统一走空亡规则；V4 保留在注册表内仅用于历史对局解释，不再创建新云端会话。
 * 2026-08-15 新增 V6（地支波动）：注册表内可创建显式实验会话，生产默认不翻转（票 05）。
 * 2026-08-28 新增 V8（牌池守恒）：生产默认翻转为 V8。
 * 2026-08-30 新增 V9（单空亡）：保留 V8，避免改写进行中云端对局的冻结快照。
 */
export const SUPPORTED_REPLAY_RULES: readonly ReplayRulesSnapshot[] = [
  BALANCED_TRADE_REPLAY_RULES,
  VOID_REPLAY_RULES,
  BRANCH_ROLL_REPLAY_RULES,
  TREND_WINDOW_REPLAY_RULES,
  CLEAN_POOL_REPLAY_RULES,
  SINGLE_VOID_REPLAY_RULES,
  RELATIONSHIP_RESPONSE_REPLAY_RULES,
];

/** 按规则版本号取冻结快照；未注册版本返回 undefined（函数层据此拒绝 409/422）。 */
export function getReplayRulesByVersion(version: number): ReplayRulesSnapshot | undefined {
  return SUPPORTED_REPLAY_RULES.find((rules) => rules.rulesVersion === version);
}

/** 新局与服务端新会话使用的当前规则快照（V10：干支关系响应）。 */
export const CURRENT_REPLAY_RULES = RELATIONSHIP_RESPONSE_REPLAY_RULES;

export interface ContractValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * 为指定的平衡档案创建一份冻结快照。
 */
export function createReplayRulesSnapshotForProfile(profile: BalanceProfile): ReplayRulesSnapshot {
  const baseRules = getReplayRulesByVersion(profile.rulesVersion) ?? CURRENT_REPLAY_RULES;
  const snapshot = cloneReplayRulesSnapshot(baseRules);
  snapshot.balanceProfileId = profile.profileId;
  snapshot.balanceProfileVersion = profile.profileVersion;
  const cfg = profile.balanceConfig;
  if (cfg) {
    snapshot.balanceConfig = { ...cfg };
  }
  if (profile.voidCardCount !== undefined && 'voidCardCount' in snapshot) {
    (snapshot as unknown as { voidCardCount: number }).voidCardCount = profile.voidCardCount;
  }
  return snapshot;
}

export function cloneReplayRulesSnapshot<T extends ReplayRulesSnapshot = ReplayRulesSnapshot>(
  source: T = CURRENT_REPLAY_RULES as unknown as T,
): T {
  if (source.rulesVersion >= RULES_VERSION_BRANCH_ROLL && 'branchRoll' in (source as any)) {
    const br = (source as any).branchRoll;
    if (!br || br.delta !== 2 || br.enabled !== true) {
      throw new Error(`branch_roll_rules_mismatch: delta=${br?.delta}, enabled=${br?.enabled}`);
    }
  }

  const base: any = {
    ...source,
    volatility: source.volatility
      ? {
          ...source.volatility,
          bandFactors: (source.volatility as any).bandFactors
            ? { ...(source.volatility as any).bandFactors }
            : undefined,
        }
      : undefined,
    scoreRules: source.scoreRules ? { ...source.scoreRules } : undefined,
    ...((source as any).branchRoll ? { branchRoll: { ...(source as any).branchRoll } } : {}),
    ...((source as any).trendWindow ? { trendWindow: { ...(source as any).trendWindow } } : {}),
    ...((source as any).relationshipResponse ? { relationshipResponse: { ...(source as any).relationshipResponse } } : {}),
    ...(source.balanceConfig ? { balanceConfig: { ...source.balanceConfig } } : {}),
  };
  return base as T;
}

export function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null;
}

export function isReplayRulesSnapshot(val: unknown): val is ReplayRulesSnapshot {
  return isObject(val) && typeof (val as any).rulesVersion === 'number' && Number.isInteger((val as any).rulesVersion);
}

/**
 * 校验传入的 rules_snapshot 是否与指定 rulesVersion 的冻结契约完全一致。
 * - 旧无档案快照：走历史兼容路径（校验 coreSnapshot 与对应版本的 frozenSnapshot）。
 * - 现代平衡档案快照：必须三者（profileId, profileVersion, balanceConfig）俱全，且与注册表档案完全一致。
 */
export function validateRulesSnapshotContract(
  snapshot: unknown,
  expectedRulesVersion?: number,
): ContractValidationResult {
  if (!isObject(snapshot)) {
    return { valid: false, reason: 'Invalid rules snapshot shape' };
  }

  if (typeof (snapshot as any).rulesVersion !== 'number' || !Number.isInteger((snapshot as any).rulesVersion)) {
    return { valid: false, reason: 'Invalid or missing rulesVersion' };
  }

  const version = (snapshot as any).rulesVersion;
  if (expectedRulesVersion !== undefined && version !== expectedRulesVersion) {
    return {
      valid: false,
      reason: `rulesVersion mismatch: expected ${expectedRulesVersion}, got ${version}`,
    };
  }

  const frozen = getReplayRulesByVersion(version);
  if (!frozen) {
    return { valid: false, reason: `Unsupported rulesVersion ${version}` };
  }

  const hasProfileId = snapshot.balanceProfileId !== undefined;
  const hasProfileVersion = snapshot.balanceProfileVersion !== undefined;
  const hasBalanceConfig = snapshot.balanceConfig !== undefined;

  // 1. 无任何档案字段：历史旧档兼容路径
  if (!hasProfileId && !hasProfileVersion && !hasBalanceConfig) {
    const { experimentId, variantId, ...coreSnapshot } = snapshot;
    return deepCompareContract(coreSnapshot, frozen);
  }

  // 2. 一旦出现任何平衡档案字段，必须三者俱全且精确匹配已注册档案契约（新档案强制不可变契约）
  if (!hasProfileId || typeof snapshot.balanceProfileId !== 'string' || snapshot.balanceProfileId.trim().length === 0) {
    return { valid: false, reason: 'Missing or invalid balanceProfileId in modern profile snapshot' };
  }
  if (!hasProfileVersion || typeof snapshot.balanceProfileVersion !== 'number') {
    return { valid: false, reason: 'Missing or invalid balanceProfileVersion in modern profile snapshot' };
  }
  if (!hasBalanceConfig || typeof snapshot.balanceConfig !== 'object' || snapshot.balanceConfig === null) {
    return { valid: false, reason: 'Missing or invalid balanceConfig in modern profile snapshot' };
  }

  const profile = getBalanceProfileById(snapshot.balanceProfileId);
  if (!profile) {
    return { valid: false, reason: `Unsupported balanceProfileId: ${snapshot.balanceProfileId}` };
  }
  if (profile.rulesVersion !== version) {
    return {
      valid: false,
      reason: `balanceProfileId ${snapshot.balanceProfileId} requires rulesVersion ${profile.rulesVersion}, got ${version}`,
    };
  }
  if (snapshot.balanceProfileVersion !== profile.profileVersion) {
    return {
      valid: false,
      reason: `balanceProfileVersion mismatch: expected ${profile.profileVersion}, got ${snapshot.balanceProfileVersion}`,
    };
  }
  if (profile.voidCardCount !== undefined && snapshot.voidCardCount !== profile.voidCardCount) {
    return {
      valid: false,
      reason: `voidCardCount mismatch: expected ${profile.voidCardCount}, got ${snapshot.voidCardCount}`,
    };
  }

  const balanceConfigComparison = deepCompareContract(snapshot.balanceConfig, profile.balanceConfig);
  if (!balanceConfigComparison.valid) {
    return {
      valid: false,
      reason: `balanceConfig mismatch with profile ${profile.profileId}: ${balanceConfigComparison.reason}`,
    };
  }

  // 剥离档案元数据后与核心规则冻结契约深度对比
  const { balanceProfileId, balanceProfileVersion, balanceConfig, experimentId, variantId, ...coreSnapshot } = snapshot;
  return deepCompareContract(coreSnapshot, frozen);
}

function deepCompareContract(snapshot: unknown, frozen: unknown, path = ''): { valid: boolean; reason?: string } {
  if (snapshot === frozen) return { valid: true };
  
  if (!isObject(snapshot) || !isObject(frozen)) {
    return { valid: false, reason: `Mismatch at ${path || 'root'}: expected ${JSON.stringify(frozen)}, got ${JSON.stringify(snapshot)}` };
  }
  
  const frozenKeys = Object.keys(frozen);
  for (const key of frozenKeys) {
    const nextPath = path ? `${path}.${key}` : key;
    if (!(key in snapshot)) {
      return { valid: false, reason: `Missing field at ${nextPath}` };
    }
    const res = deepCompareContract(snapshot[key], frozen[key], nextPath);
    if (!res.valid) return res;
  }
  
  const snapshotKeys = Object.keys(snapshot);
  for (const key of snapshotKeys) {
    if (!(key in frozen)) {
      return { valid: false, reason: `Extra field at ${path ? path + '.' : ''}${key}` };
    }
  }
  
  return { valid: true };
}
