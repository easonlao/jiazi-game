import { create } from 'zustand';
import {
  TurnManager,
  type GameState,
  type SettlementDetail,
  type SettlementPreview,
  type SettlementPreviewAction,
  type JiaziCard,
} from '@core/index';
import {
  diffFxEvents,
  type FxSeasonEvent,
  type FxMarginCallEvent,
  type FxDeltaEvent,
  type FxRoundEvent,
} from './store/fx-events';

// 重新导出 FX 事件类型，供 hooks/useScreenShake 等消费者使用
export type { FxSeasonEvent, FxMarginCallEvent, FxDeltaEvent, FxRoundEvent };

/** 防止 React StrictMode 下 initialize 被重复调用 */
let _initializing = false;

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
  sellCost: number;
  baseRecovery: number;
  waitBonus: number;
  totalRounds: number;
  lastSettlement: SettlementDetail | null;
  totalBuys: number;
  totalSells: number;
  totalWaits: number;
  totalLeverageBuys: number;
  marginCallCount: number;

  // 交互状态
  selectedPublicCard: number;
  selectedHandCard: number;
  useLeverage: boolean;
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

  // 操作
  selectPublicCard: (index: number) => void;
  selectHandCard: (index: number) => void;
  toggleLeverage: () => void;
  executeBuy: () => boolean;
  executeSell: () => boolean;
  executeWait: () => boolean;
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
  sellCost: 4,
  baseRecovery: 10,
  waitBonus: 10,
  totalRounds: 60,
  lastSettlement: null,
  totalBuys: 0,
  totalSells: 0,
  totalWaits: 0,
  totalLeverageBuys: 0,
  marginCallCount: 0,

  selectedPublicCard: -1,
  selectedHandCard: -1,
  useLeverage: false,
  pendingAction: null,
  settlementPreview: null,
  toast: null,
  tick: 0,

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
      sellCost: tm.getSellCost(),
      baseRecovery: tm.getBaseRecovery(),
      waitBonus: tm.getWaitBonus(),
      totalRounds: tm.getTotalRounds(),
      lastSettlement: settlement,
      totalBuys: tm.getTotalBuys(),
      totalSells: tm.getTotalSells(),
      totalWaits: tm.getTotalWaits(),
      totalLeverageBuys: tm.getTotalLeverageBuys(),
      marginCallCount: nextMarginCallCount,
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
      const tm = new TurnManager();
      await tm.initialize();

      tm.setOnStateChange(() => {
        set((s) => ({ tick: s.tick + 1 }));
      });
      tm.setOnTurnStart(() => {
        set((s) => ({
          tick: s.tick + 1,
          selectedPublicCard: -1,
          selectedHandCard: -1,
          useLeverage: false,
          pendingAction: null,
          settlementPreview: null,
        }));
      });
      tm.setOnGameEnd((finalScore) => {
        set((s) => ({ tick: s.tick + 1 }));
        get().showToast(`游戏结束！最终得分：${finalScore}`);
      });

      set({ turnManager: tm });
      get()._sync();
    } catch (e) {
      console.error('[store] 初始化失败:', e);
    } finally {
      _initializing = false;
    }
  },

  startGame() {
    const tm = get().turnManager;
    if (!tm) return;
    tm.startGame();
    get()._sync();
    set({ selectedPublicCard: -1, selectedHandCard: -1, useLeverage: false, pendingAction: null, settlementPreview: null });
  },

  reset() {
    const tm = get().turnManager;
    if (!tm) return;
    tm.reset();
    set({
      selectedPublicCard: -1,
      selectedHandCard: -1,
      useLeverage: false,
      pendingAction: null,
      settlementPreview: null,
      lastSettlement: null,
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
      get().showToast('买入成功');
    } else {
      get().showToast('买入失败（手牌满/气不足）');
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
      get().showToast('卖出成功');
    } else {
      get().showToast('卖出失败');
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
        get().showToast('游戏结束');
      } else {
        get().showToast('等待（下回合额外回气）');
      }
    }
    return ok;
  },

  requestBuyPreview() {
    const tm = get().turnManager;
    const cardIndex = get().selectedPublicCard;
    if (!tm || cardIndex < 0) return;
    const action: SettlementPreviewAction = { type: 'buy', cardIndex, leverage: get().useLeverage };
    const preview = tm.previewSettlement(action);
    if (!preview) {
      get().showToast('当前无法买入');
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
      get().showToast('当前无法卖出');
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
      get().showToast('买入成功');
    } else if (action.type === 'sell') {
      patch.selectedHandCard = -1;
      get().showToast('卖出成功');
    } else {
      get().showToast(tm.getState() === 'game_over' ? '游戏结束' : '等待（下回合额外回气）');
    }
    set(patch);
    get()._sync();
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
    const score = tm.getCardScore(card, tm.getSettlementSeason());
    const leverage = get().useLeverage ? tm.getSettlementLeverageMultiplier() : 1;
    return tm.previewHoldEarning(score, leverage);
  },

  previewHoldQiCost(cardIndex) {
    const tm = get().turnManager;
    const cards = get().publicCards;
    if (!tm || cardIndex < 0 || cardIndex >= cards.length) return 0;
    const card = cards[cardIndex];
    const score = tm.getCardScore(card, tm.getSettlementSeason());
    const leverage = get().useLeverage ? tm.getSettlementLeverageMultiplier() : 1;
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

    const hand = get().hand;
    // 结算发生在下回合：气耗必须按下回合的实际杠杆倍数 + 结算季评分计算，
    // 否则杠杆爬坡或跨季换牌时预测会与实际情况不一致
    const settlementLeverage = tm.getSettlementLeverageMultiplier();
    const settlementSeason = tm.getSettlementSeason();
    let holdQiCost = 0;
    let hasLeverage = false;
    for (const slot of hand) {
      if (!slot) continue;
      if (slot.useLeverage) hasLeverage = true;
      const effLeverage = slot.useLeverage ? settlementLeverage : 1;
      holdQiCost += tm.previewHoldQiCost(tm.getCardScore(slot.card, settlementSeason), effLeverage);
    }
    // 真实时序：扣持仓气耗 → 判定爆仓/强平 → 回气。
    // midQi 即扣气后的中间气量；若 midQi ≤ 0 会触发强平：
    //   - 有杠杆牌 → 强平返还 floor(lockedQi × 0.5) 且扣分，最终气取决于被随机强平的仓位（不确定值）
    //   - 无杠杆牌 → 核心不强平，气保持 ≤ 0 直到回气
    // 因此 willMarginCall=true 时 afterQi 只是下限估算，不是确定结果。
    const midQi = get().qi - holdQiCost;
    const willQiDeplete = midQi <= 0;
    const willMarginCall = willQiDeplete && hasLeverage;
    const afterQi = Math.min(
      tm.getMaxQi(),
      midQi + tm.getBaseRecovery() + tm.getWaitBonus()
    );
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
