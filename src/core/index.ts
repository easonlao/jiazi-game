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
  VoidTriggerInfo,
  VoidStep,
} from './TurnManager';

export { replayGame, replayGamePrefix, ReplayValidationError, MAX_REPLAY_ACTIONS } from './ReplayRunner';
export type { ReplayAction, ReplayRequest, ReplayResult } from './ReplayRunner';

export { normalizeVerifiedScore } from './VerifiedScore';

export {
  TRADE_REPLAY_RULES,
  BALANCED_TRADE_REPLAY_RULES,
  VOID_REPLAY_RULES,
  BRANCH_ROLL_REPLAY_RULES,
  TREND_WINDOW_REPLAY_RULES,
  CLEAN_POOL_REPLAY_RULES,
  SINGLE_VOID_REPLAY_RULES,
  RELATIONSHIP_RESPONSE_REPLAY_RULES,
  SUPPORTED_REPLAY_RULES,
  getReplayRulesByVersion,
  CURRENT_REPLAY_RULES,
  cloneReplayRulesSnapshot,
  validateRulesSnapshotContract,
} from './ReplayRules';
export type {
  ReplayRulesSnapshot,
  VoidReplayRulesSnapshot,
  VoidReplayFields,
  BranchRollReplayRulesSnapshot,
  BranchRollReplayConfig,
  TrendWindowReplayRulesSnapshot,
  CleanPoolReplayRulesSnapshot,
  SingleVoidReplayRulesSnapshot,
  RelationshipResponseReplayRulesSnapshot,
} from './ReplayRules';

export { SeasonCycle, LAZY_SEASON_LENGTH_DISTRIBUTION } from './SeasonCycle';
export type { Season, SeasonCycleOptions } from './SeasonCycle';

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

export { VoidCard, isVoidCard, VOID_CARD_ID_START, VOID_CARD_COUNT, VOID_CARD_NAME } from './VoidCard';

export { HandSlot } from './HandSlot';

export { DEFAULT_BALANCE_CONFIG, CANDIDATE_BALANCE_CONFIG } from './BalanceConfig';
export type { BalanceConfig, LeverageTable } from './BalanceConfig';

export {
  V4_STANDARD_PROFILE,
  V5_STANDARD_PROFILE,
  V6_STANDARD_PROFILE,
  V7_STANDARD_PROFILE,
  V8_STANDARD_PROFILE,
  V9_STANDARD_PROFILE,
  V10_RELATIONSHIP_RESPONSE_PROFILE,
  EA_DEFAULT_BALANCE_PROFILE,
  SUPPORTED_BALANCE_PROFILES,
  getBalanceProfileById,
  getDefaultBalanceProfileForRules,
} from './BalanceProfile';
export type { BalanceProfile, BalanceProfileId } from './BalanceProfile';

export {
  assignPlayerToExperiment,
  hashStringToUnitInterval,
  getActiveExperimentForRules,
  validateExperimentConfig,
  REGISTERED_EXPERIMENTS,
} from './ExperimentAssignment';
export type {
  ExperimentConfig,
  ExperimentVariant,
  ExperimentAssignmentResult,
} from './ExperimentAssignment';

export { MathRandomSource, SeededRandomSource } from './RandomSource';
export type { RandomSource } from './RandomSource';
export {
  DEFAULT_SCORE_VOLATILITY_CONFIG,
  createScoreVolatilityState,
  BAND_FACTOR,
  relationBand,
  cardAmplitude,
  pickTrendDirection,
  pickWindowLength,
  getTrendDecayFactor,
  computeTrendDelta,
  createTrendWindowState,
  relationshipResponseScore,
  TREND_WINDOW_WEIGHTS,
  TREND_WINDOW_PROBABILITIES,
  TREND_FLAT_DELTA,
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
  RULES_VERSION_CLEAN_POOL,
  RULES_VERSION_SINGLE_VOID,
  RULES_VERSION_RELATIONSHIP_RESPONSE,
  isSupportedRulesVersion,
  isTradeRulesVersion,
  RULES_BASE,
  RULES_VERSION_VOLATILE,
  RULES_VERSION_TRADE,
  RULES_VERSION_BALANCED_TRADE,
  RULES_VERSION_VOID,
  RULES_VERSION_BRANCH_ROLL,
  RULES_VERSION_TREND_WINDOW,
} from './GameSaveService';
export type {
  GameSnapshot,
  GameSaveLoadError,
  SupportedRulesVersion,
  HandSlotSnapshot,
  SeasonSnapshot,
  CardPoolSnapshot,
  PublicCardHistorySnapshot,
} from './GameSaveService';

export {
  BRANCH_ROLL_DI_ZHI,
  BRANCH_ROLL_DELTA,
  BRANCH_ROLL_NON_EARTH_BASE_COEF,
  BRANCH_ROLL_EARTH_COEF,
  createBranchRollState,
  isValidBranchRollState,
} from './BranchRoll';
export type { BranchRollState } from './BranchRoll';

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
