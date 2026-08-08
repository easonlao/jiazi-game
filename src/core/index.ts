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

export { SeasonCycle } from './SeasonCycle';
export type { Season } from './SeasonCycle';

export { QiManager } from './QiManager';
export { ScoreManager } from './ScoreManager';
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

export { GameSaveService } from './GameSaveService';
export type { GameSnapshot, HandSlotSnapshot, SeasonSnapshot, CardPoolSnapshot } from './GameSaveService';

export { LeaderboardService } from './LeaderboardService';
export type { LeaderboardEntry } from './LeaderboardService';

export type { StorageProvider } from './StorageProvider';

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
