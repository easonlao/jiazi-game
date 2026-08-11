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
  CURRENT_REPLAY_RULES,
  CURRENT_RULES_VERSION,
} from '@core/index';
import {
  diffFxEvents,
  nextBuyFxId,
  type FxSeasonEvent,
  type FxMarginCallEvent,
  type FxDeltaEvent,
  type FxRoundEvent,
  type FxBuySettlementEvent,
} from './store/fx-events';
import { captureBuySourceGeometry } from './lib/buySettlementFx';
import { localStorageProvider } from './platform/localStorageProvider';
import { getSupabaseClient } from './platform/supabaseClient';
import {
  NoopAnalyticsBackend,
  SupabaseAnalyticsBackend,
  type AnalyticsBackend,
  type CloudLeaderboardEntry,
} from './lib/analyticsBackend';
import {
  TelemetryController,
  type TelemetryControllerState,
} from './lib/telemetryController';
import {
  isRecordForDisplay,
  type VerificationRecord,
} from './lib/verificationState';
import { LeaderboardRefreshGate } from './lib/leaderboardRefresh';

// 重新导出 FX 事件类型，供 hooks/useScreenShake 等消费者使用
export type { FxSeasonEvent, FxMarginCallEvent, FxDeltaEvent, FxRoundEvent, FxBuySettlementEvent };

/** 防止 React StrictMode 下 initialize 被重复调用 */
let _initializing = false;

/** TelemetryController 单例：store.initialize 内惰性创建（不阻塞初始化） */
let _telemetryController: TelemetryController | null = null;

const _leaderboardRefreshGate = new LeaderboardRefreshGate();

/**
 * 回合末「锁定牌被自动解锁」事件的 Toast 文案（如「神识难继，灵气甲子自行散去」）。
 * 结算触发后立即展示；随后行动流程再弹「释灵成功/纳灵成功/调息」等反馈文案时，
 * 优先保留本提示，避免关键告警被常规反馈覆盖（玩家感知为"锁定牌无故消失"）。
 * 消费即清空，防止残留到下个回合。
 */
let _pendingAutoUnlockToast: string | null = null;

/**
 * 开发默认使用 V4 平衡版交易规则；?volatility=0 保留基础规则兼容入口。
 * 旧存档仍由 TurnManager 按存档声明的 rulesVersion 读取，不会被入口默认值强行升级。
 */
function isVolatilityEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('volatility') !== '0';
}

function getTelemetryGameMeta(tm?: TurnManager) {
  const rulesVersion = tm?.getRulesVersion();
  const resolvedRulesVersion = rulesVersion ?? (isVolatilityEnabled() ? CURRENT_RULES_VERSION : 1);
  const volatility = resolvedRulesVersion !== 1;
  return {
    rules_version: String(resolvedRulesVersion),
    game_mode: volatility ? 'volatility_trade' : 'base',
    volatility_enabled: volatility,
  };
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

  // 交互状态
  selectedPublicCard: number;
  selectedHandCard: number;
  useLeverage: boolean;
  /** 锁定中的公共牌 ID（锁定机制：占公共位 + 每张每回合 5 气） */
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
  /** 气量变化（可正可负） */
  qiDelta: FxDeltaEvent | null;
  /** 回合推进 */
  roundEvent: FxRoundEvent | null;
  /** 已确认纳灵：在新回合播放公共灵气入丹田动画（跨回合买入结算） */
  buySettlementEvent: FxBuySettlementEvent | null;

  // 生命周期
  initialize: () => Promise<void>;
  startGame: () => void;
  reset: () => void;

  // 存档恢复
  hasSave: boolean;
  loadGameFromSave: () => boolean;
  startNewGame: () => void;

  // 排行榜
  leaderboardEntries: LeaderboardEntry[];
  leaderboardOpen: boolean;
  openLeaderboard: () => void;
  closeLeaderboard: () => void;

  // 遥测（consent/identity；云端未配置时走 no-op，不影响本地游玩）
  telemetryState: TelemetryControllerState | null;
  /** 云端排行榜（娱乐榜公开字段；云端未配置时为空数组） */
  cloudLeaderboard: CloudLeaderboardEntry[];
  cloudLeaderboardStatus: 'idle' | 'loading' | 'ready' | 'error';
  cloudLeaderboardError: string | null;
  /** 最近一局结束后的云端校验状态（pending/verified/rejected/failed；本地局为 null） */
  verificationState: VerificationRecord | null;
  /** 最近一局结束的会话 id；用于显示守卫，隔离旧局异步回调不污染当前结算展示 */
  _endedSessionId: string | null;
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

  // 预览
  previewBuyCost: (cardIndex: number) => number;
  previewSellInfo: (slotIndex: number) => { score: number; qiChange: number } | null;
  previewHoldEarning: (cardIndex: number) => number;
  previewHoldQiCost: (cardIndex: number) => number;
  /** 预测点「等待」后状态：afterQi 最终神识、持仓耗神、牵神成本与扣除后中间神识。 */
  previewWaitQi: () => {
    afterQi: number;
    holdQiCost: number;
    lockedQiCost: number;
    midQi: number;
    /** 扣气后气归零或为负。 */
    willQiDeplete: boolean;
    /** 有杠杆仓位且气归零或为负，真实结算会强平。 */
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
  lockAction?: { type: 'lock' | 'unlock'; card: JiaziCard },
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
      { ...base, card_id: lockAction.card.id, card_name: lockAction.card.name },
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
    });
  } else {
    controller.track('action_wait', {
      ...base,
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

/** 将游戏生命周期回调绑定到任意 TurnManager，供普通局与服务端 seed 局共用。 */
function bindTurnManagerCallbacks(tm: TurnManager, set: StoreSetter, get: () => GameStore): void {
  tm.setOnStateChange(() => {
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
    tm.clearSave();
    set({ hasSave: false });
    get().showToast(`一甲子终了！最终修为：${finalScore}`);
  });
  tm.setOnLockAutoUnlocked((cardIds) => {
    const names = cardIds.map((id) => tm.getCardById(id)?.name ?? `#${id}`).join('、');
    _pendingAutoUnlockToast = `神识难继，灵气${names}自行散去`;
    get().showToast(_pendingAutoUnlockToast);
  });
}

export const useGameStore = create<GameStore>((set, get) => ({
  turnManager: null,

  gameState: 'init' as GameState,
  currentRound: 1,
  season: 'spring',
  roundInSeason: 1,
  seasonLength: 12,
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
  cloudLeaderboard: [],
  cloudLeaderboardStatus: 'idle',
  cloudLeaderboardError: null,
  verificationState: null,
  _endedSessionId: null,
  dashboardOpen: false,

  // FX 事件（初始为 null，_sync diff 后才会产生）
  seasonEvent: null,
  marginCallEvent: null,
  scoreDelta: null,
  qiDelta: null,
  roundEvent: null,
  buySettlementEvent: null,

  showToast: (msg: string) => {
    set({ toast: msg });
  },
  clearToast: () => set({ toast: null }),

  _sync() {
    const tm = get().turnManager;
    if (!tm) return;

    // 先捕获旧值，用于 FX 事件 diff
    const prev = get();

    const nextSeason = tm.getCurrentSeason();
    const nextRound = tm.getCurrentRound();
    const nextQi = tm.getQi();
    const nextScore = tm.getScore();
    const nextMarginCallCount = tm.getMarginCallCount();
    const settlement = tm.getLastSettlementDetail();

    set({
      gameState: tm.getState(),
      currentRound: nextRound,
      season: nextSeason,
      roundInSeason: tm.getCurrentRoundInSeason(),
      seasonLength: tm.getCurrentSeasonLength(),
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
    });

    // ── FX 事件 diff：委托给 fx-events 模块 ──
    const fxPatch = diffFxEvents(
      {
        season: prev.season,
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
      const tm = new TurnManager(undefined, undefined, {
        storage: localStorageProvider,
        ...(isVolatilityEnabled()
          ? {
            rulesVersion: CURRENT_REPLAY_RULES.rulesVersion,
            scoreRules: CURRENT_REPLAY_RULES.scoreRules,
            volatility: CURRENT_REPLAY_RULES.volatility,
          }
          : {}),
      });
      await tm.initialize();

      bindTurnManagerCallbacks(tm, set, get);

      set({ turnManager: tm });
      get()._sync();

      // 检测是否有未完成的存档
      const hasSave = tm.hasSave();
      set({ hasSave });

      // 遥测控制器：云端未配置时走 NoopAnalyticsBackend，绝不阻塞游戏初始化。
      if (!_telemetryController) {
        const supabase = getSupabaseClient();
        const backend: AnalyticsBackend = supabase
          ? new SupabaseAnalyticsBackend(supabase)
          : new NoopAnalyticsBackend();
        _telemetryController = new TelemetryController({
          storage: localStorageProvider,
          backend,
          onStateChange: (state) => set({ telemetryState: state }),
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
        void _telemetryController.init()
          .then(() => {
            if (isVolatilityEnabled()) {
              void _telemetryController?.prepareVerifiedSession(getTelemetryGameMeta(tm));
            }
          })
          .catch((e) => {
            console.error('[store] 遥测初始化失败:', e);
          });
      }
    } catch (e) {
      console.error('[store] 初始化失败:', e);
    } finally {
      _initializing = false;
    }
  },

  startGame() {
    const tm = get().turnManager;
    if (!tm) return;
    _telemetryController?.abandonSession('reset');

    // 若已提前拿到服务端 seed，则用同一 seed 创建新的真实引擎实例。
    // 这条路径是异步的；云端未配置或 seed 尚未准备好时继续走下面的本地同步路径。
    const prepared = _telemetryController?.takePreparedSession() ?? null;
    if (prepared) {
      tm.clearSave();
      set({ hasSave: false, gameState: 'init', _endedSessionId: null, verificationState: null });
      void (async () => {
        try {
          const random = new SeededRandomSource(prepared.seed);
          const snapshot = prepared.rules_snapshot;
          const verifiedTm = new TurnManager(undefined, random, {
            storage: localStorageProvider,
            rulesVersion: snapshot.rulesVersion,
            scoreRules: snapshot.scoreRules,
            volatility: snapshot.volatility,
            volatilityRandom: random,
          });
          await verifiedTm.initialize();
          bindTurnManagerCallbacks(verifiedTm, set, get);
          set({ turnManager: verifiedTm });
          verifiedTm.startGame();
          get()._sync();
          set({
            selectedPublicCard: -1,
            selectedHandCard: -1,
            useLeverage: false,
            pendingAction: null,
            settlementPreview: null,
            buySettlementEvent: null,
          });
          _telemetryController?.startSession(getTelemetryGameMeta(verifiedTm), prepared);
        } catch (error) {
          console.error('[store] 服务端校验局初始化失败，回退本地模式:', error);
          get().showToast('云端校验暂不可用，本局仅保留在本地');
          tm.reset();
          tm.startGame();
          get()._sync();
        }
      })();
      return;
    }

    // 开始新游戏前清除旧存档
    tm.clearSave();
    set({ hasSave: false, _endedSessionId: null, verificationState: null });
    // 重置引擎（清空上一局的 roundLog/decisionLog/手牌/牌池等），再开新局。
    // 否则复用同一 TurnManager 实例时，新局会残留上一局的回合记录（行迹可见旧数据）。
    // 注意：不能在重置后清空 FX 事件——首回合合法回气（+10）是正常事件，
    // 清除会导致开局回气动画丢失；上一局的残留动画已在 reset() 中清空。
    tm.reset();
    tm.startGame();
    get()._sync();
    set({
      selectedPublicCard: -1, selectedHandCard: -1, useLeverage: false,
      pendingAction: null, settlementPreview: null, buySettlementEvent: null,
    });
    // 遥测：开启新局会话（未同意/云端不可用时静默 no-op，不阻塞开局；读档不经过此路径）
    _telemetryController?.startSession(getTelemetryGameMeta(tm));
  },

  loadGameFromSave() {
    const tm = get().turnManager;
    if (!tm) return false;
    const ok = tm.loadGame();
    if (ok) {
      // 先同步当前状态到加载后的值，避免 diffFxEvents 误触发季节/回合动画
      set({
        season: tm.getCurrentSeason(),
        currentRound: tm.getCurrentRound(),
        qi: tm.getQi(),
        score: tm.getScore(),
        marginCallCount: tm.getMarginCallCount(),
      });
      get()._sync();
      set({ selectedPublicCard: -1, selectedHandCard: -1, useLeverage: false, pendingAction: null, settlementPreview: null, buySettlementEvent: null, hasSave: false });
      // 刷新/换设备读档后建立新的分析会话；上一页若仍有会话则先标记为放弃。
      _telemetryController?.abandonSession('reset');
      _telemetryController?.startSession(getTelemetryGameMeta(tm));
      return ok;
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
    return ok;
  },

  startNewGame() {
    get().startGame();
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
    const tm = get().turnManager;
    if (tm && isVolatilityEnabled()) {
      void _telemetryController?.prepareVerifiedSession(getTelemetryGameMeta(tm));
    }
  },

  declineTelemetryConsent() {
    _telemetryController?.declineConsent();
  },

  async provisionPlayer() {
    await _telemetryController?.provision();
  },

  async recoverPlayer(recoveryCode) {
    const identity = await _telemetryController?.recoverIdentity(recoveryCode);
    const tm = get().turnManager;
    if (identity && tm && isVolatilityEnabled()) {
      void _telemetryController?.prepareVerifiedSession(getTelemetryGameMeta(tm));
    }
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
        getTelemetryGameMeta(get().turnManager ?? undefined).rules_version,
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

  openDashboard() {
    set({ dashboardOpen: true });
  },

  closeDashboard() {
    set({ dashboardOpen: false });
  },

  reset() {
    const tm = get().turnManager;
    if (!tm) return;
    // 遥测：放弃当前会话（无 controller/未同意/无活跃会话时静默 no-op，不阻塞重置）
    _telemetryController?.abandonSession('reset');
    tm.reset();
    // 清掉可能残留的自动解锁提示，避免跨局误弹
    _pendingAutoUnlockToast = null;
    // 先把引擎重置后的关键值写回 store，再清空 FX 事件。
    // 否则随后的 _sync 会把"重置前的旧季节/分数/气量 vs 重置后的初始值"的差异
    // 误判为新 FX 事件，导致新一局开局误播上一局的换季/得分/回气动画。
    set({
      season: tm.getCurrentSeason(),
      currentRound: tm.getCurrentRound(),
      roundInSeason: tm.getCurrentRoundInSeason(),
      qi: tm.getQi(),
      score: tm.getScore(),
      marginCallCount: tm.getMarginCallCount(),
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
    });
    // 同步 TurnManager 重置后的状态（gameState → 'init'），让 UI 回到开始界面
    get()._sync();
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
    } else {
      get().showToast('纳灵失败（丹田满/神识不足）');
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
      // 最后一回合等待 = 直接结束游戏，不产生下回合回气
      if (get().gameState === 'game_over') {
        _showActionToast(get, '一甲子终了');
      } else {
        _showActionToast(get, '调息（下回合额外回神）');
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
        recordActionTelemetry(before, get(), tm, { type: 'wait' }, { type: 'unlock', card });
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
      recordActionTelemetry(before, get(), tm, { type: 'wait' }, { type: 'lock', card });
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
            buyCost: actualBuyCost,
            useLeverage: buyCapture.useLeverage,
            wasLocked: buyCapture.wasLocked,
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
    return tm.previewBuyCost(cards[cardIndex], get().useLeverage);
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
      afterQi: get().qi, holdQiCost: 0, lockedQiCost: 0, midQi: get().qi,
       willQiDeplete: false, willMarginCall: false, hasLeverage: false,
    };

    // 最后一回合：等待会直接结束游戏（advanceTurn → 61 > 60 → endGame），
    // 不会发生下一回合结算或回气，预览必须返回当前气、零气耗。
    if (get().currentRound >= tm.getTotalRounds()) {
      return {
        afterQi: get().qi, holdQiCost: 0, lockedQiCost: 0, midQi: get().qi,
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
    const lockedQiCost = tm.getLockedCardIds().length * TurnManager.LOCK_COST_PER_CARD;
    let hasLeverage = false;
    for (const slot of handSlots) {
      if (!slot) continue;
      const score = tm.getCardScore(slot.card, currentSeason);
      const leverage = slot.useLeverage ? tm.getNextLeverageNoSeasonChange() : 1;
      if (slot.useLeverage) hasLeverage = true;
      holdQiCost += tm.previewHoldQiCost(
        score,
        leverage,
        slot.card.tianGanElement === Element.EARTH,
      );
    }
    const qi = get().qi;
    const midQi = qi - holdQiCost - lockedQiCost;
    const willQiDeplete = midQi <= 0;
    const willMarginCall = willQiDeplete && hasLeverage;
    // 强平候选数 > 0 时最终气取决于被随机强平的仓位（不确定值）；UI 在 willMarginCall 分支不展示该值。
    const afterQi = willMarginCall
      ? midQi
      : Math.min(tm.getMaxQi(), midQi + tm.getBaseRecovery() + tm.getWaitBonus());

    return { afterQi, holdQiCost, lockedQiCost, midQi, willQiDeplete, willMarginCall, hasLeverage };
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
