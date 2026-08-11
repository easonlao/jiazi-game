import {
  RULES_VERSION_BALANCED_TRADE,
  RULES_VERSION_TRADE,
  type SupportedRulesVersion,
} from './GameSaveService.ts';
import { BALANCED_TRADE_SCORE_RULES, TRADE_SCORE_RULES, type ScoreRules } from './ScoreManager.ts';
import { BAND_FACTOR, type ScoreVolatilityConfig } from './ScoreVolatility.ts';

/** 服务端和客户端共同使用的、可序列化的 V3 规则快照。 */
export interface ReplayRulesSnapshot {
  rulesVersion: SupportedRulesVersion;
  gameMode: 'volatility_trade';
  volatilityEnabled: true;
  volatility: ScoreVolatilityConfig;
  scoreRules: ScoreRules;
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

/** 新局与服务端新会话使用的当前规则快照。 */
export const CURRENT_REPLAY_RULES = BALANCED_TRADE_REPLAY_RULES;

export function cloneReplayRulesSnapshot(
  source: ReplayRulesSnapshot = CURRENT_REPLAY_RULES,
): ReplayRulesSnapshot {
  return {
    ...source,
    volatility: {
      ...source.volatility,
      bandFactors: { ...source.volatility.bandFactors },
    },
    scoreRules: { ...source.scoreRules },
  };
}
