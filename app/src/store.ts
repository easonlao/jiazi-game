import { create } from 'zustand';
import {
  TurnManager,
  SeededRandomSource,
  LeaderboardService,
  Element,
  type GameState,
  type SettlementDetail,
  type SettlementPreview,
  type SettlementPreviewAction,
  type JiaziCard,
  HandSlot,
  type LeaderboardEntry,
  type RoundLogEntry,
  type DecisionEntry,
  isVoidCard,
  BALANCED_TRADE_REPLAY_RULES,
  BRANCH_ROLL_REPLAY_RULES,
  TREND_WINDOW_REPLAY_RULES,
  CURRENT_REPLAY_RULES,
  CLEAN_POOL_REPLAY_RULES,
  VOID_REPLAY_RULES,
  CURRENT_RULES_VERSION,
} from '@core/index';
import {
  diffFxEvents,
  nextBuyFxId,
  nextVoidTriggerId,
  type FxSeasonEvent,
  type FxMarginCallEvent,
  type FxDeltaEvent,
  type FxRoundEvent,
  type FxBuySettlementEvent,
  type FxVoidTriggerEvent,
} from './store/fx-events';
import { captureBuySourceGeometry } from './lib/buySettlementFx';
import { localStorageProvider } from './platform/localStorageProvider';
import { getSupabaseClient } from './platform/supabaseClient';
import {
  NoopAnalyticsBackend,
  SupabaseAnalyticsBackend,
  type AnalyticsBackend,
  type CloudLeaderboardEntry,
  type CloudActiveGameSession,
} from './lib/analyticsBackend';
import {
  TelemetryController,
  type TelemetryControllerState,
  type PendingCorruptedRecoveryRecord,
  writePendingCorruptedRecovery,
  clearPendingCorruptedRecovery,
  readPendingCorruptedRecovery,
} from './lib/telemetryController';
import {
  CultivationLedgerService,
  type CultivationLedgerRecord,
  type CultivationLedgerSummary,
} from './lib/cultivationLedger';
import { buildCultivationProfileSnapshot } from './lib/cultivationProfile';
import {
  isRecordForDisplay,
  type VerificationRecord,
} from './lib/verificationState';
import { LeaderboardRefreshGate } from './lib/leaderboardRefresh';

// 重新导出 FX 事件类型，供 hooks/useScreenShake 等消费者使用
export type { FxSeasonEvent, FxMarginCallEvent, FxDeltaEvent, FxRoundEvent, FxBuySettlementEvent, FxVoidTriggerEvent };

/** 防止 React StrictMode 下 initialize 被重复调用 */
let _initializing = false;

let _telemetryController: TelemetryController | null = null;
let _telemetryInitPromise: Promise<void> | null = null;

export function setTelemetryControllerForTesting(controller: TelemetryController | null): void {
  _telemetryController = controller;
  _telemetryInitPromise = null;
}

const _leaderboardRefreshGate = new LeaderboardRefreshGate();
const _cultivationLedger = new CultivationLedgerService(localStorageProvider);

/**
 * 回合末「锁定牌被自动解锁」事件的 Toast 文案（如「神识难继，灵气甲子自行散去」）。
 * 结算触发后立即展示；随后行动流程再弹「释灵成功/纳灵成功/调息」等反馈文案时，
 * 优先保留本提示，避免关键告警被常规反馈覆盖（玩家感知为"锁定牌无故消失"）。
 * 消费即清空，防止残留到下个回合。
 */
let _pendingAutoUnlockToast: string | null = null;

/**
 * 空亡触发 Toast 累积（票 09 / P1-1）：同一同步吞噬回合内多张空亡牌连续触发时，
 * 合并为一条 Toast 展示——单张牌是「空亡触发！时间被吞噬（春→秋）」（无 K 数值），
 * 多张合并为「N 张空亡连触」（张数可见，不含 K 数值）。口径与看板一致（步数/张数）。
 *
 * flush 时机（P1-1 修复）：引擎在行动内部同步完成吞噬时，onStateChange/onGameEnd
 * 先于 store action 的 _showActionToast 触发；若在那里 flush，空亡 toast 会被同 tick
 * 的「纳灵成功/释灵成功/调息…/一甲子终了」覆盖。因此统一改在各 store action 的
 * _showActionToast 之后显式 flush，使空亡 toast 成为最后一次写入（不被覆盖、不重复）。
 */
let _pendingVoidToasts: { k: number; prevSeason: string; nextSeason: string }[] = [];

/**
 * 空亡回合季节跳变抑制（2026-08-14 用户拍板）：空亡吞噬导致季节跳变时，季节本身的变化
 * 已由空亡动画表达（阶段 3「跳转到最终季节」），不应再叠加 SeasonTransition 的
 * 「秋去·冬来」。本标志为模块级一次性：onVoidTrigger 置位，_sync 在 diffFxEvents 前
 * 把 prev.season 覆盖为 nextSeason 使季节 diff 不产生 seasonEvent，随即清位——
 * 后续普通换季的 _sync 照常生成 seasonEvent；同一同步回合内多张空亡连续触发只抑制一次。
 */
let _voidRoundSeasonSuppress = false;

/**
 * 消费并清空空亡触发累积，合并为一条 Toast（无累积时 no-op）。
 * 信息边界（mechanics.md §9 ⑥）：不公布 K 数值，仅事件动画——Toast 只报
 * 「时间被吞噬 + 跳跃季节」，不含 K 数字；多张连续触发时合并为一次（张数可见，
 * 但不含 K 总和，防止玩家从 Toast 反推 K 分布）。
 */
function flushPendingVoidToasts(get: () => GameStore): void {
  if (_pendingVoidToasts.length === 0) return;
  const msg = _pendingVoidToasts.length === 1
    ? `空亡触发！时间被吞噬（${seasonDisplay(_pendingVoidToasts[0]!.prevSeason)}→${seasonDisplay(_pendingVoidToasts[0]!.nextSeason)}）`
    : `空亡触发！${_pendingVoidToasts.length} 张空亡连触（${_pendingVoidToasts
        .map((t) => `${seasonDisplay(t.prevSeason)}→${seasonDisplay(t.nextSeason)}`)
        .join('、')}）`;
  _pendingVoidToasts = [];
  get().showToast(msg);
}

function getTelemetryGameMeta(tm?: TurnManager) {
  const rulesVersion = tm?.getRulesVersion();
  const resolvedRulesVersion = rulesVersion ?? CURRENT_RULES_VERSION;
  const volatility = resolvedRulesVersion !== 1;
  return {
    rules_version: String(resolvedRulesVersion),
    game_mode: volatility ? 'volatility_trade' : 'base',
    volatility_enabled: volatility,
  };
}

function ensureTelemetryInit(): Promise<void> {
  if (!_telemetryController) return Promise.resolve();
  if (!_telemetryInitPromise) {
    _telemetryInitPromise = _telemetryController.init()
      .catch((e) => {
        console.error('[store] 遥测初始化失败:', e);
      });
  }
  return _telemetryInitPromise;
}

function refreshCultivationLedgerSummary(set: StoreSetter): void {
  set({
    cultivationLedgerSummary: _cultivationLedger.getSummary(),
    cultivationLedgerRecords: _cultivationLedger.getRecords(),
  });
}

function refreshCultivationLedgerOverview(set: StoreSetter, get: () => GameStore): void {
  const telemetry = get().telemetryState;
  const identity = telemetry?.identity ?? null;
  const consentGranted = telemetry?.consent?.granted ?? false;
  const telemetryEnabled = telemetry?.telemetryEnabled ?? false;
  const hasCloudIdentity = Boolean(identity && consentGranted && telemetryEnabled);

  const localRecords = _cultivationLedger.getRecords();
  const cloudRecords = telemetry?.cultivationLedger?.records ?? null;
  const tm = get().turnManager;
  const currentRulesVersion = tm?.getRulesVersion() ?? CURRENT_RULES_VERSION;

  const profile = buildCultivationProfileSnapshot(localRecords, cloudRecords, currentRulesVersion, hasCloudIdentity);

  set({
    cultivationLedgerSummary: hasCloudIdentity ? profile.combinedSummary : profile.localSummary,
    cultivationLedgerRecords: _cultivationLedger.getRecords(),
    cultivationLedgerClaimableCount: 0,
  });
}

/** 展示行动反馈 Toast：有自动解锁提示时优先展示并清空，否则用常规文案。 */
function _showActionToast(get: () => GameStore, fallback: string): void {
  const pending = _pendingAutoUnlockToast;
  _pendingAutoUnlockToast = null;
  get().showToast(pending ?? fallback);
}

interface GameStore {
  // 引擎实例
  turnManager: TurnManager | null;

  // 游戏状态
  gameState: GameState;
  currentRound: number;
  season: string;
  roundInSeason: number;
  seasonLength: number;
  /** V6 地支偏移条显示值（12 地支效果值）；非 V6 为 null（票 03）。 */
  branchRollDeltas: Record<string, number> | null;
  qi: number;
  score: number;
  deckSize: number;
  hand: (import('@core/HandSlot').HandSlot | null)[];
  publicCards: JiaziCard[];
  leverageMultiplier: number;
  /** 以下数值来自核心 BalanceConfig，前端渲染一律读取，禁止硬编码 */
  maxQi: number;
  baseRecovery: number;
  waitBonus: number;
  totalRounds: number;
  lastSettlement: SettlementDetail | null;
  /** 回合数据留存（交易看板数据源）：每回合一条已发生事实记录，只读消费 */
  roundLog: RoundLogEntry[];
  /** 决策日志（局终行为评价数据源）：每次行动记录情境×动作，只读消费 */
  decisionLog: DecisionEntry[];
  totalBuys: number;
  totalSells: number;
  totalWaits: number;
  totalLeverageBuys: number;
  /** 锁定次数（行为画像"预判"维度数据源） */
  totalLocks: number;
  marginCallCount: number;
  /** 本局累计炼化收益（ScoreManager.totalHoldEarnings，局终修为构成用） */
  totalHoldEarnings: number;
  /** 本局累计卖出收益（ScoreManager.totalSellEarnings，局终修为构成用） */
  totalSellEarnings: number;
  /** 本局终局出清收益（ScoreManager.totalSettleEarnings，局终修为构成单独展示） */
  totalSettleEarnings: number;
  /** 本局反噬罚分累计（ScoreManager.totalMarginCallPenalty，局终展示反噬扣分用） */
  totalMarginCallPenalty: number;
  /** V5 空亡观测统计（终局结算摘要数据源；V1-V4 恒 0）。 */
  voidStats: { triggers: number; swallowedEvents: number; maxVoidK: number };
  /** 本机修行账本摘要（本地私有，不含动作明细） */
  cultivationLedgerSummary: CultivationLedgerSummary;
  /** 本机修行账本记录（用于档案视图；本地私有） */
  cultivationLedgerRecords: readonly CultivationLedgerRecord[];
  /** 已在云端认领/同步的本机终态记录之外，仍可认领的本机终态记录数。 */
  cultivationLedgerClaimableCount: number;

  // 交互状态
  selectedPublicCard: number;
  selectedHandCard: number;
  useLeverage: boolean;
  /** 锁定中的公共牌 ID（锁定机制：占公共位 + 每张每回合 5 神识） */
  lockedCardIds: number[];
  /** 行动尚未提交时的冻结选择；只在确认后调用核心 execute。 */
  pendingAction: SettlementPreviewAction | null;
  settlementPreview: SettlementPreview | null;

  // Toast
  toast: string | null;

  // ── FX 事件流（动画驱动信号）────────────────────────────
  // 每次 _sync 做状态 diff，值真正变化才产生新事件（id 递增）。
  // 组件只需监听对应字段的 id 变化即可触发动画，天然支持重复触发。
  /** 季节切换：prevSeason → season */
  seasonEvent: FxSeasonEvent | null;
  /** 爆仓强平：携带结算详情 */
  marginCallEvent: FxMarginCallEvent | null;
  /** 分数变化（可正可负） */
  scoreDelta: FxDeltaEvent | null;
  /** 神识变化（可正可负） */
  qiDelta: FxDeltaEvent | null;
  /** 回合推进 */
  roundEvent: FxRoundEvent | null;
  /** 已确认纳灵：在新回合播放公共灵气入丹田动画（跨回合买入结算） */
  buySettlementEvent: FxBuySettlementEvent | null;
  /**
   * V5 空亡触发事件队列（批 2 动画信号；id 递增，每张空亡牌触发 push 一次不覆盖）。
   * 同一吞噬回合多张空亡连触时逐张入队，动画按触发顺序逐张完整播放；全部播完
   * （组件消费 + 最终 onEnd 清空）才恢复游戏状态。
   * ⚠️ P2-2 教训：事件必须存活到组件消费，不得在同步调用栈内清空。
   */
  voidTriggerQueue: FxVoidTriggerEvent[];
  /**
   * 批 2（票 08）空亡动画期间被覆盖前的真实引擎状态（player_action/game_over）。
   * 动画开始（beginVoidRoundAnimation）记录、结束（endVoidRoundAnimation）恢复；
   * 非动画期间为 null。动画期间 gameState 显示 void_round（PublicCards「空亡吞噬中...」、
   * ActionBar 禁用），结束后必须恢复，不得残留（P2-4）。
   */
  _voidAnimationTrueState: GameState | null;
  /**
   * 空亡牌在真实公共牌池中的展示槽位（0/1/2，对应 grid 第 N 位）。
   * 空亡触发动画期间非 null：PublicCards 在该槽位渲染空亡牌与真实公共牌并列
   * （玩家看到「空亡是一张从公共牌池现出的牌」，2026-08-14 用户反馈）；
   * 动画结束（endVoidRoundAnimation）后恢复 null，公共牌池回到引擎真实状态。
   */
  voidPoolSlot: number | null;
  /**
   * 空亡吞噬阶段标志：阶段 2 为 true。VoidPoolCard 据此播放自身溶解动画并
   * 从牌位中心扩散吞噬环（环定位在牌自身容器内，天然与真实牌对齐）；
   * 进入阶段 3（onJump）与动画结束恢复 false。
   */
  voidSwallowing: boolean;

  // 生命周期与暂停/终止
  initialize: () => Promise<void>;
  startGame: (localOnly?: boolean) => Promise<boolean>;
  startLocalGame: () => Promise<boolean>;
  reset: () => void;
  pauseModalOpen: boolean;
  openPauseModal: () => void;
  closePauseModal: () => void;
  pauseGame: () => void;
  terminateGame: (reason?: 'voluntary_termination' | 'new_game_override' | 'reset') => void;

  // 存档恢复
  hasSave: boolean;
  continueGame: () => Promise<boolean>;
  loadGameFromSave: () => Promise<boolean>;
  resumeCloudSession: (session?: CloudActiveGameSession | null) => Promise<boolean>;
  startNewGame: () => Promise<boolean>;

  // 排行榜
  leaderboardEntries: LeaderboardEntry[];
  leaderboardOpen: boolean;
  openLeaderboard: () => void;
  closeLeaderboard: () => void;

  // 跨设备终止冲突处理
  resolveTerminationConflict: (choice: 'resume_cloud' | 'terminate_latest' | 'reset_corrupted') => Promise<boolean>;

  // 遥测（consent/identity；云端未配置时走 no-op，不影响本地游玩）
  telemetryState: TelemetryControllerState | null;
  startingGame: boolean;
  startGameError: string | null;
  /** 云端排行榜（娱乐榜公开字段；云端未配置时为空数组） */
  cloudLeaderboard: CloudLeaderboardEntry[];
  cloudLeaderboardStatus: 'idle' | 'loading' | 'ready' | 'error';
  cloudLeaderboardError: string | null;
  /** 最近一局结束后的云端校验状态（pending/verified/rejected/failed；本地局为 null） */
  verificationState: VerificationRecord | null;
  /** 最近一局结束的会话 id；用于显示守卫，隔离旧局异步回调不污染当前结算展示 */
  _endedSessionId: string | null;
  /** 受损对局免惩罚技术恢复状态 */
  recoveringCorruptedGame: boolean;
  corruptedRecoveryError: string | null;
  pendingCorruptedSessionId: string | null;
  pendingCorruptedRecord: PendingCorruptedRecoveryRecord | null;
  retryCorruptedRecovery: () => Promise<boolean>;

  grantTelemetryConsent: (recoveryCode?: string) => Promise<void>;
  declineTelemetryConsent: () => void;
  provisionPlayer: () => Promise<void>;
  recoverPlayer: (recoveryCode: string) => Promise<boolean>;
  updatePlayerDisplayName: (name: string) => Promise<void>;
  refreshCloudLeaderboard: () => Promise<void>;
  /** 重试最近一局的云端校验（failed/rejected 时有效，不抛错） */
  retryVerification: () => void;

  // 交易看板（行迹）
  dashboardOpen: boolean;
  openDashboard: () => void;
  closeDashboard: () => void;

  // 修行档案
  cultivationProfileOpen: boolean;
  openCultivationProfile: () => void;
  closeCultivationProfile: () => void;

  // 操作
  selectPublicCard: (index: number) => void;
  selectHandCard: (index: number) => void;
  toggleLeverage: () => void;
  executeBuy: () => boolean;
  executeSell: () => boolean;
  executeWait: () => boolean;
  toggleLockCard: (index: number) => void;
  requestBuyPreview: () => void;
  requestSellPreview: () => void;
  requestWaitPreview: () => void;
  cancelSettlementPreview: () => void;
  confirmSettlementPreview: () => boolean;
  /** 批 2（票 08）：空亡动画开始——gameState 覆盖为 void_round（P2-4） */
  beginVoidRoundAnimation: () => void;
  /** 批 2（票 08）：空亡动画结束——恢复引擎真实状态（不得残留） */
  endVoidRoundAnimation: () => void;

  // 预览
  previewBuyCost: (cardIndex: number) => number;
  previewSellInfo: (slotIndex: number) => { score: number; qiChange: number } | null;
  previewHoldEarning: (cardIndex: number) => number;
  previewHoldQiCost: (cardIndex: number) => number;
  /** 预测点「等待」后状态：afterQi 最终神识、持仓耗神、牵神成本与扣除后中间神识。 */
  previewWaitQi: () => {
    afterQi: number;
    holdQiCost: number;
    /** 浓度溢价总耗神（仅 V7 生效；V6 及以下恒 0），UI 拆行展示用。 */
    concentrationPremium: number;
    lockedQiCost: number;
    midQi: number;
    /** 扣除神识后神识归零或为负。 */
    willQiDeplete: boolean;
    /** 有杠杆仓位且神识归零或为负，真实结算会强平。 */
    willMarginCall: boolean;
    hasLeverage: boolean;
  };

  // Toast
  showToast: (msg: string) => void;
  clearToast: () => void;

  // 内部：同步状态
  _sync: () => void;
  // 引擎通知计数器：TurnManager 回调只 +1，React useEffect 监听它再 sync
  tick: number;
}

/**
 * 内部遥测助手：把一次已提交的玩家行动上报为白名单遥测事件
 * （action_buy / action_sell / action_wait / action_lock / action_unlock）。
 * - 无遥测控制器或无活跃会话时静默 no-op，绝不阻塞游戏主流程；
 * - 载荷只含白名单字段，不写恢复码 / token / 整包 roundLog；
 * - 数值优先复用对应回合 roundLog 的"已发生事实"，缺失时回退到行动前快照可直接读取的值，
 *   不复制引擎规则；
 * - round_settled 只在能找到"对应回合"（round === before.currentRound）的 roundLog 时上报。
 */
function recordActionTelemetry(
  before: GameStore,
  after: GameStore,
  tm: TurnManager,
  action: SettlementPreviewAction,
  lockAction?: { type: 'lock' | 'unlock'; card: JiaziCard; cardIndex: number },
  sessionIdOverride?: string | null,
): void {
  const controller = _telemetryController;
  const sessionId = sessionIdOverride === undefined
    ? controller?.getActiveSessionId()
    : sessionIdOverride;
  if (!sessionId || !controller) return;

  const base = {
    session_id: sessionId,
    round: before.currentRound,
    season: before.season,
    qi_before: before.qi,
    qi_after: after.qi,
    score_before: before.score,
    score_after: after.score,
    leverage_multiplier: before.leverageMultiplier,
    public_context: before.publicCards
      .filter(Boolean)
      .slice(0, 3)
      .map((card) => ({
        id: card.id,
        name: card.name,
        score: tm.getCardScore(card, before.season),
      })),
    hand_context: before.hand
      .filter((slot): slot is HandSlot => slot !== null)
      .slice(0, 3)
      .map((slot) => ({
        id: slot.card.id,
        name: slot.card.name,
        score: tm.getCardScore(slot.card, before.season),
        use_leverage: slot.useLeverage,
      })),
  };

  // 锁定/解锁：只上报锁定事件本身，不产生 round_settled。
  if (lockAction) {
    controller.track(
      lockAction.type === 'lock' ? 'action_lock' : 'action_unlock',
      {
        ...base,
        card_id: lockAction.card.id,
        card_name: lockAction.card.name,
        card_index: lockAction.cardIndex,
        replay_action: { type: lockAction.type, cardIndex: lockAction.cardIndex },
      },
    );
    return;
  }

  // 买卖等待：读取最近一条回合记录。roundLog 只读，且必须匹配"本次行动所在回合"，
  // 才能作为已发生事实回填数值；不匹配时回退到行动前快照可直接读取的值。
  const logs = tm.getRoundLog();
  const log = [...logs].reverse().find((entry) => entry.round === before.currentRound) ?? null;

  if (action.type === 'buy') {
    const card = before.publicCards[action.cardIndex];
    if (!card) return;
    const cardScore = log?.actionCardScore ?? tm.getCardScore(card, before.season);
    const volatilityDelta = tm.getCardVolatilityDelta(card);
    controller.track('action_buy', {
      ...base,
      card_index: action.cardIndex,
      card_id: card.id,
      card_name: card.name,
      card_main_element: card.mainElement,
      card_yin_yang: card.yinYang,
      card_score: cardScore,
      base_score: card.getSeasonScore(before.season),
      volatility_delta: volatilityDelta,
      buy_cost: log?.action === 'buy'
        ? Math.abs(log.actionQiChange)
        : tm.previewBuyCost(card, action.leverage),
      use_leverage: action.leverage,
      replay_action: { type: 'buy', cardIndex: action.cardIndex, leverage: action.leverage },
    });
  } else if (action.type === 'sell') {
    const slot = before.hand[action.slotIndex];
    if (!slot) return;
    controller.track('action_sell', {
      ...base,
      slot_index: action.slotIndex,
      card_id: slot.card.id,
      card_name: slot.card.name,
      card_score: log?.action === 'sell' && log.actionCardScore !== null
        ? log.actionCardScore
        : tm.getCardScore(slot.card, before.season),
      buy_score: log?.action === 'sell' && log.buyScore !== null ? log.buyScore : slot.buyScore,
      sell_score: log?.action === 'sell' && log.sellScore !== null ? log.sellScore : tm.previewSellScore(slot),
      use_leverage: slot.useLeverage,
      qi_return: log?.action === 'sell' ? log.actionQiChange : tm.previewSellQiChange(slot),
      replay_action: { type: 'sell', slotIndex: action.slotIndex },
    });
  } else {
    controller.track('action_wait', {
      ...base,
      replay_action: { type: 'wait' },
      ends_game: after.gameState === 'game_over',
    });
  }

  // 回合结算事实：仅在存在"对应回合"roundLog 且含结算明细时上报。
  if (log && log.settlement) {
    controller.track('round_settled', {
      session_id: sessionId,
      round: log.round,
      season: log.season,
      hold_earnings: log.settlement.holdEarnings,
      hold_qi_cost: log.settlement.holdQiCost,
      base_qi_recover: log.settlement.baseQiRecover,
      wait_qi_recover: log.settlement.waitQiRecover,
      margin_call_triggered: log.settlement.marginCallTriggered,
      margin_call_count: after.marginCallCount,
      qi_after: log.settlement.finalQi,
      score_after: log.settlement.finalScore,
    });
  }

  controller.updateSessionProgress({
    rounds: Math.max(0, Math.min(before.currentRound, after.totalRounds)),
    final_score: after.score,
    margin_call_count: after.marginCallCount,
  });
}

type StoreSetter = (patch: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>)) => void;

/** 统一受损对局技术恢复入口：清除存档、立即重置局面并异步等待云端免惩罚确认。 */
export async function handleCorruptedGameRecoveryHelper(
  set: StoreSetter,
  get: () => GameStore,
  source: 'local_save' | 'cloud_session',
  sessionId?: string,
): Promise<false> {
  const tm = get().turnManager;
  const targetSessionId = sessionId
    ?? _telemetryController?.getActiveSessionId()
    ?? _telemetryController?.getState().activeCloudSession?.session_id
    ?? get().telemetryState?.activeCloudSession?.session_id
    ?? null;

  // 1. 同步立即清除坏档、重置引擎与本地状态，使界面立刻回到安全初始状态并展示恢复中，严禁停留在已导入的损坏局！
  tm?.clearSave();
  tm?.reset();
  _cultivationLedger.discardActiveGameWithoutPenalty();
  refreshCultivationLedgerOverview(set, get);

  // 关键持久化：若存在在线会话，写入持久化 pending 标记，确保即使刷新/重进也绝不丢失阻断状态
  const currentIdentity = _telemetryController?.getState().identity ?? get().telemetryState?.identity;
  const playerId = currentIdentity?.player_id;
  const pendingRecord: PendingCorruptedRecoveryRecord | null = targetSessionId
    ? {
        sessionId: targetSessionId,
        playerId,
        source,
        createdAt: new Date().toISOString(),
      }
    : null;

  if (pendingRecord) {
    writePendingCorruptedRecovery(localStorageProvider, pendingRecord);
  }

  set({
    hasSave: false,
    gameState: 'init',
    _endedSessionId: null,
    selectedPublicCard: -1,
    selectedHandCard: -1,
    pendingAction: null,
    settlementPreview: null,
    buySettlementEvent: null,
    voidTriggerQueue: [],
    _voidAnimationTrueState: null,
    recoveringCorruptedGame: true,
    corruptedRecoveryError: null,
    pendingCorruptedSessionId: targetSessionId,
    pendingCorruptedRecord: pendingRecord,
  });
  get()._sync();

  // 2. 异步等待云端确认为 corrupted_recovery 终态
  let ok = false;
  if (!targetSessionId) {
    // 纯离线未立档局，无需云端同步
    ok = true;
  } else if (_telemetryController) {
    await ensureTelemetryInit();
    ok = await _telemetryController.discardSessionWithoutPenalty('corrupted_recovery', targetSessionId);
  }

  if (ok) {
    clearPendingCorruptedRecovery(localStorageProvider, playerId);
    set({
      recoveringCorruptedGame: false,
      corruptedRecoveryError: null,
      pendingCorruptedSessionId: null,
      pendingCorruptedRecord: null,
    });
    const msg = source === 'local_save'
      ? '检测到历史存档牌池数据异常，已为您安全重置（本次技术恢复不计入坚持度）'
      : '检测到历史对局牌池数据异常，已为您安全重置（本次技术恢复不计入坚持度）';
    get().showToast(msg);
  } else {
    // 关键防护：若云端更新失败，保留可重试状态与持久化标记，阻断静默进入正常开局
    set({
      recoveringCorruptedGame: false,
      corruptedRecoveryError: '受损对局云端免惩罚确认失败，请重试以保护修行坚持度。',
      pendingCorruptedSessionId: targetSessionId,
      pendingCorruptedRecord: pendingRecord,
    });
    get().showToast('云端对局状态同步失败，请点击重试');
  }
  return false;
}

/** 将游戏生命周期回调绑定到任意 TurnManager，供普通局与服务端 seed 局共用。 */
export function bindTurnManagerCallbacks(tm: TurnManager, set: StoreSetter, get: () => GameStore): void {
  tm.setOnStateChange(() => {
    // 空亡 Toast 不在此 flush：引擎在行动内部同步完成吞噬时，onStateChange 发生在
    // store action 的 _showActionToast 之前，这里 flush 会被同 tick 的 action toast 覆盖。
    // 统一改在各 store action 的 _showActionToast 之后显式 flush（P1-1）。
    set((s) => ({ tick: s.tick + 1 }));
  });
  tm.setOnTurnStart(() => {
    const wasLeverageOn = get().useLeverage;
    set((s) => ({
      tick: s.tick + 1,
      selectedPublicCard: -1,
      selectedHandCard: -1,
      useLeverage: false,
      pendingAction: null,
      settlementPreview: null,
    }));
    if (wasLeverageOn) _pendingAutoUnlockToast = '燃灵已复位（新回合）';
  });
  tm.setOnGameEnd((finalScore) => {
    set((s) => ({ tick: s.tick + 1 }));
    const lb = new LeaderboardService(localStorageProvider, tm.getRulesVersion());
    lb.addEntry(finalScore);
    set({ leaderboardEntries: lb.getEntries() });
    // 记录本局结算展示锚点：云端校验回调只更新这个会话的记录，
    // 旧局/身份切换后的异步回调不会污染本局结算界面。
    const endedSessionId = _telemetryController?.getActiveSessionId() ?? null;
    set({ _endedSessionId: endedSessionId, verificationState: null });
    _telemetryController?.endSession({
      reason: 'game_over',
      rounds: Math.max(0, Math.min(tm.getCurrentRound() - 1, tm.getTotalRounds())),
      final_score: finalScore,
      margin_call_count: tm.getMarginCallCount(),
    });
    _cultivationLedger.completeActiveGame(finalScore);
    refreshCultivationLedgerOverview(set, get);
    tm.clearSave();
    set({ hasSave: false });
    get().showToast(`一甲子终了！最终修为：${finalScore}`);
  });
  tm.setOnLockAutoUnlocked((cardIds) => {
    const names = cardIds.map((id) => tm.getCardById(id)?.name ?? `#${id}`).join('、');
    _pendingAutoUnlockToast = `神识难继，灵气${names}自行散去`;
    get().showToast(_pendingAutoUnlockToast);
  });
  // V5 空亡触发：每张空亡牌掷 K 后调用。Toast 走累积合并（同回合多张连触发），
  // 动画事件逐张 push 入 voidTriggerQueue（id 递增，不覆盖）供批 2 动画队列消费。
  tm.setOnVoidTrigger((info) => {
    // 本次季节跳变由空亡动画表达，抑制随后的 seasonEvent（SeasonTransition 叠加消除）
    _voidRoundSeasonSuppress = true;
    _pendingVoidToasts.push({ k: info.k, prevSeason: info.prevSeason, nextSeason: info.nextSeason });
    // 事件载荷：引擎已给 K 步完整轨迹 + 触发前季内回合数（倒数起点帧数据源）。
    // 逐张 push（同 tick 多张连触各自独立，后触发不覆盖先触发——票 01 队列契约）。
    set((s) => ({
      voidTriggerQueue: [...s.voidTriggerQueue, {
        id: nextVoidTriggerId(),
        k: info.k,
        prevSeason: info.prevSeason,
        prevRoundInSeason: info.prevRoundInSeason,
        nextSeason: info.nextSeason,
        path: info.path,
      }],
      // 空亡牌展示在真实公共牌池第 1 位（与真实公共牌并列，玩家理解「空亡是一张
      // 从公共牌池现出的牌」）；动画结束 endVoidRoundAnimation 时清除恢复真实牌池。
      voidPoolSlot: 0,
      voidSwallowing: false,
    }));
  });
}

export const useGameStore = create<GameStore>((set, get) => ({
  turnManager: null,

  gameState: 'init' as GameState,
  currentRound: 1,
  season: 'spring',
  roundInSeason: 1,
  seasonLength: 12,
  branchRollDeltas: null,
  qi: 80,
  score: 0,
  deckSize: 0,
  hand: [],
  publicCards: [],
  leverageMultiplier: 1,
  maxQi: 80,
  baseRecovery: 10,
  waitBonus: 10,
  totalRounds: 60,
  lastSettlement: null,
  roundLog: [],
  decisionLog: [],
  totalBuys: 0,
  totalSells: 0,
  totalWaits: 0,
  totalLeverageBuys: 0,
  totalLocks: 0,
  marginCallCount: 0,
  totalHoldEarnings: 0,
  totalSellEarnings: 0,
  totalSettleEarnings: 0,
  totalMarginCallPenalty: 0,
  voidStats: { triggers: 0, swallowedEvents: 0, maxVoidK: 0 },
  cultivationLedgerSummary: _cultivationLedger.getSummary(),
  cultivationLedgerRecords: _cultivationLedger.getRecords(),
  cultivationLedgerClaimableCount: 0,

  selectedPublicCard: -1,
  selectedHandCard: -1,
  useLeverage: false,
  lockedCardIds: [],
  pendingAction: null,
  settlementPreview: null,
  toast: null,
  tick: 0,
  hasSave: false,
  leaderboardEntries: [],
  leaderboardOpen: false,
  telemetryState: null,
  startingGame: false,
  startGameError: null,
  cloudLeaderboard: [],
  cloudLeaderboardStatus: 'idle',
  cloudLeaderboardError: null,
  verificationState: null,
  _endedSessionId: null,
  recoveringCorruptedGame: false,
  corruptedRecoveryError: null,
  pendingCorruptedSessionId: null,
  pendingCorruptedRecord: null,
  dashboardOpen: false,
  cultivationProfileOpen: false,
  pauseModalOpen: false,

  // FX 事件（初始为 null，_sync diff 后才会产生）
  seasonEvent: null,
  marginCallEvent: null,
  scoreDelta: null,
  qiDelta: null,
  roundEvent: null,
  buySettlementEvent: null,
  voidTriggerQueue: [],
  _voidAnimationTrueState: null,
  voidPoolSlot: null,
  voidSwallowing: false,

  showToast: (msg: string) => {
    set({ toast: msg });
  },
  clearToast: () => set({ toast: null }),

  _sync() {
    const tm = get().turnManager;
    if (!tm) return;

    // 先捕获旧值，用于 FX 事件 diff
    const prev = get();
    // 空亡动画期间 gameState 被覆盖为 void_round（P2-4），引擎真实状态在
    // _voidAnimationTrueState；此间 _sync 不得用引擎状态覆盖掉动画覆盖层。
    const animatingVoid = prev._voidAnimationTrueState !== null;

    const nextSeason = tm.getCurrentSeason();
    const nextRound = tm.getCurrentRound();
    const nextQi = tm.getQi();
    const nextScore = tm.getScore();
    const nextMarginCallCount = tm.getMarginCallCount();
    const settlement = tm.getLastSettlementDetail();

    set({
      ...(animatingVoid ? {} : { gameState: tm.getState() }),
      currentRound: nextRound,
      season: nextSeason,
      roundInSeason: tm.getCurrentRoundInSeason(),
      seasonLength: tm.getCurrentSeasonLength(),
      branchRollDeltas: tm.getBranchRollDisplayDeltas(),
      qi: nextQi,
      score: nextScore,
      deckSize: tm.getDeckSize(),
      hand: [...tm.getHand()],
      publicCards: [...tm.getPublicCards()],
      leverageMultiplier: tm.getLeverageMultiplier(),
      maxQi: tm.getMaxQi(),
      baseRecovery: tm.getBaseRecovery(),
      waitBonus: tm.getWaitBonus(),
      totalRounds: tm.getTotalRounds(),
      lastSettlement: settlement,
      roundLog: [...tm.getRoundLog()],
      decisionLog: [...tm.getDecisionLog()],
      totalBuys: tm.getTotalBuys(),
      totalSells: tm.getTotalSells(),
      totalWaits: tm.getTotalWaits(),
      totalHoldEarnings: tm.getTotalHoldEarnings(),
      totalSellEarnings: tm.getTotalSellEarnings(),
      totalSettleEarnings: tm.getTotalSettleEarnings(),
      totalMarginCallPenalty: tm.getTotalMarginCallPenalty(),
      totalLeverageBuys: tm.getTotalLeverageBuys(),
      totalLocks: tm.getTotalLocks(),
      marginCallCount: nextMarginCallCount,
      lockedCardIds: tm.getLockedCardIds(),
      voidStats: tm.getVoidStats(),
    });

    // ── FX 事件 diff：委托给 fx-events 模块 ──
    // 空亡吞噬造成的季节跳变由空亡动画表达，抑制本次 seasonEvent（一次性，消费即清）；
    // 覆盖 prev.season 为 nextSeason 使季节 diff 不产生事件，其余 diff（回合/神识等）不受影响。
    const suppressVoidSeason = _voidRoundSeasonSuppress;
    _voidRoundSeasonSuppress = false;
    const fxPatch = diffFxEvents(
      {
        season: suppressVoidSeason ? nextSeason : prev.season,
        round: prev.currentRound,
        qi: prev.qi,
        score: prev.score,
        marginCallCount: prev.marginCallCount,
      },
      {
        season: nextSeason,
        round: nextRound,
        qi: nextQi,
        score: nextScore,
        marginCallCount: nextMarginCallCount,
        settlement,
      },
    );
    if (Object.keys(fxPatch).length > 0) set(fxPatch);
  },

  async initialize() {
    // React StrictMode 在开发模式下会 double-invoke effects，
    // 此 guard 防止异步 initialize 被重复调用导致双重 TurnManager 实例。
    if (_initializing) return;
    _initializing = true;
    try {
      // 本地规则版本选择（配置驱动，符合「环境差异只通过配置驱动」铁律）：
      // 1. `?rules=v4|v5|v6|v7|v8` URL 参数——E2E 用 `?rules=v4` 跑确定性流程回归；E2E / 调试用 `?rules=v8` 显式走 V8 洁净牌池。
      // 2. `VITE_RULES_VERSION=5` env——本地预览 V5 空亡（不进 git 的 .env.local）。
      // 3. 缺省 = 生产默认 CURRENT_REPLAY_RULES（V8，2026-08-28 用户拍板翻转）。
      const urlRules = typeof window !== 'undefined' && window.location
        ? new URLSearchParams(window.location.search).get('rules')
        : null;
      const previewRules = urlRules === 'v4'
        ? BALANCED_TRADE_REPLAY_RULES
        : urlRules === 'v5'
          ? VOID_REPLAY_RULES
          : urlRules === 'v6'
            ? BRANCH_ROLL_REPLAY_RULES
            : urlRules === 'v7'
              ? TREND_WINDOW_REPLAY_RULES
              : urlRules === 'v8'
                ? CLEAN_POOL_REPLAY_RULES
                : import.meta.env.VITE_RULES_VERSION === '5'
                  ? VOID_REPLAY_RULES
                  : CURRENT_REPLAY_RULES;
      const tm = new TurnManager(undefined, undefined, {
        storage: localStorageProvider,
        rulesVersion: previewRules.rulesVersion,
        scoreRules: previewRules.scoreRules,
        volatility: previewRules.volatility,
      });
      await tm.initialize();

      bindTurnManagerCallbacks(tm, set, get);

      set({ turnManager: tm });
      get()._sync();

      // 检测是否有未完成的存档
      const hasSave = tm.hasSave();
      set({ hasSave });
      refreshCultivationLedgerOverview(set, get);

      // 遥测控制器：云端未配置时走 NoopAnalyticsBackend，绝不阻塞游戏初始化。
      if (!_telemetryController) {
        const supabase = getSupabaseClient();
        const backend: AnalyticsBackend = supabase
          ? new SupabaseAnalyticsBackend(supabase)
          : new NoopAnalyticsBackend();
        _telemetryController = new TelemetryController({
          storage: localStorageProvider,
          backend,
          onStateChange: (state) => {
            const prevIdentity = get().telemetryState?.identity;
            const nextIdentity = state.identity;
            set({ telemetryState: state });
            refreshCultivationLedgerOverview(set, get);
            if (prevIdentity?.player_id !== nextIdentity?.player_id) {
              const pending = readPendingCorruptedRecovery(localStorageProvider, nextIdentity?.player_id);
              if (pending) {
                set({
                  recoveringCorruptedGame: false,
                  corruptedRecoveryError: '检测到未完成的受损对局云端免惩罚确认，请重试同步以保护修行坚持度。',
                  pendingCorruptedSessionId: pending.sessionId,
                  pendingCorruptedRecord: pending,
                });
              } else if (get().corruptedRecoveryError && get().pendingCorruptedSessionId) {
                set({
                  corruptedRecoveryError: null,
                  pendingCorruptedSessionId: null,
                  pendingCorruptedRecord: null,
                });
              }
            }
          },
          // 显示守卫：只展示"当前已结束会话"的校验记录，旧局异步回调不污染新局展示。
          onVerificationChange: (record) => {
            set((s) => (
              isRecordForDisplay(record, s._endedSessionId) ? { verificationState: record } : s
            ));
            if (record.status === 'verified') {
              void get().refreshCloudLeaderboard();
            }
          },
        });
        set({ telemetryState: _telemetryController.getState() });
        refreshCultivationLedgerOverview(set, get);
        void ensureTelemetryInit();
      }

      // 检查是否有未完成的受损对局技术恢复（按当前已立档/默认玩家隔离读取）
      const currentIdentity = _telemetryController?.getState().identity;
      const pendingRecovery = readPendingCorruptedRecovery(localStorageProvider, currentIdentity?.player_id);
      if (pendingRecovery) {
        set({
          recoveringCorruptedGame: false,
          corruptedRecoveryError: '检测到未完成的受损对局云端免惩罚确认，请重试同步以保护修行坚持度。',
          pendingCorruptedSessionId: pendingRecovery.sessionId,
          pendingCorruptedRecord: pendingRecovery,
        });
      }
    } catch (e) {
      console.error('[store] 初始化失败:', e);
    } finally {
      _initializing = false;
    }
  },

  async startGame(localOnly = false) {
    const currentIdentity = _telemetryController?.getState().identity ?? get().telemetryState?.identity;
    const pendingRecovery = readPendingCorruptedRecovery(localStorageProvider, currentIdentity?.player_id);
    if (get().recoveringCorruptedGame) {
      get().showToast('正在进行异常对局安全恢复，请稍候...');
      return false;
    }
    if (pendingRecovery || Boolean(get().corruptedRecoveryError)) {
      get().showToast('存在未完成的技术恢复，请先重试同步以保护坚持度');
      return false;
    }
    const tm = get().turnManager;
    if (!tm || get().startingGame) return false;

    const controller = _telemetryController;
    const telemetryState = controller?.getState() ?? null;
    const shouldAwaitVerifiedStart = !localOnly && telemetryState?.consent?.granted === true;

    set({ startingGame: true, startGameError: null });
    try {
      if (shouldAwaitVerifiedStart && controller) {
        await ensureTelemetryInit();
        const readyState = controller.getState();
        if (!readyState.consent?.granted || !readyState.identity || !readyState.telemetryEnabled) {
          const message = '云端连接失败。可重试，或改为本地开局（本局不上云端榜）。';
          set({ startGameError: message });
          get().showToast('云端连接失败，请重试');
          return false;
        }

        const prepared = await controller.prepareVerifiedSession(getTelemetryGameMeta(tm));
        if (!prepared) {
          const message = '云端连接失败。可重试，或改为本地开局（本局不上云端榜）。';
          set({ startGameError: message });
          get().showToast('云端连接失败，请重试');
          return false;
        }

        const random = new SeededRandomSource(prepared.seed);
        const snapshot = prepared.rules_snapshot;
        const snapshotVoidCardCount = (snapshot as { voidCardCount?: number }).voidCardCount;
        const resolvedVoidCardCount = snapshotVoidCardCount !== undefined
          ? snapshotVoidCardCount
          : (snapshot.rulesVersion >= 5 ? 3 : 0);
        const verifiedTm = new TurnManager(undefined, random, {
          storage: localStorageProvider,
          rulesVersion: snapshot.rulesVersion,
          scoreRules: snapshot.scoreRules,
          volatility: snapshot.volatility,
          volatilityRandom: random,
          voidConfig: { voidCardCount: resolvedVoidCardCount },
        });
        await verifiedTm.initialize();
        if (!controller.startSession(getTelemetryGameMeta(verifiedTm), prepared)) {
          throw new Error('verified-session-start-rejected');
        }

        tm.clearSave();
        set({ hasSave: false, gameState: 'init', _endedSessionId: null, verificationState: null });
        bindTurnManagerCallbacks(verifiedTm, set, get);
        set({ turnManager: verifiedTm });
        verifiedTm.startGame();
        _cultivationLedger.startNewGame(verifiedTm.getRulesVersion(), prepared.session_id);
        refreshCultivationLedgerOverview(set, get);
        get()._sync();
        set({
          selectedPublicCard: -1,
          selectedHandCard: -1,
          useLeverage: false,
          pendingAction: null,
          settlementPreview: null,
          buySettlementEvent: null,
        });
        flushPendingVoidToasts(get);
        return true;
      }

      tm.clearSave();
      set({ hasSave: false, _endedSessionId: null, verificationState: null });
      tm.reset();
      tm.startGame();
      _cultivationLedger.startNewGame(tm.getRulesVersion());
      refreshCultivationLedgerOverview(set, get);
      get()._sync();
      set({
        selectedPublicCard: -1, selectedHandCard: -1, useLeverage: false,
        pendingAction: null, settlementPreview: null, buySettlementEvent: null,
      });
      if (localOnly && telemetryState?.consent?.granted) {
        get().showToast('已开始本地对局，本局不上云端榜');
      }
      flushPendingVoidToasts(get);
      return true;
    } catch (error) {
      console.error('[store] 开局失败:', error);
      controller?.abandonSession('reset');
      const message = localOnly
        ? '本地开局失败，请重试'
        : '云端连接失败。可重试，或改为本地开局（本局不上云端榜）。';
      set({ startGameError: message });
      get().showToast(localOnly ? '本地开局失败，请重试' : '云端连接失败，请重试');
      return false;
    } finally {
      set({ startingGame: false });
    }
  },

  async resumeCloudSession(session?: CloudActiveGameSession | null): Promise<boolean> {
    const cloudSession = session ?? get().telemetryState?.activeCloudSession;
    if (!cloudSession) return false;
    const snapshot = cloudSession.rules_snapshot;
    const snapshotVoidCardCount = (snapshot as { voidCardCount?: number }).voidCardCount;
    const resolvedVoidCardCount = snapshotVoidCardCount !== undefined
      ? snapshotVoidCardCount
      : (snapshot.rulesVersion >= 5 ? 3 : 0);
    const random = new SeededRandomSource(cloudSession.seed);
    const tm = new TurnManager(undefined, random, {
      storage: localStorageProvider,
      rulesVersion: snapshot.rulesVersion,
      scoreRules: snapshot.scoreRules,
      volatility: snapshot.volatility,
      volatilityRandom: random,
      branchRollRandom: random,
      voidConfig: { voidCardCount: resolvedVoidCardCount },
    });
    await tm.initialize();
    bindTurnManagerCallbacks(tm, set, get);
    set({ turnManager: tm });
    tm.startGame();

    // 依序重放云端动作序列，恢复至中断时的精确状态
    for (const action of cloudSession.actions) {
      switch (action.type) {
        case 'buy':
          tm.executeBuy(action.cardIndex, action.leverage);
          break;
        case 'sell':
          tm.executeSell(action.slotIndex);
          break;
        case 'wait':
          tm.executeWait();
          break;
        case 'lock':
          tm.executeLockCard(action.cardIndex);
          break;
        case 'unlock':
          tm.executeUnlockCard(action.cardIndex);
          break;
      }
    }

    // 关键守恒检查：若云端重放后发现牌池重复或守恒破坏，执行免惩罚技术重置
    if (!tm.validateCardPoolIntegrity()) {
      return await handleCorruptedGameRecoveryHelper(set, get, 'cloud_session', cloudSession.session_id);
    }

    tm.saveGame();
    _cultivationLedger.resumeActiveGame(tm.getRulesVersion(), cloudSession.session_id);
    refreshCultivationLedgerOverview(set, get);

    const verifiedStart = {
      session_id: cloudSession.session_id,
      client_session_id: cloudSession.client_session_id,
      started_at: cloudSession.started_at,
      seed: cloudSession.seed,
      rules_snapshot: cloudSession.rules_snapshot,
      session_revision: cloudSession.session_revision,
    };
    _telemetryController?.resumeVerifiedSession(
      getTelemetryGameMeta(tm),
      verifiedStart,
      cloudSession.actions,
      {
        rounds: Math.max(0, tm.getCurrentRound() - 1),
        final_score: tm.getScore(),
        margin_call_count: tm.getMarginCallCount(),
      },
    );

    get()._sync();
    set({
      selectedPublicCard: -1,
      selectedHandCard: -1,
      useLeverage: false,
      pendingAction: null,
      settlementPreview: null,
      buySettlementEvent: null,
      voidTriggerQueue: [],
      _voidAnimationTrueState: null,
      hasSave: false,
    });
    get().showToast('已同步恢复当前修行');
    return true;
  },

  async continueGame(): Promise<boolean> {
    const currentIdentity = _telemetryController?.getState().identity ?? get().telemetryState?.identity;
    const pendingRecovery = readPendingCorruptedRecovery(localStorageProvider, currentIdentity?.player_id);
    if (pendingRecovery || get().recoveringCorruptedGame || Boolean(get().corruptedRecoveryError)) return false;
    const tm = get().turnManager;
    const controller = _telemetryController;
    const identity = controller?.getState().identity;
    const consentGranted = controller?.getState().consent?.granted;
    const telemetryEnabled = controller?.getState().telemetryEnabled;
    const hasCloudIdentity = Boolean(identity && consentGranted && telemetryEnabled);

    // 1. 同设备即时存档优先：若本地存在该局最新存档，直接读档继续，
    // 确保包含尚未 flush 到云端的最新回合与手牌状态，避免从落后的云端动作链重放发生回滚。
    if (tm && tm.hasSave()) {
      const loaded = await get().loadGameFromSave();
      if (loaded && hasCloudIdentity && controller && !controller.getActiveSessionId()) {
        // 关键重绑：页面刷新后 controller.session 为空，若存在活跃云端局，必须重绑云端会话！
        let cloudSession = controller.getState().activeCloudSession;
        if (!cloudSession) {
          cloudSession = await controller.refreshActiveSession();
        }
        if (cloudSession && cloudSession.rounds_completed < 60) {
          const verifiedStart = {
            session_id: cloudSession.session_id,
            client_session_id: cloudSession.client_session_id,
            started_at: cloudSession.started_at,
            seed: cloudSession.seed,
            rules_snapshot: cloudSession.rules_snapshot,
            session_revision: cloudSession.session_revision,
          };
          const ok = controller.resumeVerifiedSession(
            getTelemetryGameMeta(tm),
            verifiedStart,
            cloudSession.actions,
            {
              rounds: Math.max(0, tm.getCurrentRound() - 1),
              final_score: tm.getScore(),
              margin_call_count: tm.getMarginCallCount(),
            },
          );
          if (!ok && controller.getState().error?.includes('冲突')) {
            get().showToast('检测到其他设备操作冲突，已自动同步云端最新修行');
            return get().resumeCloudSession(cloudSession);
          }
        }
      }
      return loaded;
    }

    // 2. 跨设备或本地无存档：从云端活跃局拉取并重放动作链
    if (hasCloudIdentity && controller) {
      let cloudSession = controller.getState().activeCloudSession;
      if (!cloudSession) {
        cloudSession = await controller.refreshActiveSession();
      }
      if (cloudSession && cloudSession.rounds_completed < 60) {
        return get().resumeCloudSession(cloudSession);
      }
    }
    return await get().loadGameFromSave();
  },

  async loadGameFromSave(): Promise<boolean> {
    const tm = get().turnManager;
    if (!tm) return false;
    if (tm.hasSave()) {
      const ok = tm.loadGame();
      if (ok) {
        // 关键守恒检查：若历史存档已被旧版本 bug 污染导致牌池重复或守恒破坏，执行免惩罚技术重置
        if (!tm.validateCardPoolIntegrity()) {
          const cloudSession = get().telemetryState?.activeCloudSession;
          return await handleCorruptedGameRecoveryHelper(set, get, 'local_save', cloudSession?.session_id);
        }

        // 先同步当前状态到加载后的值，避免 diffFxEvents 误触发季节/回合动画
        set({
          season: tm.getCurrentSeason(),
          currentRound: tm.getCurrentRound(),
          qi: tm.getQi(),
          score: tm.getScore(),
          marginCallCount: tm.getMarginCallCount(),
        });
        get()._sync();
        set({ selectedPublicCard: -1, selectedHandCard: -1, useLeverage: false, pendingAction: null, settlementPreview: null, buySettlementEvent: null, voidTriggerQueue: [], _voidAnimationTrueState: null, hasSave: false });
        _cultivationLedger.resumeActiveGame(tm.getRulesVersion());
        refreshCultivationLedgerOverview(set, get);
        // 关键防护：页面刷新后若 controller 内部尚未重绑 session，在此尝试根据已缓存的 activeCloudSession 重绑
        const controller = _telemetryController;
        const identity = controller?.getState().identity;
        const consentGranted = controller?.getState().consent?.granted;
        const telemetryEnabled = controller?.getState().telemetryEnabled;
        const hasCloudIdentity = Boolean(identity && consentGranted && telemetryEnabled);
        const activeCloudSession = controller?.getState().activeCloudSession;
        if (hasCloudIdentity && controller && activeCloudSession && activeCloudSession.rounds_completed < 60 && !controller.getActiveSessionId()) {
          const verifiedStart = {
            session_id: activeCloudSession.session_id,
            client_session_id: activeCloudSession.client_session_id,
            started_at: activeCloudSession.started_at,
            seed: activeCloudSession.seed,
            rules_snapshot: activeCloudSession.rules_snapshot,
          };
          const resumedOk = controller.resumeVerifiedSession(
            getTelemetryGameMeta(tm),
            verifiedStart,
            activeCloudSession.actions,
            {
              rounds: Math.max(0, tm.getCurrentRound() - 1),
              final_score: tm.getScore(),
              margin_call_count: tm.getMarginCallCount(),
            },
          );
          if (!resumedOk && controller.getState().error?.includes('冲突')) {
            get().showToast('检测到其他设备操作冲突，已自动同步云端最新修行');
            void get().resumeCloudSession(activeCloudSession);
            return true;
          }
        }

        const hasActiveCloudSession = Boolean(controller?.getActiveSessionId());
        if (hasActiveCloudSession) {
          get().showToast('已继续当前修行');
        } else {
          get().showToast('已继续本地存档');
        }
        return ok;
      }
    }

    const cloudSession = get().telemetryState?.activeCloudSession;
    if (cloudSession && cloudSession.rounds_completed < 60) {
      void get().resumeCloudSession(cloudSession);
      return true;
    }

    // 读档失败：区分「存档版本过新」、已结束存档与一般失败。
    const loadError = tm.getLastLoadError();
    if (!tm.hasSave()) set({ hasSave: false });
    get().showToast(
      loadError === 'game_over'
        ? '该对局已结束，请开始新游戏'
        : loadError === 'schema_too_new' || loadError === 'rules_version_unsupported'
        ? '存档版本过新，请更新游戏'
        : '读档失败',
    );
    return false;
  },

  startNewGame() {
    return get().startGame();
  },

  startLocalGame() {
    return get().startGame(true);
  },

  openLeaderboard() {
    const lb = new LeaderboardService(
      localStorageProvider,
      get().turnManager?.getRulesVersion() ?? CURRENT_RULES_VERSION,
    );
    set({ leaderboardEntries: lb.getEntries(), leaderboardOpen: true });
  },

  closeLeaderboard() {
    set({ leaderboardOpen: false });
  },

  async grantTelemetryConsent(recoveryCode?: string) {
    await _telemetryController?.grantConsent(recoveryCode);
  },

  declineTelemetryConsent() {
    _telemetryController?.declineConsent();
  },

  async provisionPlayer() {
    await _telemetryController?.provision();
  },

  async recoverPlayer(recoveryCode) {
    const identity = await _telemetryController?.recoverIdentity(recoveryCode);
    return identity !== null && identity !== undefined;
  },

  async updatePlayerDisplayName(name) {
    await _telemetryController?.updateDisplayName(name);
  },



  async refreshCloudLeaderboard() {
    const controller = _telemetryController;
    if (!controller) return;
    const requestId = _leaderboardRefreshGate.begin();
    set({ cloudLeaderboardStatus: 'loading', cloudLeaderboardError: null });
    try {
      const entries = await controller.fetchLeaderboard(
        50,
        String(CURRENT_RULES_VERSION),
      );
      if (!_leaderboardRefreshGate.isCurrent(requestId)) return;
      set({ cloudLeaderboard: entries, cloudLeaderboardStatus: 'ready', cloudLeaderboardError: null });
    } catch {
      if (!_leaderboardRefreshGate.isCurrent(requestId)) return;
      set({ cloudLeaderboardStatus: 'error', cloudLeaderboardError: '云端榜暂时无法刷新' });
    }
  },

  retryVerification() {
    const sessionId = get()._endedSessionId;
    if (!sessionId) return;
    // 状态由 onVerificationChange 回写（重新进入 pending），这里无需手动 set。
    _telemetryController?.retryVerification(sessionId);
  },

  async retryCorruptedRecovery(): Promise<boolean> {
    const preIdentity = _telemetryController?.getState().identity ?? get().telemetryState?.identity;
    const stateRecord = get().pendingCorruptedRecord;

    // 关键前置防护：若当前记录绑定了特定玩家，且当前已有身份但不是该玩家，直接拒绝
    if (stateRecord?.playerId && preIdentity?.player_id && stateRecord.playerId !== preIdentity.player_id) {
      set({
        recoveringCorruptedGame: false,
        corruptedRecoveryError: '此受损对局归属于其他修士，请切换回原身份后再行重试。',
      });
      get().showToast('身份不匹配，请切换原修士身份重试');
      return false;
    }

    set({ recoveringCorruptedGame: true, corruptedRecoveryError: null });
    await ensureTelemetryInit();

    const controller = _telemetryController;
    const currentIdentity = controller?.getState().identity ?? get().telemetryState?.identity;

    // 关键修正：必须在 ensureTelemetryInit 后，重新根据当前身份从 storage 读取对应的 pending 记录
    const pending = readPendingCorruptedRecovery(localStorageProvider, currentIdentity?.player_id)
      ?? (stateRecord && (!stateRecord.playerId || stateRecord.playerId === currentIdentity?.player_id) ? stateRecord : null);

    // 关键隔离防护：若待恢复记录属于玩家 A，但初始化后身份为玩家 B（或无身份），绝不能拿玩家 B 身份去提交玩家 A 的 session！
    if (stateRecord?.playerId && (!currentIdentity?.player_id || stateRecord.playerId !== currentIdentity.player_id)) {
      set({
        recoveringCorruptedGame: false,
        corruptedRecoveryError: '此受损对局归属于其他修士，请切换回原身份后再行重试。',
        pendingCorruptedRecord: stateRecord,
        pendingCorruptedSessionId: stateRecord.sessionId,
      });
      get().showToast('身份不匹配，请切换原修士身份重试');
      return false;
    }

    if (!pending) {
      clearPendingCorruptedRecovery(localStorageProvider, currentIdentity?.player_id);
      set({
        corruptedRecoveryError: null,
        pendingCorruptedSessionId: null,
        pendingCorruptedRecord: null,
        recoveringCorruptedGame: false,
      });
      return true;
    }

    if (!controller || !currentIdentity) {
      set({
        recoveringCorruptedGame: false,
        corruptedRecoveryError: '玩家身份尚未就绪，请检查网络后重试。',
        pendingCorruptedRecord: pending,
        pendingCorruptedSessionId: pending.sessionId,
      });
      get().showToast('玩家身份未就绪，请重试');
      return false;
    }

    const ok = await controller.discardSessionWithoutPenalty('corrupted_recovery', pending.sessionId);
    if (ok) {
      clearPendingCorruptedRecovery(localStorageProvider, currentIdentity.player_id);
      set({
        recoveringCorruptedGame: false,
        corruptedRecoveryError: null,
        pendingCorruptedSessionId: null,
        pendingCorruptedRecord: null,
      });
      get().showToast('受损对局已成功免惩罚重置');
      return true;
    } else {
      set({
        recoveringCorruptedGame: false,
        corruptedRecoveryError: '受损对局云端免惩罚确认失败，请重试以保护修行坚持度。',
        pendingCorruptedSessionId: pending.sessionId,
        pendingCorruptedRecord: pending,
      });
      get().showToast('云端重试失败，请稍后重试');
      return false;
    }
  },

  async resolveTerminationConflict(choice: 'resume_cloud' | 'terminate_latest' | 'reset_corrupted') {
    const controller = _telemetryController;
    const conflict = controller?.getState().terminationConflict ?? get().telemetryState?.terminationConflict;
    if (!controller || !conflict) return false;

    const targetSession = conflict.cloudSession;
    const ok = await controller.resolveTerminationConflict(conflict.sessionId, choice);
    if (!ok) {
      get().showToast('解决冲突失败，请重试');
      return false;
    }

    if (choice === 'resume_cloud') {
      get().showToast('已恢复其他设备的最新对局进度');
      return await get().resumeCloudSession(targetSession);
    } else if (choice === 'reset_corrupted') {
      get().showToast('已安全重置受损对局（免惩罚）');
      return true;
    } else {
      get().showToast('已确认终止最新对局');
      return true;
    }
  },

  openDashboard() {
    set({ dashboardOpen: true });
  },

  closeDashboard() {
    set({ dashboardOpen: false });
  },

  openCultivationProfile() {
    set({ cultivationProfileOpen: true });
  },

  closeCultivationProfile() {
    set({ cultivationProfileOpen: false });
  },

  openPauseModal() {
    set({ pauseModalOpen: true });
  },

  closePauseModal() {
    set({ pauseModalOpen: false });
  },

  pauseGame() {
    const tm = get().turnManager;
    if (!tm) return;
    tm.saveGame();
    set({
      gameState: 'init',
      hasSave: true,
      pauseModalOpen: false,
      selectedPublicCard: -1,
      selectedHandCard: -1,
      useLeverage: false,
      pendingAction: null,
      settlementPreview: null,
    });
    get().showToast('修行已暂存，可在开始页随时继续');
  },

  terminateGame(reason = 'voluntary_termination') {
    const tm = get().turnManager;
    _telemetryController?.abandonSession(reason as any);
    if (tm) {
      tm.clearSave();
      tm.reset();
    }
    _cultivationLedger.abandonActiveGame();
    refreshCultivationLedgerOverview(set, get);
    _pendingAutoUnlockToast = null;
    _pendingVoidToasts = [];
    set({
      gameState: 'init',
      hasSave: false,
      pauseModalOpen: false,
      season: tm ? tm.getCurrentSeason() : 'spring',
      currentRound: tm ? tm.getCurrentRound() : 1,
      roundInSeason: tm ? tm.getCurrentRoundInSeason() : 1,
      qi: tm ? tm.getQi() : 100,
      score: tm ? tm.getScore() : 0,
      marginCallCount: tm ? tm.getMarginCallCount() : 0,
      selectedPublicCard: -1,
      selectedHandCard: -1,
      useLeverage: false,
      pendingAction: null,
      settlementPreview: null,
      lastSettlement: null,
      roundLog: [],
      decisionLog: [],
      _endedSessionId: null,
      verificationState: null,
      seasonEvent: null,
      marginCallEvent: null,
      scoreDelta: null,
      qiDelta: null,
      roundEvent: null,
      buySettlementEvent: null,
      voidTriggerQueue: [],
      _voidAnimationTrueState: null,
      voidPoolSlot: null,
      voidSwallowing: false,
    });
    get().showToast('已主动终止本局修行');
  },

  reset() {
    const tm = get().turnManager;
    if (!tm) return;
    // 遥测：放弃当前会话（无 controller/未同意/无活跃会话时静默 no-op，不阻塞重置）
    _telemetryController?.abandonSession('reset');
    tm.reset();
    _cultivationLedger.abandonActiveGame();
    // 清掉可能残留的自动解锁提示，避免跨局误弹
    _pendingAutoUnlockToast = null;
    // 清掉残留的空亡触发累积，避免跨局误弹合并 Toast
    _pendingVoidToasts = [];
    // 先把引擎重置后的关键值写回 store，再清空 FX 事件。
    // 否则随后的 _sync 会把"重置前的旧季节/分数/神识 vs 重置后的初始值"的差异
    // 误判为新 FX 事件，导致新一局开局误播上一局的换季/得分/回神动画。
    set({
      season: tm ? tm.getCurrentSeason() : 'spring',
      currentRound: tm ? tm.getCurrentRound() : 1,
      roundInSeason: tm ? tm.getCurrentRoundInSeason() : 1,
      qi: tm ? tm.getQi() : 100,
      score: tm ? tm.getScore() : 0,
      marginCallCount: tm ? tm.getMarginCallCount() : 0,
    });
    set({
      selectedPublicCard: -1,
      selectedHandCard: -1,
      useLeverage: false,
      pendingAction: null,
      settlementPreview: null,
      lastSettlement: null,
      roundLog: [],
      decisionLog: [],
      _endedSessionId: null,
      verificationState: null,
      // 清空 FX 事件，避免残留动画在重开时误触发
      seasonEvent: null,
      marginCallEvent: null,
      scoreDelta: null,
      qiDelta: null,
      roundEvent: null,
      buySettlementEvent: null,
      voidTriggerQueue: [],
      // 动画若在重置前未结束，清除覆盖锚点，避免重置后被残留动画恢复成旧局状态
      _voidAnimationTrueState: null,
      // 空亡牌展示槽位同步清除，公共牌池回到真实状态
      voidPoolSlot: null,
      voidSwallowing: false,
    });
    refreshCultivationLedgerOverview(set, get);
    // 同步 TurnManager 重置后的状态（gameState → 'init'），让 UI 回到开始界面
    get()._sync();
  },

  // ── 批 2（票 08）空亡动画的 gameState 覆盖 ──────────────────────
  // 引擎同步流程下 void_round 状态在 UI 不可达（吞噬回合同步完成才 _sync，P2-4）。
  // 动画开始覆盖 gameState 为 void_round（PublicCards「空亡吞噬中...」、ActionBar 禁用），
  // 结束后恢复引擎真实状态（player_action/game_over），不得残留。
  beginVoidRoundAnimation() {
    const tm = get().turnManager;
    // 真实状态以引擎为准（动画开始时引擎已完成同步吞噬，读到的即最终状态）
    const trueState = tm?.getState() ?? get().gameState;
    set({ gameState: 'void_round', _voidAnimationTrueState: trueState });
  },
  endVoidRoundAnimation() {
    const trueState = get()._voidAnimationTrueState;
    set({ _voidAnimationTrueState: null, voidPoolSlot: null, voidSwallowing: false });
    // 仅当仍处于动画覆盖态才恢复（reset/新开局等已把 gameState 改成 init 时不覆盖）
    if (trueState && get().gameState === 'void_round') {
      set({ gameState: trueState });
    }
  },

  selectPublicCard(index) {
    const current = get().selectedPublicCard;
    set({ selectedPublicCard: current === index ? -1 : index });
  },
  selectHandCard(index) {
    const current = get().selectedHandCard;
    set({ selectedHandCard: current === index ? -1 : index });
  },
  toggleLeverage() {
    set((s) => ({ useLeverage: !s.useLeverage }));
  },

  executeBuy() {
    const tm = get().turnManager;
    const idx = get().selectedPublicCard;
    if (!tm || idx < 0) return false;
    const replayAction = { type: 'buy' as const, cardIndex: idx, leverage: get().useLeverage };
    _telemetryController?.recordReplayAction(replayAction);
    const ok = tm.executeBuy(idx, get().useLeverage);
    if (!ok) _telemetryController?.removeLastReplayAction();
    if (ok) {
      set({ selectedPublicCard: -1, useLeverage: false });
      get()._sync();
      _showActionToast(get, '纳灵成功');
      // P1-1：行动推进可能在引擎内部同步触发空亡吞噬，空亡 toast 必须是最后一次写入
      flushPendingVoidToasts(get);
    } else {
      const card = tm.getPublicCards()[idx];
      // P2-3：空亡牌是纯事件牌不可买入，失败原因需明确区分
      get().showToast(isVoidCard(card) ? '空亡牌不可买入（纯事件牌）' : '纳灵失败（丹田满/神识不足）');
    }
    return ok;
  },

  executeSell() {
    const tm = get().turnManager;
    const idx = get().selectedHandCard;
    if (!tm || idx < 0) return false;
    const replayAction = { type: 'sell' as const, slotIndex: idx };
    _telemetryController?.recordReplayAction(replayAction);
    const ok = tm.executeSell(idx);
    if (!ok) _telemetryController?.removeLastReplayAction();
    if (ok) {
      set({ selectedHandCard: -1 });
      get()._sync();
      _showActionToast(get, '释灵成功');
      // P1-1：同上，空亡 toast 最后写入
      flushPendingVoidToasts(get);
    } else {
      get().showToast('释灵失败');
    }
    return ok;
  },

  executeWait() {
    const tm = get().turnManager;
    if (!tm) return false;
    _telemetryController?.recordReplayAction({ type: 'wait' });
    const ok = tm.executeWait();
    if (!ok) _telemetryController?.removeLastReplayAction();
    if (ok) {
      get()._sync();
      // 最后一回合等待 = 直接结束游戏，不产生下回合回神
      if (get().gameState === 'game_over') {
        _showActionToast(get, '一甲子终了');
      } else {
        _showActionToast(get, '调息（下回合额外回神）');
      }
      // P1-1：等待推进可能触发空亡吞噬（含终局路径），空亡 toast 最后写入
      flushPendingVoidToasts(get);
      if (get().gameState === 'game_over') {
        tm.clearSave();
        set({ hasSave: false });
      } else {
        tm.saveGame();
      }
    }
    return ok;
  },

  toggleLockCard(index) {
    const before = get();
    const tm = get().turnManager;
    if (!tm) return;
    const card = tm.getPublicCards()[index];
    if (!card) return;
    const isLocked = tm.isCardLocked(card.id);
    if (isLocked) {
      _telemetryController?.recordReplayAction({ type: 'unlock', cardIndex: index });
      const ok = tm.executeUnlockCard(index);
      if (!ok) _telemetryController?.removeLastReplayAction();
      if (ok) {
        get()._sync();
        recordActionTelemetry(before, get(), tm, { type: 'wait' }, { type: 'unlock', card, cardIndex: index });
        get().showToast('已解锁');
      } else {
        get().showToast('解锁失败');
      }
      return;
    }
    // 锁定动作：按具体失败原因提示（不混合展示多种可能）
    _telemetryController?.recordReplayAction({ type: 'lock', cardIndex: index });
    const result = tm.executeLockCard(index);
    if (!result.ok) _telemetryController?.removeLastReplayAction();
    if (result.ok) {
      get()._sync();
      recordActionTelemetry(before, get(), tm, { type: 'wait' }, { type: 'lock', card, cardIndex: index });
      get().showToast(`已锁定（每回合 -${TurnManager.LOCK_COST_PER_CARD} 神识）`);
      return;
    }
    const msg =
      result.reason === 'qi_insufficient'
        ? '神识不足，无法锁定灵气'
        : result.reason === 'max_reached'
          ? `最多锁定 ${TurnManager.MAX_LOCKED_CARDS} 张灵气`
          : result.reason === 'already_locked'
            ? '该灵气已在锁定中'
            : '无法锁定灵气';
    get().showToast(msg);
  },

  requestBuyPreview() {
    const tm = get().turnManager;
    const cardIndex = get().selectedPublicCard;
    if (!tm || cardIndex < 0) return;
    const action: SettlementPreviewAction = { type: 'buy', cardIndex, leverage: get().useLeverage };
    const preview = tm.previewSettlement(action);
    if (!preview) {
      get().showToast('当前无法纳灵');
      return;
    }
    set({ pendingAction: action, settlementPreview: preview });
  },

  requestSellPreview() {
    const tm = get().turnManager;
    const slotIndex = get().selectedHandCard;
    if (!tm || slotIndex < 0) return;
    const action: SettlementPreviewAction = { type: 'sell', slotIndex };
    const preview = tm.previewSettlement(action);
    if (!preview) {
      get().showToast('当前无法释灵');
      return;
    }
    set({ pendingAction: action, settlementPreview: preview });
  },

  requestWaitPreview() {
    const tm = get().turnManager;
    if (!tm) return;
    const action: SettlementPreviewAction = { type: 'wait' };
    const preview = tm.previewSettlement(action);
    if (!preview) return;
    set({ pendingAction: action, settlementPreview: preview });
  },

  cancelSettlementPreview() {
    set({ pendingAction: null, settlementPreview: null });
  },

  confirmSettlementPreview() {
    const before = get();
    const tm = get().turnManager;
    const action = get().pendingAction;
    if (!tm || !action) return false;
    // 跨回合买入动画：确认前快照公共牌身份与源几何——新回合渲染时公共牌已被移除、
    // 手牌已就位，必须在这一步（DOM 仍含该公共牌）捕获，动画才保留「从原公共位入丹田」的来源感。
    const buySourceCard = action.type === 'buy' ? tm.getPublicCards()[action.cardIndex] : null;
    const buyCapture = action.type === 'buy' && buySourceCard
      ? {
          card: buySourceCard,
          useLeverage: action.leverage,
          wasLocked: tm.isCardLocked(buySourceCard.id),
          source: captureBuySourceGeometry(action.cardIndex),
        }
      : null;
    // 终局行动会在 execute* 内触发 onGameEnd 并清空 controller 的活跃会话；
    // 先保存 session id，确保最终买/卖/等候与回合结算仍能入队。
    const telemetrySessionId = _telemetryController?.getActiveSessionId();

    const replayAction = action.type === 'buy'
      ? { type: 'buy' as const, cardIndex: action.cardIndex, leverage: action.leverage }
      : action.type === 'sell'
        ? { type: 'sell' as const, slotIndex: action.slotIndex }
        : { type: 'wait' as const };
    _telemetryController?.recordReplayAction(replayAction);
    const ok = action.type === 'buy'
      ? tm.executeBuy(action.cardIndex, action.leverage)
      : action.type === 'sell'
        ? tm.executeSell(action.slotIndex)
        : tm.executeWait();
    if (!ok) {
      _telemetryController?.removeLastReplayAction();
      get().showToast('行动提交失败，请返回修改');
      return false;
    }

    const patch: Partial<GameStore> = { pendingAction: null, settlementPreview: null };
    if (action.type === 'buy') {
      patch.selectedPublicCard = -1;
      patch.useLeverage = false;
      _showActionToast(get, '纳灵成功');
    } else if (action.type === 'sell') {
      patch.selectedHandCard = -1;
      _showActionToast(get, '释灵成功');
    } else {
      _showActionToast(get, tm.getState() === 'game_over' ? '一甲子终了' : '调息（下回合额外回神）');
    }
    set(patch);
    get()._sync();
    // P1-1：确认行动推进可能在引擎内部同步触发空亡吞噬（含终局路径），
    // 空亡 toast 必须在 _showActionToast / onGameEnd 的 showToast 之后最后写入。
    flushPendingVoidToasts(get);

    // 确认成功：产生跨回合买入结算事件。耗神取实际行动事实（roundLog 归档的 actionQiChange），
    // 缺失时回退到 preview 口径；与下回合持仓炼化/炼耗完全分离，不做视觉合并。
    if (buyCapture) {
      const targetSlotIndex = tm.getHand().findIndex((slot) => slot?.card.id === buyCapture.card.id);
      const logs = tm.getRoundLog();
      const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;
      const actualBuyCost = lastLog?.action === 'buy' && lastLog.actionCardName === buyCapture.card.name
        ? Math.abs(lastLog.actionQiChange)
        : tm.previewBuyCost(buyCapture.card, buyCapture.useLeverage);
      if (targetSlotIndex >= 0) {
        // 飞行卡面快照（与落定手牌同口径，HandCards 的 score/holdEarning/holdQiCost 一致）：
        // 买入已推进到新回合，取当前 tm 状态评分，玩家确认时预览与落定手牌视觉无缝衔接。
        const flightScore = tm.getCardScore(buyCapture.card, tm.getCurrentSeason());
        const flightNextScore = tm.getCardScore(buyCapture.card, tm.getFollowingSeason());
        const flightLeverage = buyCapture.useLeverage ? tm.getLeverageMultiplier() : 1;
        const flightHoldEarning = tm.previewHoldEarning(flightScore, flightLeverage);
        const flightHoldQiCost = tm.previewHoldQiCost(flightScore, flightLeverage);
        set({
          buySettlementEvent: {
            id: nextBuyFxId(),
            cardId: buyCapture.card.id,
            cardName: buyCapture.card.name,
            tianGan: buyCapture.card.tianGan,
            diZhi: buyCapture.card.diZhi,
            tianGanElement: buyCapture.card.tianGanElement,
            diZhiElement: buyCapture.card.diZhiElement,
            mainElement: buyCapture.card.mainElement,
            yinYang: buyCapture.card.yinYang,
            buyCost: actualBuyCost,
            useLeverage: buyCapture.useLeverage,
            wasLocked: buyCapture.wasLocked,
            score: flightScore,
            nextScore: flightNextScore,
            holdEarning: flightHoldEarning,
            holdQiCost: flightHoldQiCost,
            sourceX: buyCapture.source?.x ?? 0,
            sourceY: buyCapture.source?.y ?? 0,
            slotIndex: targetSlotIndex,
            round: get().currentRound,
          },
        });
      }
    }

    recordActionTelemetry(before, get(), tm, action, undefined, telemetrySessionId);

    // 每次行动后自动存档；终局回调已清除存档，不能把 game_over 快照重新写回。
    if (tm.getState() === 'game_over') {
      tm.clearSave();
      set({ hasSave: false });
    } else {
      tm.saveGame();
    }

    return true;
  },

  previewBuyCost(cardIndex) {
    const tm = get().turnManager;
    const cards = get().publicCards;
    if (!tm || cardIndex < 0 || cardIndex >= cards.length) return 0;
    const card = cards[cardIndex];
    // P2-3：空亡牌是纯事件牌不可买入，成本返回哨兵 -1，ActionBar 据此禁用纳灵按钮
    if (isVoidCard(card)) return -1;
    return tm.previewBuyCost(card, get().useLeverage);
  },

  previewHoldEarning(cardIndex) {
    const tm = get().turnManager;
    const cards = get().publicCards;
    if (!tm || cardIndex < 0 || cardIndex >= cards.length) return 0;
    const card = cards[cardIndex];
    const score = tm.getCardScore(card, tm.getCurrentSeason());
    // 信息边界契约：公共牌面预览只用"当下回合"杠杆倍数（getLeverageMultiplier），
    // 禁用 getSettlementLeverageMultiplier（下回合真实倍数 = 是否换季的代理变量，会泄露换季时机）。
    const leverage = get().useLeverage ? tm.getLeverageMultiplier() : 1;
    return tm.previewHoldEarning(score, leverage);
  },

  previewHoldQiCost(cardIndex) {
    const tm = get().turnManager;
    const cards = get().publicCards;
    if (!tm || cardIndex < 0 || cardIndex >= cards.length) return 0;
    const card = cards[cardIndex];
    const score = tm.getCardScore(card, tm.getCurrentSeason());
    // 同上：当下回合杠杆倍数（信息边界契约 docs/ui-information-boundary.md）
    const leverage = get().useLeverage ? tm.getLeverageMultiplier() : 1;
    return tm.previewHoldQiCost(score, leverage);
  },

  previewSellInfo(slotIndex) {
    const tm = get().turnManager;
    const hand = get().hand;
    if (!tm || slotIndex < 0 || slotIndex >= hand.length || !hand[slotIndex]) return null;
    const slot = hand[slotIndex]!;
    return {
      score: tm.previewSellScore(slot),
      qiChange: tm.previewSellQiChange(slot),
    };
  },

  previewWaitQi() {
    const tm = get().turnManager;
    if (!tm) return {
      afterQi: get().qi, holdQiCost: 0, concentrationPremium: 0, lockedQiCost: 0, midQi: get().qi,
      willQiDeplete: false, willMarginCall: false, hasLeverage: false,
    };

    // 最后一回合：等待会直接结束游戏（advanceTurn → 61 > 60 → endGame），
    // 不会发生下一回合结算或回神，预览必须返回当前神识、零耗神。
    if (get().currentRound >= tm.getTotalRounds()) {
      return {
        afterQi: get().qi, holdQiCost: 0, concentrationPremium: 0, lockedQiCost: 0, midQi: get().qi,
        willQiDeplete: false, willMarginCall: false, hasLeverage: false,
      };
    }

    // 信息边界契约（docs/ui-information-boundary.md）：本方法是"下回合推演"，
    // 必须用"假设不换季"口径——恒定 roundInSeason+1 的杠杆倍数（getNextLeverageNoSeasonChange）、
    // 当前季评分，**不触碰 isSeasonEnd / 下回合季节**。
    // 不复用 previewSettlement（wait 分支）：它用真实下回合倍数 + 下回合季节，
    // 属"是否换季"的代理变量，会泄露换季时机（2026-08-06 issue 03 审计发现）。
    const currentSeason = tm.getCurrentSeason();
    const handSlots = tm.getHand();
    let holdQiCost = 0;
    let concentrationPremium = 0;
    const lockedQiCost = tm.getLockedCardIds().length * TurnManager.LOCK_COST_PER_CARD;
    let hasLeverage = false;
    for (const slot of handSlots) {
      if (!slot) continue;
      const score = tm.getCardScore(slot.card, currentSeason);
      const leverage = slot.useLeverage ? tm.getNextLeverageNoSeasonChange() : 1;
      if (slot.useLeverage) hasLeverage = true;
      const { count, premium } = tm.getConcentrationInfo(slot.card);
      concentrationPremium += premium;
      holdQiCost += tm.previewHoldQiCost(
        score,
        leverage,
        slot.card.tianGanElement === Element.EARTH,
        count,
        tm.getConcentrationPremiumFactor(),
      );
    }
    const qi = get().qi;
    const midQi = qi - holdQiCost - lockedQiCost;
    const willQiDeplete = midQi <= 0;
    const willMarginCall = willQiDeplete && hasLeverage;
    // 强平候选数 > 0 时最终神识取决于被随机强平的仓位（不确定值）；UI 在 willMarginCall 分支不展示该值。
    const afterQi = willMarginCall
      ? midQi
      : Math.min(tm.getMaxQi(), midQi + tm.getBaseRecovery() + tm.getWaitBonus());

    return { afterQi, holdQiCost, concentrationPremium, lockedQiCost, midQi, willQiDeplete, willMarginCall, hasLeverage };
  },
}));

/** 季节英文 → 中文显示 */
export function seasonDisplay(season: string): string {
  const map: Record<string, string> = {
    spring: '春',
    summer: '夏',
    autumn: '秋',
    winter: '冬',
  };
  return map[season] || season;
}
