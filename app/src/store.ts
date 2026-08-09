import { create } from 'zustand';
import {
  TurnManager,
  LeaderboardService,
  Element,
  type GameState,
  type SettlementDetail,
  type SettlementPreview,
  type SettlementPreviewAction,
  type JiaziCard,
  type LeaderboardEntry,
  type RoundLogEntry,
  type DecisionEntry,
  BAND_FACTOR,
  RULES_VERSION_TRADE,
  TRADE_SCORE_RULES,
} from '@core/index';
import {
  diffFxEvents,
  type FxSeasonEvent,
  type FxMarginCallEvent,
  type FxDeltaEvent,
  type FxRoundEvent,
} from './store/fx-events';
import { localStorageProvider } from './platform/localStorageProvider';

// 重新导出 FX 事件类型，供 hooks/useScreenShake 等消费者使用
export type { FxSeasonEvent, FxMarginCallEvent, FxDeltaEvent, FxRoundEvent };

/** 防止 React StrictMode 下 initialize 被重复调用 */
let _initializing = false;

/**
 * 回合末「锁定牌被自动解锁」事件的 Toast 文案（如「神识难继，灵气甲子自行散去」）。
 * 结算触发后立即展示；随后行动流程再弹「释灵成功/纳灵成功/调息」等反馈文案时，
 * 优先保留本提示，避免关键告警被常规反馈覆盖（玩家感知为"锁定牌无故消失"）。
 * 消费即清空，防止残留到下个回合。
 */
let _pendingAutoUnlockToast: string | null = null;

/**
 * 显式实验入口：普通 URL 永远使用 base 规则；只有手动附加 ?volatility=1 才启用
 * v3 conflict_banded 交易规则。普通 URL 永远使用 base 规则；该开关用于体验
 * 交易主导的趋势 UI，不代表普通生产路径自动升级旧存档。
 */
function isVolatilityExperimentEnabled(): boolean {
  return typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('volatility') === '1';
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
  /** 预测点「等待」后状态：afterQi 最终气量（强平时不作为确定值展示）、holdQiCost 持仓气耗、midQi 扣气后中间气量 */
  previewWaitQi: () => {
    afterQi: number;
    holdQiCost: number;
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
  dashboardOpen: false,

  // FX 事件（初始为 null，_sync diff 后才会产生）
  seasonEvent: null,
  marginCallEvent: null,
  scoreDelta: null,
  qiDelta: null,
  roundEvent: null,

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
        ...(isVolatilityExperimentEnabled()
          ? {
            rulesVersion: RULES_VERSION_TRADE,
            scoreRules: TRADE_SCORE_RULES,
            volatility: {
              enabled: true,
              model: 'conflict_banded' as const,
              scale: 4,
              bandFactors: { ...BAND_FACTOR, conflict: 6 },
            },
          }
          : {}),
      });
      await tm.initialize();

      tm.setOnStateChange(() => {
        set((s) => ({ tick: s.tick + 1 }));
      });
      tm.setOnTurnStart(() => {
        // 燃灵开关是"一次性行动偏好"，每回合复位防止忘关导致意外杠杆买入。
        // 复位时若玩家此前是 ON 状态，设 pending 提示——由随后的行动反馈 Toast 统一弹出
        // （pending 优先于"纳灵成功/释灵成功/调息"等 fallback），避免玩家误以为"点击燃灵没响应"，
        // 也不会产生双 Toast（2026-08-05 用户反馈）。
        const wasLeverageOn = get().useLeverage;
        set((s) => ({
          tick: s.tick + 1,
          selectedPublicCard: -1,
          selectedHandCard: -1,
          useLeverage: false,
          pendingAction: null,
          settlementPreview: null,
        }));
        if (wasLeverageOn) {
          _pendingAutoUnlockToast = '燃灵已复位（新回合）';
        }
      });
      tm.setOnGameEnd((finalScore) => {
        set((s) => ({ tick: s.tick + 1 }));
        // 记录到排行榜
        const lb = new LeaderboardService(localStorageProvider);
        lb.addEntry(finalScore);
        set({ leaderboardEntries: lb.getEntries() });
        // 游戏结束清除存档
        tm.clearSave();
        set({ hasSave: false });
        get().showToast(`一甲子终了！最终修为：${finalScore}`);
      });

      // 回合末锁定牌被自动解锁（付不起锁定费）：必须明确提示，不能静默丢锁定
      tm.setOnLockAutoUnlocked((cardIds) => {
        const names = cardIds
          .map((id) => tm.getCardById(id)?.name ?? `#${id}`)
          .join('、');
        _pendingAutoUnlockToast = `神识难继，灵气${names}自行散去`;
        // 立即提示；随后的行动反馈 Toast 会优先保留本提示（见 _showActionToast）
        get().showToast(_pendingAutoUnlockToast);
      });

      set({ turnManager: tm });
      get()._sync();

      // 检测是否有未完成的存档
      const hasSave = tm.hasSave();
      set({ hasSave });
    } catch (e) {
      console.error('[store] 初始化失败:', e);
    } finally {
      _initializing = false;
    }
  },

  startGame() {
    const tm = get().turnManager;
    if (!tm) return;
    // 开始新游戏前清除旧存档
    tm.clearSave();
    set({ hasSave: false });
    // 重置引擎（清空上一局的 roundLog/decisionLog/手牌/牌池等），再开新局。
    // 否则复用同一 TurnManager 实例时，新局会残留上一局的回合记录（行迹可见旧数据）。
    // 注意：不能在重置后清空 FX 事件——首回合合法回气（+10）是正常事件，
    // 清除会导致开局回气动画丢失；上一局的残留动画已在 reset() 中清空。
    tm.reset();
    tm.startGame();
    get()._sync();
    set({
      selectedPublicCard: -1, selectedHandCard: -1, useLeverage: false,
      pendingAction: null, settlementPreview: null,
    });
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
      set({ selectedPublicCard: -1, selectedHandCard: -1, useLeverage: false, pendingAction: null, settlementPreview: null, hasSave: false });
      return ok;
    }
    // 读档失败：区分「存档版本过新」与一般失败（App 不再无条件弹"继续游戏"）
    const loadError = tm.getLastLoadError();
    get().showToast(
      loadError === 'schema_too_new' || loadError === 'rules_version_unsupported'
        ? '存档版本过新，请更新游戏'
        : '读档失败',
    );
    return ok;
  },

  startNewGame() {
    get().startGame();
  },

  openLeaderboard() {
    const lb = new LeaderboardService(localStorageProvider);
    set({ leaderboardEntries: lb.getEntries(), leaderboardOpen: true });
  },

  closeLeaderboard() {
    set({ leaderboardOpen: false });
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
      // 清空 FX 事件，避免残留动画在重开时误触发
      seasonEvent: null,
      marginCallEvent: null,
      scoreDelta: null,
      qiDelta: null,
      roundEvent: null,
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
    const ok = tm.executeBuy(idx, get().useLeverage);
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
    const ok = tm.executeSell(idx);
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
    const ok = tm.executeWait();
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
    const tm = get().turnManager;
    if (!tm) return;
    const card = tm.getPublicCards()[index];
    if (!card) return;
    const isLocked = tm.isCardLocked(card.id);
    if (isLocked) {
      const ok = tm.executeUnlockCard(index);
      if (ok) {
        get()._sync();
        get().showToast('已解锁');
      } else {
        get().showToast('解锁失败');
      }
      return;
    }
    // 锁定动作：按具体失败原因提示（不混合展示多种可能）
    const result = tm.executeLockCard(index);
    if (result.ok) {
      get()._sync();
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
    const tm = get().turnManager;
    const action = get().pendingAction;
    if (!tm || !action) return false;

    const ok = action.type === 'buy'
      ? tm.executeBuy(action.cardIndex, action.leverage)
      : action.type === 'sell'
        ? tm.executeSell(action.slotIndex)
        : tm.executeWait();
    if (!ok) {
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

    // 每次行动后自动存档
    tm.saveGame();

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
      afterQi: get().qi, holdQiCost: 0, midQi: get().qi,
       willQiDeplete: false, willMarginCall: false, hasLeverage: false,
    };

    // 最后一回合：等待会直接结束游戏（advanceTurn → 61 > 60 → endGame），
    // 不会发生下一回合结算或回气，预览必须返回当前气、零气耗。
    if (get().currentRound >= tm.getTotalRounds()) {
      return {
        afterQi: get().qi, holdQiCost: 0, midQi: get().qi,
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
    const midQi = qi - holdQiCost;
    const willQiDeplete = midQi <= 0;
    const willMarginCall = willQiDeplete && hasLeverage;
    // 强平候选数 > 0 时最终气取决于被随机强平的仓位（不确定值）；UI 在 willMarginCall 分支不展示该值。
    const afterQi = willMarginCall
      ? midQi
      : Math.min(tm.getMaxQi(), midQi + tm.getBaseRecovery() + tm.getWaitBonus());

    return { afterQi, holdQiCost, midQi, willQiDeplete, willMarginCall, hasLeverage };
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
