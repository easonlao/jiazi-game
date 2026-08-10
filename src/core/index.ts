export { TurnManager } from './TurnManager';
export type {
  GameState,
  ActionType,
  SettlementDetail,
  MarginCallDetail,
  SettlementPreview,
  SettlementPreviewAction,
  RoundLogEntry,
  DecisionScenario,
  DecisionEntry,
} from './TurnManager';

export { replayGame, ReplayValidationError, MAX_REPLAY_ACTIONS } from './ReplayRunner';
export type { ReplayAction, ReplayRequest, ReplayResult } from './ReplayRunner';

export {
  TRADE_REPLAY_RULES,
  BALANCED_TRADE_REPLAY_RULES,
  CURRENT_REPLAY_RULES,
  cloneReplayRulesSnapshot,
} from './ReplayRules';
export type { ReplayRulesSnapshot } from './ReplayRules';

export { SeasonCycle } from './SeasonCycle';
export type { Season } from './SeasonCycle';

export { QiManager } from './QiManager';
export { ScoreManager } from './ScoreManager';
export { DEFAULT_SCORE_RULES, TRADE_SCORE_RULES, BALANCED_TRADE_SCORE_RULES } from './ScoreManager';
export type { ScoreRules } from './ScoreManager';
export { HandManager } from './HandManager';
export { CardPoolManager } from './CardPoolManager';
export { LeverageCalculator } from './LeverageCalculator';
export { CardDataBank } from './CardDataBank';

export { JiaziCard, Element, YinYang } from './JiaziCard';
export type { JiaziCardData } from './JiaziCard';

export { HandSlot } from './HandSlot';

export { DEFAULT_BALANCE_CONFIG, CANDIDATE_BALANCE_CONFIG } from './BalanceConfig';
export type { BalanceConfig, LeverageTable } from './BalanceConfig';

export { MathRandomSource, SeededRandomSource } from './RandomSource';
export type { RandomSource } from './RandomSource';
export {
  DEFAULT_SCORE_VOLATILITY_CONFIG,
  createScoreVolatilityState,
  BAND_FACTOR,
  relationBand,
  cardAmplitude,
} from './ScoreVolatility';
export type {
  ScoreVolatilityConfig,
  ScoreVolatilitySnapshot,
  VolatilityModel,
  VolatilityTrend,
  RelationBand,
} from './ScoreVolatility';

export {
  GameSaveService,
  CURRENT_SCHEMA_VERSION,
  CURRENT_RULES_VERSION,
  isSupportedRulesVersion,
  isTradeRulesVersion,
  RULES_BASE,
  RULES_VERSION_VOLATILE,
  RULES_VERSION_TRADE,
  RULES_VERSION_BALANCED_TRADE,
} from './GameSaveService';
export type { GameSnapshot, GameSaveLoadError, SupportedRulesVersion, HandSlotSnapshot, SeasonSnapshot, CardPoolSnapshot } from './GameSaveService';

export { LeaderboardService } from './LeaderboardService';
export type { LeaderboardEntry } from './LeaderboardService';

export type { StorageProvider } from './StorageProvider';

export * from './telemetry';

export { LockManager } from './LockManager';
export type { LockManagerDeps } from './LockManager';

export { MarginCallEngine } from './MarginCallEngine';
export type { MarginCallEngineDeps } from './MarginCallEngine';

export { buildProjectedHoldings } from './settlementProjection';
export type { ProjectedHolding } from './settlementProjection';

export {
  isHighScoreCard,
  countLeverageSlots,
  shouldUseLeverage,
  HIGH_SCORE_THRESHOLD,
  MAX_LEVERAGE_SLOTS,
  SECOND_LEVERAGE_MIN_QI,
  SECOND_LEVERAGE_AVOID_SEASON_END,
} from './LeverageStrategy';
export type { LeverageDecisionContext } from './LeverageStrategy';
