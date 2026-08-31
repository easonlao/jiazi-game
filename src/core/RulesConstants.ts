/**
 * 游戏规则语义版本常量与类型定义。
 * 集中管理以切断 GameSaveService 与 BalanceProfile 之间的循环依赖。
 */

export const RULES_BASE = 1;
export const RULES_VERSION_VOLATILE = 2;
export const RULES_VERSION_TRADE = 3;
export const RULES_VERSION_BALANCED_TRADE = 4;
export const RULES_VERSION_VOID = 5;
export const RULES_VERSION_BRANCH_ROLL = 6;
export const RULES_VERSION_TREND_WINDOW = 7;
export const RULES_VERSION_CLEAN_POOL = 8;
export const RULES_VERSION_SINGLE_VOID = 9;
/** V10：干支关系响应——季节目标分以天干先应、地支滞后与关系回归的节奏显现。 */
export const RULES_VERSION_RELATIONSHIP_RESPONSE = 10;
/** 生产默认：V10 干支关系响应；旧版本只按冻结快照解释。 */
export const CURRENT_RULES_VERSION = RULES_VERSION_RELATIONSHIP_RESPONSE;

/** 当前代码可解释的规则版本集合；存档层、引擎层与重放快照共用。 */
export type SupportedRulesVersion =
  | typeof RULES_BASE
  | typeof RULES_VERSION_VOLATILE
  | typeof RULES_VERSION_TRADE
  | typeof RULES_VERSION_BALANCED_TRADE
  | typeof RULES_VERSION_VOID
  | typeof RULES_VERSION_BRANCH_ROLL
  | typeof RULES_VERSION_TREND_WINDOW
  | typeof RULES_VERSION_CLEAN_POOL
  | typeof RULES_VERSION_SINGLE_VOID
  | typeof RULES_VERSION_RELATIONSHIP_RESPONSE;

export function isSupportedRulesVersion(version: unknown): version is SupportedRulesVersion {
  return (
    version === RULES_BASE ||
    version === RULES_VERSION_VOLATILE ||
    version === RULES_VERSION_TRADE ||
    version === RULES_VERSION_BALANCED_TRADE ||
    version === RULES_VERSION_VOID ||
    version === RULES_VERSION_BRANCH_ROLL ||
    version === RULES_VERSION_TREND_WINDOW ||
    version === RULES_VERSION_CLEAN_POOL ||
    version === RULES_VERSION_SINGLE_VOID ||
    version === RULES_VERSION_RELATIONSHIP_RESPONSE
  );
}

export function isTradeRulesVersion(
  version: unknown,
): version is
  | typeof RULES_VERSION_TRADE
  | typeof RULES_VERSION_BALANCED_TRADE
  | typeof RULES_VERSION_VOID
  | typeof RULES_VERSION_BRANCH_ROLL
  | typeof RULES_VERSION_TREND_WINDOW
  | typeof RULES_VERSION_CLEAN_POOL
  | typeof RULES_VERSION_SINGLE_VOID
  | typeof RULES_VERSION_RELATIONSHIP_RESPONSE {
  return (
    version === RULES_VERSION_TRADE ||
    version === RULES_VERSION_BALANCED_TRADE ||
    version === RULES_VERSION_VOID ||
    version === RULES_VERSION_BRANCH_ROLL ||
    version === RULES_VERSION_TREND_WINDOW ||
    version === RULES_VERSION_CLEAN_POOL ||
    version === RULES_VERSION_SINGLE_VOID ||
    version === RULES_VERSION_RELATIONSHIP_RESPONSE
  );
}
