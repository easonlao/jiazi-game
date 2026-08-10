import { RULES_VERSION_TRADE, type SupportedRulesVersion } from './GameSaveService';
import { TRADE_SCORE_RULES, type ScoreRules } from './ScoreManager';
import { BAND_FACTOR, type ScoreVolatilityConfig } from './ScoreVolatility';

/** 服务端和客户端共同使用的、可序列化的 V3 规则快照。 */
export interface ReplayRulesSnapshot {
  rulesVersion: SupportedRulesVersion;
  gameMode: 'volatility_trade';
  volatilityEnabled: true;
  volatility: ScoreVolatilityConfig;
  scoreRules: ScoreRules;
}

/** 当前生产 V3 的唯一规则快照来源；Edge Function 应在会话开始时复制并冻结它。 */
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

export function cloneReplayRulesSnapshot(): ReplayRulesSnapshot {
  return {
    ...TRADE_REPLAY_RULES,
    volatility: {
      ...TRADE_REPLAY_RULES.volatility,
      bandFactors: { ...TRADE_REPLAY_RULES.volatility.bandFactors },
    },
    scoreRules: { ...TRADE_REPLAY_RULES.scoreRules },
  };
}
