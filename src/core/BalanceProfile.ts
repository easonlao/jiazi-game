import {
  RULES_VERSION_BALANCED_TRADE,
  RULES_VERSION_BRANCH_ROLL,
  RULES_VERSION_CLEAN_POOL,
  RULES_VERSION_SINGLE_VOID,
  RULES_VERSION_TREND_WINDOW,
  RULES_VERSION_VOID,
  type SupportedRulesVersion,
} from './RulesConstants.ts';
import { type BalanceConfig, DEFAULT_BALANCE_CONFIG } from './BalanceConfig.ts';
import { VOID_CARD_COUNT } from './VoidCard.ts';

export type BalanceProfileId =
  | 'v4_standard'
  | 'v5_standard'
  | 'v6_standard'
  | 'v7_standard'
  | 'v8_standard'
  | 'v9_standard'
  | 'v9_ea_tuned'
  | (string & {});

/**
 * 平衡档案：描述一套独立的数值配置与特征参数，运行在特定 rulesVersion 机制之上。
 * 核心数值参数收拢于只读且不可变的 balanceConfig 快照。
 */
export interface BalanceProfile {
  readonly profileId: BalanceProfileId;
  readonly profileVersion: number;
  readonly rulesVersion: SupportedRulesVersion;
  readonly name?: string;
  readonly label?: string;
  readonly description?: string;
  readonly balanceConfig: Readonly<BalanceConfig>;
  readonly voidCardCount?: number;
}

export const V4_STANDARD_PROFILE: BalanceProfile = Object.freeze({
  profileId: 'v4_standard',
  profileVersion: 1,
  rulesVersion: RULES_VERSION_BALANCED_TRADE,
  name: 'V4 平衡交易标准',
  description: '冲突因子 3，释灵倍率 6',
  balanceConfig: Object.freeze({ ...DEFAULT_BALANCE_CONFIG }),
  voidCardCount: 0,
});

export const V5_STANDARD_PROFILE: BalanceProfile = Object.freeze({
  profileId: 'v5_standard',
  profileVersion: 1,
  rulesVersion: RULES_VERSION_VOID,
  name: 'V5 空亡机制标准',
  description: '3 张空亡牌，懒生成季长，双时钟时间吞噬',
  balanceConfig: Object.freeze({ ...DEFAULT_BALANCE_CONFIG }),
  voidCardCount: 3,
});

export const V6_STANDARD_PROFILE: BalanceProfile = Object.freeze({
  profileId: 'v6_standard',
  profileVersion: 1,
  rulesVersion: RULES_VERSION_BRANCH_ROLL,
  name: 'V6 地支波动标准',
  description: '地支藏干偏移，δ=2',
  balanceConfig: Object.freeze({ ...DEFAULT_BALANCE_CONFIG }),
  voidCardCount: 3,
});

export const V7_STANDARD_PROFILE: BalanceProfile = Object.freeze({
  profileId: 'v7_standard',
  profileVersion: 1,
  rulesVersion: RULES_VERSION_TREND_WINDOW,
  name: 'V7 趋势窗口标准',
  description: '趋势窗口波动模型 + 集中度溢价 k=1',
  balanceConfig: Object.freeze({ ...DEFAULT_BALANCE_CONFIG, concentrationPremiumFactor: 1 }),
  voidCardCount: 2,
});

export const V8_STANDARD_PROFILE: BalanceProfile = Object.freeze({
  profileId: 'v8_standard',
  profileVersion: 1,
  rulesVersion: RULES_VERSION_CLEAN_POOL,
  name: 'V8 牌池守恒标准',
  description: '严格牌池单向守恒与全生命周期归属',
  balanceConfig: Object.freeze({ ...DEFAULT_BALANCE_CONFIG, concentrationPremiumFactor: 1 }),
  voidCardCount: 2,
});

export const V9_STANDARD_PROFILE: BalanceProfile = Object.freeze({
  profileId: 'v9_standard',
  profileVersion: 1,
  rulesVersion: RULES_VERSION_SINGLE_VOID,
  name: 'V9 单空亡标准',
  description: '牌池守恒 + 1 张空亡牌',
  balanceConfig: Object.freeze({ ...DEFAULT_BALANCE_CONFIG, concentrationPremiumFactor: 1 }),
  voidCardCount: VOID_CARD_COUNT,
});

export const V9_EA_TUNED_PROFILE: BalanceProfile = Object.freeze({
  profileId: 'v9_ea_tuned',
  profileVersion: 1,
  rulesVersion: RULES_VERSION_SINGLE_VOID,
  name: 'V9 EA 调优候选档案',
  description: '集中度溢价 k=1.2 与波动平衡调优',
  balanceConfig: Object.freeze({ ...DEFAULT_BALANCE_CONFIG, concentrationPremiumFactor: 1.2 }),
  voidCardCount: VOID_CARD_COUNT,
});

export const V9_EA_CANDIDATE_PROFILE: BalanceProfile = V9_EA_TUNED_PROFILE;

export const EA_DEFAULT_BALANCE_PROFILE: BalanceProfile = V9_STANDARD_PROFILE;

export const SUPPORTED_BALANCE_PROFILES: readonly BalanceProfile[] = Object.freeze([
  V4_STANDARD_PROFILE,
  V5_STANDARD_PROFILE,
  V6_STANDARD_PROFILE,
  V7_STANDARD_PROFILE,
  V8_STANDARD_PROFILE,
  V9_STANDARD_PROFILE,
  V9_EA_TUNED_PROFILE,
]);

export function getBalanceProfileById(profileId: string): BalanceProfile | undefined {
  return SUPPORTED_BALANCE_PROFILES.find((p) => p.profileId === profileId);
}

export function getDefaultBalanceProfileForRules(rulesVersion: number): BalanceProfile | undefined {
  switch (rulesVersion) {
    case RULES_VERSION_BALANCED_TRADE:
      return V4_STANDARD_PROFILE;
    case RULES_VERSION_VOID:
      return V5_STANDARD_PROFILE;
    case RULES_VERSION_BRANCH_ROLL:
      return V6_STANDARD_PROFILE;
    case RULES_VERSION_TREND_WINDOW:
      return V7_STANDARD_PROFILE;
    case RULES_VERSION_CLEAN_POOL:
      return V8_STANDARD_PROFILE;
    case RULES_VERSION_SINGLE_VOID:
      return V9_STANDARD_PROFILE;
    default:
      if (rulesVersion >= RULES_VERSION_SINGLE_VOID) {
        return V9_STANDARD_PROFILE;
      }
      return undefined;
  }
}
