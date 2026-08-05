import { JiaziCard, Element } from './JiaziCard';
import { CardDataBank } from './CardDataBank';
import { SeasonCycle, Season } from './SeasonCycle';
import { QiManager } from './QiManager';
import { ScoreManager } from './ScoreManager';
import { LeverageCalculator } from './LeverageCalculator';
import { HandManager } from './HandManager';
import { HandSlot } from './HandSlot';
import { CardPoolManager } from './CardPoolManager';
import { BalanceConfig, DEFAULT_BALANCE_CONFIG } from './BalanceConfig';
import { MathRandomSource, RandomSource } from './RandomSource';
import { calculateHoldingSettlement } from './SettlementPreviewCalculator';
import { GameSaveService, type GameSnapshot } from './GameSaveService';
import type { StorageProvider } from './StorageProvider';
import { LockManager, type LockResult } from './LockManager';
import { MarginCallEngine } from './MarginCallEngine';

/** 游戏主状态 */
export type GameState = 'init' | 'settlement' | 'draw' | 'qi_recover' | 'player_action' | 'game_over';

/** 玩家操作类型 */
export type ActionType = 'buy' | 'sell' | 'wait' | 'lock' | 'unlock';

export interface MarginCallDetail {
  cardName: string;
  /** 反噬扣分（罚分 = 杠杆 × |评分| × 系数）。2026-08-05 起被反噬牌无卖出收益，恒为 0。 */
  sellScore: number;
  /** 反噬扣分（结构化字段，供 UI 大字展示，不依赖 reason 字符串解析） */
  penaltyScore: number;
  /** 被反噬时实际杠杆倍率 */
  leverage: number;
  /** 被反噬时卡牌评分 */
  cardScore: number;
  /** 被反噬牌在丹田的槽位索引（0-2，UI 用于定位"哪一格崩坏"） */
  slotIndex: number;
  /** 兜底描述（含完整计算式） */
  reason: string;
}

export interface SettlementDetail {
  round: number;
  season: string;
  holdEarnings: number;
  holdQiCost: number;
  holdItems: {
    cardName: string;
    earning: number;
    qiCost: number;
    leverage: number;
  }[];
  baseQiRecover: number;
  waitQiRecover: number;
  marginCallTriggered: boolean;
  marginCallDetails: MarginCallDetail[];
  finalQi: number;
  finalScore: number;
}

/** 行动尚未提交时的可序列化描述。 */
export type SettlementPreviewAction =
  | { type: 'buy'; cardIndex: number; leverage: boolean }
  | { type: 'sell'; slotIndex: number }
  | { type: 'wait' };

/** 主动卖出时的价差与气量流转明细。 */
export interface SalePreviewBreakdown {
  buyScore: number;
  currentScore: number;
  leverage: number;
  scoreChange: number;
  /** 占用气返还受气上限截断后的实际到账量。 */
  lockedQiReturn: number;
  exitCost: number;
  qiChange: number;
}

/**
 * 行动确认前的下一回合结算预览。
 *
 * 预览只读取现有状态和计算器；它不调用抽牌、回牌或随机强平，因此不会改变游戏状态
 * 或推进注入的随机源。发生强平时，随机选择的仓位会影响最终气和分数，相关字段保持
 * null，避免把不确定结果伪装成确定值。
 */
export interface SettlementPreview {
  action: SettlementPreviewAction;
  /** 本次行动明确指向的卡牌；等待行动为 null。 */
  actionCardName: string | null;
  /** 目标卡牌是否为杠杆仓位；等待行动为 false。 */
  actionUsesLeverage: boolean;
  actionQiChange: number;
  actionScoreChange: number;
  saleBreakdown: SalePreviewBreakdown | null;
  qiAfterAction: number;
  scoreAfterAction: number;
  endsGame: boolean;
  nextRound: number | null;
  nextSeason: string | null;
  nextRoundInSeason: number | null;
  settlementLeverage: number | null;
  holdItems: SettlementDetail['holdItems'];
  holdEarnings: number;
  holdQiCost: number;
  qiAfterHold: number | null;
  baseQiRecover: number;
  waitQiRecover: number;
  willMarginCall: boolean;
  marginCallCandidateNames: string[];
  finalQi: number | null;
  finalScore: number | null;
}

/**
 * 回合管理器
 * 
 * 游戏最核心的控制器与状态机骨架。负责流程控制、状态维护和各个子模块（气、计分、手牌、牌池、季节）的协调工作。
 * 单局限制 60 个回合。管理完整的游戏生命周期以及一键存档/读档机制。
 * 
 * @see {@link design/gdd/system-turn-flow.md} 回合流程设计文档
 */
export class TurnManager {
  private static readonly TOTAL_ROUNDS = 60;

  // 注入的配置与随机源（固定 seed 可复现依赖）
  private readonly balanceConfig: BalanceConfig;
  private readonly random: RandomSource;

  // 子系统
  private cardDataBank: CardDataBank;
  private seasonCycle: SeasonCycle;
  private qiManager: QiManager;
  private scoreManager: ScoreManager;
  private leverageCalculator: LeverageCalculator;
  private handManager: HandManager;
  private cardPoolManager: CardPoolManager;

  // 游戏状态
  private currentRound: number;
  private state: GameState;
  private lastAction: ActionType | null;
  private selectedCardIndex: number;
  private useLeverage: boolean;
  private marginCallCount: number;

  /** 锁定中的公共牌管理（锁定机制见 LockManager） */
  private readonly lockManager: LockManager;
  /** 强平引擎（爆仓时对杠杆仓位强制平仓） */
  private readonly marginCallEngine: MarginCallEngine;
  /** 锁定费常量：每张锁定牌每回合消耗气（转发 LockManager，单一真源） */
  static readonly LOCK_COST_PER_CARD = LockManager.LOCK_COST_PER_CARD;
  /** 锁定张数上限：展示牌数 - 1（锁满则公共位全占，每回合 0 张新牌，游戏僵死） */
  static readonly MAX_LOCKED_CARDS = LockManager.MAX_LOCKED_CARDS;

  // 局内反馈与统计
  private lastSettlementDetail: SettlementDetail | null = null;
  private totalBuys: number = 0;
  private totalSells: number = 0;
  private totalWaits: number = 0;
  private totalLeverageBuys: number = 0;

  // 回调
  private onStateChange?: (state: GameState) => void;
  private onTurnStart?: (round: number) => void;
  private onGameEnd?: (finalScore: number) => void;
  /** 锁定牌被自动解锁（付不起锁定费时回合末触发），携带被解锁的牌 ID 列表 */
  private onLockAutoUnlocked?: (cardIds: number[]) => void;

  // 存档服务（序列化与 LocalStorage 边界）
  private readonly saveService: GameSaveService;

  constructor(
    config?: BalanceConfig,
    random?: RandomSource,
    options?: { skipSeasonGenerate?: boolean; storage?: StorageProvider },
  ) {
    const balanceConfig = config ?? DEFAULT_BALANCE_CONFIG;
    const randomSource = random ?? new MathRandomSource();
    this.balanceConfig = balanceConfig;
    this.random = randomSource;
    this.cardDataBank = new CardDataBank();
    this.seasonCycle = new SeasonCycle(randomSource, options?.skipSeasonGenerate ?? false);
    this.qiManager = new QiManager(undefined, balanceConfig);
    this.scoreManager = new ScoreManager();
    this.leverageCalculator = new LeverageCalculator(balanceConfig);
    this.handManager = new HandManager();
    this.cardPoolManager = new CardPoolManager(randomSource);

    this.currentRound = 1;
    this.state = 'init';
    this.lastAction = null;
    this.selectedCardIndex = -1;
    this.useLeverage = false;
    this.marginCallCount = 0;

    this.lockManager = new LockManager({
      qiManager: this.qiManager,
      cardPoolManager: this.cardPoolManager,
      getCardScore: (card, season) => this.getCardScore(card, season),
    });
    this.marginCallEngine = new MarginCallEngine({
      qiManager: this.qiManager,
      handManager: this.handManager,
      cardPoolManager: this.cardPoolManager,
      scoreManager: this.scoreManager,
      leverageCalculator: this.leverageCalculator,
      seasonCycle: this.seasonCycle,
      balanceConfig: this.balanceConfig,
      getCardScore: (card, season) => this.getCardScore(card, season),
      getTotalLockedQi: () => this.getTotalLockedQi(),
      onMarginCall: () => {
        this.marginCallCount++;
      },
    });

    this.lastSettlementDetail = null;
    this.totalBuys = 0;
    this.totalSells = 0;
    this.totalWaits = 0;
    this.totalLeverageBuys = 0;

    this.saveService = new GameSaveService(options?.storage);
  }

  /** 所有核心结算和预览共用的最终评分入口。 */
  getCardScore(card: JiaziCard, season: string): number {
    return card.getSeasonScore(season, this.balanceConfig);
  }

  /**
   * 初始化游戏，拉取卡牌数据，并初始化牌池
   */
  async initialize(): Promise<void> {
    await this.cardDataBank.initialize();
    const cards = this.cardDataBank.getAllCards();
    this.cardPoolManager.initialize(cards);

    this.currentRound = 1;
    this.state = 'init';
    this.lastAction = null;

    console.log('[TurnManager] 游戏初始化完成');
  }

  /**
   * 开始运行游戏，将状态流转至抽牌阶段并执行回合逻辑
   */
  startGame(): void {
    this.state = 'draw';
    this.processRound();
  }

  /**
   * 单回合的处理引擎，串联结算、抽牌、气回复
   */
  private processRound(): void {
    if (this.currentRound > TurnManager.TOTAL_ROUNDS) {
      this.endGame();
      return;
    }

    // 初始化本轮结算明细
    this.lastSettlementDetail = {
      round: this.currentRound,
      season: this.seasonCycle.getCurrentSeason(),
      holdEarnings: 0,
      holdQiCost: 0,
      holdItems: [],
      baseQiRecover: 0,
      waitQiRecover: 0,
      marginCallTriggered: false,
      marginCallDetails: [],
      finalQi: 0,
      finalScore: 0,
    };

    // 1. 持仓结算
    this.settleHoldings();

    // 1.5 锁定费结算：每张锁定牌每回合扣 LOCK_COST，气不足自动解锁（先解评分最低的）。
    // 被自动解锁的牌要通知 UI 弹 Toast，否则玩家会以为锁定牌"无故消失"（卖出/等待低气导火索）。
    const autoUnlockedIds = this.lockManager.settleLockCost(this.seasonCycle.getCurrentSeason());
    if (autoUnlockedIds.length > 0) {
      this.onLockAutoUnlocked?.(autoUnlockedIds);
    }

    // 2. 抽牌（锁定牌保留在公共区，抽 drawCount - 锁定数 张新牌）
    this.cardPoolManager.drawCards(this.lockManager.getLockedCardIds());

    // 3. 气回复
    this.recoverQi();

    // 记录本回合最终分和气数值
    if (this.lastSettlementDetail) {
      this.lastSettlementDetail.finalQi = this.qiManager.getQi();
      this.lastSettlementDetail.finalScore = this.scoreManager.getScore();
    }

    // 4. 等待玩家操作
    this.state = 'player_action';
    this.onStateChange?.('player_action');
    this.onTurnStart?.(this.currentRound);
  }

  /**
   * 执行对玩家手牌中持仓卡牌的阶段结算（加分并扣气，进行爆仓检查）
   */
  private settleHoldings(): void {
    const hand = this.handManager.getHand();
    const currentSeason = this.seasonCycle.getCurrentSeason();
    const activeSlots = hand.filter((slot): slot is HandSlot => slot !== null);
    // 杠杆持仓：每回合结算时取当前季内回合的实际倍数（换季从 1.0x 重置）。
    const currentLeverage = this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason());
    const holdingSettlement = calculateHoldingSettlement(
      activeSlots.map((slot) => ({
        cardName: slot.card.name,
        cardScore: this.getCardScore(slot.card, currentSeason),
        useLeverage: slot.useLeverage,
        isEarth: slot.card.tianGanElement === Element.EARTH,
      })),
      currentLeverage,
      {
        calculateHoldEarnings: (cardScore, leverage) => this.scoreManager.calculateHoldEarnings(cardScore, leverage),
        calculateHoldQiCost: (cardScore, leverage, isEarth) => this.leverageCalculator.calculateHoldQiCost(cardScore, leverage, isEarth),
      },
    );

    holdingSettlement.items.forEach((item, index) => {
      const slot = activeSlots[index]!;
      this.scoreManager.addHoldEarnings(item.earning);
      slot.holdEarnings += item.earning;
      this.lastSettlementDetail?.holdItems.push(item);
    });

    if (this.lastSettlementDetail) {
      this.lastSettlementDetail.holdEarnings = holdingSettlement.holdEarnings;
      this.lastSettlementDetail.holdQiCost = holdingSettlement.holdQiCost;
    }

    // 强制扣除全部持仓气耗（支持扣成负数或0）
    if (holdingSettlement.holdQiCost > 0) {
      this.qiManager.deductQi(holdingSettlement.holdQiCost);
    }

    // 结算完成后进行爆仓判定
    if (this.leverageCalculator.checkMarginCall(this.qiManager.getQi())) {
      const details = this.marginCallEngine.execute();
      if (this.lastSettlementDetail && details.length > 0) {
        this.lastSettlementDetail.marginCallTriggered = true;
        this.lastSettlementDetail.marginCallDetails = details;
      }
    }
  }


  /**
   * 自然回复玩家的气，若上回合选择等待则提供额外奖励
   */
  private recoverQi(): void {
    const totalLocked = this.getTotalLockedQi();
    const baseRecovery = this.qiManager.getBaseRecovery();
    this.qiManager.recover(baseRecovery, totalLocked);
    if (this.lastSettlementDetail) {
      this.lastSettlementDetail.baseQiRecover = baseRecovery;
    }

    if (this.lastAction === 'wait') {
      const waitBonus = this.qiManager.getWaitBonus();
      this.qiManager.recover(waitBonus, totalLocked);
      if (this.lastSettlementDetail) {
        this.lastSettlementDetail.waitQiRecover = waitBonus;
      }
    }
  }

  /**
   * 执行买入操作
   * @param cardIndex 刷新卡牌池的索引
   * @param leverage 是否加上倍数杠杆
   * @returns 操作是否成功
   */
  executeBuy(cardIndex: number, leverage: boolean): boolean {
    if (this.state !== 'player_action') return false;

    // 最后一回合禁止买入：买入后会推进到第 61 回合直接结束，
    // 所买卡牌没有下一回合结算、也没有占用气返还，是纯损失操作。
    if (this.currentRound >= TurnManager.TOTAL_ROUNDS) {
      console.log('[TurnManager] 最后一回合无法买入');
      return false;
    }

    const card = this.cardPoolManager.getPublicCards()[cardIndex];
    if (!card) return false;

    // 检查手牌是否已满
    if (!this.handManager.canBuy()) {
      console.log('[TurnManager] 手牌已满');
      return false;
    }

    // 计算买入消耗
    const buyCost = this.qiManager.calculateBuyCost(
      this.getCardScore(card, this.seasonCycle.getCurrentSeason()),
      leverage
    );

    // 检查气是否足够
    if (!this.qiManager.canAfford(buyCost)) {
      console.log('[TurnManager] 气不足');
      return false;
    }

    // 执行买入
    this.qiManager.spend(buyCost);
    this.totalBuys++;
    if (leverage) {
      this.totalLeverageBuys++;
    }
    const buyScore = this.getCardScore(card, this.seasonCycle.getCurrentSeason());
    const lockedQi = buyCost - this.qiManager.getBuyEntryFee();
      const initialLeverage = leverage
        ? this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason())
        : 1;
    const slotIndex = this.handManager.buy(
      card,
      buyScore,
      leverage,
      initialLeverage,
      this.currentRound,
      lockedQi
    );

    if (slotIndex === -1) return false;

    // 买的是锁定牌则自动解锁（牌已入手，不再占用公共位）
    this.lockManager.onCardBought(card.id);

    // 未选的牌回牌堆（锁定中的牌保留）。
    // 注意：filter 回调第二个参数才是当前元素，必须用元素自身的 id 判断是否锁定，
    // 不能用外层闭包变量 `card.id`（那是要买的牌，不是当前元素）——
    // 否则当买的是非锁定牌时，`!isCardLocked(card.id)` 永远为 true，
    // 会把所有锁定的牌错误地回牌堆，导致 deck 与 publicCards 同时持有同一张锁定牌的引用，
    // 下一次 drawCards 可能从 deck 抽到这张牌的副本，使 publicCards 出现「两张同 id 锁定牌」（用户截图里的 bug）。
    const remainingCards = this.cardPoolManager.getPublicCards()
      .filter((c, i) => i !== cardIndex && !this.lockManager.isCardLocked(c.id));
    this.cardPoolManager.returnCards(remainingCards);

    this.lastAction = 'buy';
    this.advanceTurn();
    return true;
  }

  /**
   * 执行卖出操作
   * @param slotIndex 手牌插槽索引
   * @returns 操作是否成功
   */
  executeSell(slotIndex: number): boolean {
    if (this.state !== 'player_action') return false;

    const slot = this.handManager.getSlot(slotIndex);
    if (!slot) return false;

    const currentScore = this.getCardScore(slot.card, this.seasonCycle.getCurrentSeason());
    const effectiveLeverage =
      slot.useLeverage
        ? this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason())
        : 1;
    const sellScore = this.scoreManager.calculateSellScore(
      currentScore,
      slot.buyScore,
      effectiveLeverage
    );

    // 卖出固定扣气，不再回复气
    const sellCost = this.qiManager.getSellCost();
    // 注意：卖出时会先释放 lockedQi 再扣 sellCost，所以可用气 = 当前气 + 该卡牌的 lockedQi
    const availableQi = this.qiManager.getQi() + (slot ? slot.lockedQi : 0);
    if (availableQi < sellCost) {
      console.log('[TurnManager] 气不足以支付卖出成本（含锁定占用气）');
      return false;
    }

    // 移除卡牌以释放对应的占用气锁定额，并将卡牌回洗入牌池
    const soldSlot = this.handManager.sell(slotIndex);
    if (soldSlot) {
      this.cardPoolManager.returnCards([soldSlot.card]);
    }
    const newTotalLocked = this.getTotalLockedQi();

    // 归还全部占用气（lockedQi 是从总气里扣掉的子集，卖牌时退回）
    if (soldSlot) {
      this.qiManager.recover(soldSlot.lockedQi);
    }

    // 执行卖出固定扣气
    this.qiManager.spend(sellCost);

    this.totalSells++;
    this.scoreManager.addSellEarnings(sellScore);

    this.lastAction = 'sell';
    this.advanceTurn();
    return true;
  }

  /**
   * 执行等待动作（本回合弃牌，无消耗且下回合额外回复气）
   * @returns 操作是否成功
   */
  executeWait(): boolean {
    if (this.state !== 'player_action') return false;

    // 公共牌回牌堆（锁定中的牌保留在公共区）
    const publicCards = this.cardPoolManager.getPublicCards();
    const { unlocked } = this.lockManager.partitionLocked(publicCards);
    this.cardPoolManager.returnCards(unlocked);

    this.lastAction = 'wait';
    this.totalWaits++;
    this.advanceTurn();
    return true;
  }

  /**
   * 锁定一张公共牌：占公共位。
   * 锁定费不在本动作扣——在回合结束统一结算（settleLockCost，按当回合锁定张数 × LOCK_COST）。
   * 因此同一回合内锁定再解锁不产生任何费用。
   * 上限 = MAX_LOCKED_CARDS（锁满则公共位全占，每回合 0 张新牌，游戏僵死）。
   * @param cardIndex 公共牌索引
   * @returns 是否锁定成功
   */
  executeLockCard(cardIndex: number): LockResult {
    if (this.state !== 'player_action') return { ok: false, reason: 'no_card' };
    const result = this.lockManager.tryLock(
      this.cardPoolManager.getPublicCards(),
      cardIndex,
      this.qiManager.getQi(),
    );
    if (result.ok) this.lastAction = 'lock';
    return result;
  }

  /**
   * 解锁一张公共牌：牌回牌堆。
   * 本动作不扣气也不退气（锁定费只在回合结束结算，锁→解锁无费用）。
   * @param cardIndex 公共牌索引
   * @returns 是否解锁成功
   */
  executeUnlockCard(cardIndex: number): boolean {
    if (this.state !== 'player_action') return false;
    const ok = this.lockManager.tryUnlock(
      this.cardPoolManager.getPublicCards(),
      cardIndex,
    );
    if (ok) this.lastAction = 'unlock';
    return ok;
  }

  /** 获取当前锁定的公共牌 ID 列表 */
  getLockedCardIds(): number[] {
    return this.lockManager.getLockedCardIds();
  }

  /** 判断一张公共牌是否处于锁定状态 */
  isCardLocked(cardId: number): boolean {
    return this.lockManager.isCardLocked(cardId);
  }

  /**
   * 推进游戏回合以及季节流转
   */
  private advanceTurn(): void {
    this.currentRound++;

    // 游戏已到终局：直接结束，不再推进季节循环。
    // 否则最后一回合恰逢季末时，终局推进会连带换季，前端 diff 会把这次
    // "换季"误判为真正的季节切换，在游戏结束画面误播季节转换动画。
    if (this.currentRound > TurnManager.TOTAL_ROUNDS) {
      this.processRound();
      return;
    }

    // 季节检查
    const seasonChanged = this.seasonCycle.advance();
    if (seasonChanged) {
      console.log(`[TurnManager] 季节切换: ${this.seasonCycle.getCurrentSeason()}`);
    }

    // 处理下一回合
    this.processRound();
  }

  /**
   * 结束当前游戏并触发结算
   */
  private endGame(): void {
    this.state = 'game_over';
    this.onStateChange?.('game_over');
    this.onGameEnd?.(this.scoreManager.getScore());

    console.log(`[TurnManager] 游戏结束，最终得分: ${this.scoreManager.getScore()}`);
  }

  /**
   * 导出当前游戏状态为可序列化快照。
   * GameSaveService 负责序列化与 LocalStorage 持久化。
   */
  exportSnapshot(): GameSnapshot {
    return {
      currentRound: this.currentRound,
      state: this.state,
      lastAction: this.lastAction,
      qi: this.qiManager.getQi(),
      score: this.scoreManager.getScore(),
      totalHoldEarnings: this.scoreManager.getTotalHoldEarnings(),
      totalSellEarnings: this.scoreManager.getTotalSellEarnings(),
      totalBuys: this.totalBuys,
      totalSells: this.totalSells,
      totalWaits: this.totalWaits,
      totalLeverageBuys: this.totalLeverageBuys,
      season: {
        index: this.seasonCycle.getCurrentSeasonIndex(),
        roundInSeason: this.seasonCycle.getCurrentRoundInSeason(),
        lengths: this.seasonCycle.getSeasonLengths()
      },
      hand: this.handManager.getHand().map(slot => slot ? {
        cardId: slot.card.id,
        buyScore: slot.buyScore,
        useLeverage: slot.useLeverage,
        leverage: slot.leverage,
        buyRound: slot.buyRound,
        lockedQi: slot.lockedQi,
        holdEarnings: slot.holdEarnings
      } : null),
      pool: {
        deckIds: this.cardPoolManager.getDeck().map(c => c.id),
        publicIds: this.cardPoolManager.getPublicCards().map(c => c.id)
      },
      lockedCardIds: this.lockManager.getLockedCardIds(),
    };
  }

  /**
   * 从已校验的快照还原游戏内部状态。
   * GameSaveService 已完成格式与坏档校验，本方法只负责状态还原。
   */
  importSnapshot(data: GameSnapshot): void {
    // 1. 还原基础状态
    this.currentRound = data.currentRound;
    this.state = data.state as GameState;
    this.lastAction = data.lastAction as ActionType | null;

    // 2. 还原积分
    this.scoreManager.setScore(data.score, data.totalHoldEarnings, data.totalSellEarnings);

    // 还原统计数据
    this.totalBuys = data.totalBuys !== undefined ? data.totalBuys : 0;
    this.totalSells = data.totalSells !== undefined ? data.totalSells : 0;
    this.totalWaits = data.totalWaits !== undefined ? data.totalWaits : 0;
    this.totalLeverageBuys = data.totalLeverageBuys !== undefined ? data.totalLeverageBuys : 0;

    // 3. 还原季节周期
    this.seasonCycle.loadState(data.season.index, data.season.roundInSeason, data.season.lengths);

    // 4. 还原手牌
    const restoredHand = data.hand.map((slotData) => {
      if (!slotData) return null;
      const card = this.cardDataBank.getCard(slotData.cardId);
      if (!card) throw new Error(`找不到 ID 为 ${slotData.cardId} 的卡牌`);
      const lockedQi = slotData.lockedQi !== undefined ? slotData.lockedQi : Math.max(0, this.qiManager.calculateBuyCost(slotData.buyScore, slotData.useLeverage || slotData.leverage > 1) - this.qiManager.getBuyEntryFee());
      const useLeverage = slotData.useLeverage !== undefined ? slotData.useLeverage : slotData.leverage > 1;
      const slot = new HandSlot(card, slotData.buyScore, useLeverage, slotData.leverage, slotData.buyRound, lockedQi);
      slot.holdEarnings = slotData.holdEarnings;
      return slot;
    });
    this.handManager.loadHand(restoredHand);

    // 5. 还原气值（基于最新手牌计算的 totalLockedQi）
    this.qiManager.setQi(data.qi, this.getTotalLockedQi());

    // 6. 还原公共牌池与牌堆
    const restoredDeck = data.pool.deckIds.map((id: number) => {
      const card = this.cardDataBank.getCard(id);
      if (!card) throw new Error(`找不到 ID 为 ${id} 的卡牌`);
      return card;
    });
    const restoredPublic = data.pool.publicIds.map((id: number) => {
      const card = this.cardDataBank.getCard(id);
      if (!card) throw new Error(`找不到 ID 为 ${id} 的卡牌`);
      return card;
    });
    this.cardPoolManager.loadState(restoredDeck, restoredPublic);

    // 7. 还原锁定状态（兼容旧存档：lockedCardIds 缺失则空）
    this.lockManager.restoreLockedCardIds(data.lockedCardIds ? [...data.lockedCardIds] : []);
  }

  /**
   * 一键保存游戏状态至 LocalStorage（委托给 GameSaveService）
   * @returns 是否保存成功
   */
  saveGame(): boolean {
    return this.saveService.save(() => this.exportSnapshot());
  }

  /**
   * 从 LocalStorage 一键读取还原存档（委托给 GameSaveService）
   * @returns 是否读档成功
   */
  loadGame(): boolean {
    return this.saveService.load(
      (data) => this.importSnapshot(data),
      () => {
        // 成功读档后手动触发一次状态广播，让 UI 自动绘制更新
        this.onStateChange?.(this.state);
        this.onTurnStart?.(this.currentRound);
      },
    );
  }

  /**
   * 检查 LocalStorage 中是否已存在有游戏存档（委托给 GameSaveService）
   * @returns 是否有存档
   */
  hasSave(): boolean {
    return this.saveService.hasSave();
  }

  /**
   * 清除已有的存档（委托给 GameSaveService）
   */
  clearSave(): void {
    this.saveService.clear();
  }

  /** 设置状态变化回调 */
  setOnStateChange(callback: (state: GameState) => void): void {
    this.onStateChange = callback;
  }

  /** 设置回合开始回调 */
  setOnTurnStart(callback: (round: number) => void): void {
    this.onTurnStart = callback;
  }

  /** 设置游戏结束回调 */
  setOnGameEnd(callback: (finalScore: number) => void): void {
    this.onGameEnd = callback;
  }

  /** 设置锁定牌被自动解锁回调（付不起锁定费时回合末触发），携带被解锁的牌 ID 列表 */
  setOnLockAutoUnlocked(callback: (cardIds: number[]) => void): void {
    this.onLockAutoUnlocked = callback;
  }

  /** 按 ID 获取卡牌（供 UI 解析自动解锁牌的名称等） */
  getCardById(id: number): JiaziCard | undefined {
    return this.cardDataBank.getCard(id);
  }

  /** 获取当前状态 */
  getState(): GameState {
    return this.state;
  }

  /** 获取当前回合 */
  getCurrentRound(): number {
    return this.currentRound;
  }

  /** 获取当前季节 */
  getCurrentSeason(): Season {
    return this.seasonCycle.getCurrentSeason();
  }

  /** 获取总回合数 */
  getTotalRounds(): number {
    return TurnManager.TOTAL_ROUNDS;
  }

  /** 获取当前气 */
  getQi(): number {
    return this.qiManager.getQi();
  }

  /** 每回合自然回气量 */
  getBaseRecovery(): number {
    return this.qiManager.getBaseRecovery();
  }

  /** 气上限 */
  getMaxQi(): number {
    return this.qiManager.getMaxQi();
  }

  /** 卖出固定手续费 */
  getSellCost(): number {
    return this.qiManager.getSellCost();
  }

  /** 买入入场手续费 */
  getBuyEntryFee(): number {
    return this.qiManager.getBuyEntryFee();
  }

  /** 等待动作的额外回气奖励 */
  getWaitBonus(): number {
    return this.qiManager.getWaitBonus();
  }

  /** 获取当前分数 */
  getScore(): number {
    return this.scoreManager.getScore();
  }

  /** 获取手牌 */
  getHand(): (HandSlot | null)[] {
    return this.handManager.getHand();
  }

  /** 获取公共牌 */
  getPublicCards(): JiaziCard[] {
    return this.cardPoolManager.getPublicCards();
  }

  /** 获取牌堆大小 */
  getDeckSize(): number {
    return this.cardPoolManager.getDeckSize();
  }

  /** 获取当前季节内已进行的回合数 */
  getCurrentRoundInSeason(): number {
    return this.seasonCycle.getCurrentRoundInSeason();
  }

  /** 获取当前季节的总长度 */
  getCurrentSeasonLength(): number {
    return this.seasonCycle.getCurrentSeasonLength();
  }

  /** 获取当前季内杠杆倍数；换季后从 1.0x 重新开始 */
  getLeverageMultiplier(): number {
    return this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason());
  }

  /** 获取当前回合已经生效的持仓气耗（用于 HUD/卡面，不是等待预览）。 */
  getCurrentHoldQiCost(): number {
    const currentSeason = this.getCurrentSeason();
    const currentLeverage = this.getLeverageMultiplier();
    return this.handManager.getHand().reduce((total, slot) => {
      if (!slot) return total;
      const leverage = slot.useLeverage ? currentLeverage : 1;
      return total + this.previewHoldQiCost(
        this.getCardScore(slot.card, currentSeason),
        leverage,
        slot.card.tianGanElement === Element.EARTH,
      );
    }, 0);
  }

  /** 获取下一回合结算时会处于的季节（跨季预览用） */
  getSettlementSeason(): Season {
    return this.seasonCycle.getNextSeason();
  }

  /** 获取季节顺序中的下一季，供卡面“当季 → 下一季”趋势展示。 */
  getFollowingSeason(): Season {
    return this.seasonCycle.getFollowingSeason();
  }

  /**
   * 获取下回合结算时会实际使用的杠杆倍数（预测用）。
   * 玩家行动后结算发生在下一回合；若行动跨季，下一回合季内进度为 1，倍率随之重置。
   */
  getSettlementLeverageMultiplier(): number {
    return this.leverageCalculator.getMultiplier(this.seasonCycle.getNextRoundInSeason());
  }

  /** 获取当前爆仓强平次数 */
  getMarginCallCount(): number {
    return this.marginCallCount;
  }

  getTotalHoldEarnings(): number {
    return this.scoreManager.getTotalHoldEarnings();
  }

  getTotalSellEarnings(): number {
    return this.scoreManager.getTotalSellEarnings();
  }

  /** 预览买入卡牌气消耗 */
  previewBuyCost(card: JiaziCard, useLeverage: boolean): number {
    const score = this.getCardScore(card, this.getCurrentSeason());
    return this.qiManager.calculateBuyCost(score, useLeverage);
  }

  /** 预览持仓卡牌每回合的分收益 */
  previewHoldEarning(cardScore: number, leverage: number): number {
    return this.scoreManager.calculateHoldEarnings(cardScore, leverage);
  }

  /** 预览持仓卡牌每回合的气消耗 */
  previewHoldQiCost(cardScore: number, leverage: number, isEarth: boolean = false): number {
    return this.leverageCalculator.calculateHoldQiCost(cardScore, leverage, isEarth);
  }

  /** 预览卖出卡牌的得分结算 */
  previewSellScore(slot: HandSlot): number {
    const currentScore = this.getCardScore(slot.card, this.getCurrentSeason());
    const effectiveLeverage =
      slot.useLeverage
        ? this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason())
        : 1;
    return this.scoreManager.calculateSellScore(currentScore, slot.buyScore, effectiveLeverage);
  }

  /** 预览卖出实际气变化：释放占用气先封顶，再扣卖出费。 */
  previewSellQiChange(slot: HandSlot): number {
    const currentQi = this.qiManager.getQi();
    return Math.min(this.qiManager.getMaxQi(), currentQi + slot.lockedQi)
      - this.qiManager.getSellCost()
      - currentQi;
  }

  /**
   * 预测一项合法行动提交后，下回合会发生的结算。
   *
   * 与 executeBuy / executeSell / executeWait 共用同一组 qi、计分、杠杆和季节计算器，
   * 但只在本地虚拟手牌上运算，绝不调用会改变牌池或随机源的方法。
   */
  previewSettlement(action: SettlementPreviewAction): SettlementPreview | null {
    if (this.state !== 'player_action') return null;

    const currentSeason = this.seasonCycle.getCurrentSeason();
    const currentQi = this.qiManager.getQi();
    const currentScore = this.scoreManager.getScore();
    const virtualHand = this.handManager.getHand().filter((slot): slot is HandSlot => slot !== null);
    let actionCardName: string | null = null;
    let actionUsesLeverage = false;
    let actionQiChange = 0;
    let actionScoreChange = 0;
    let saleBreakdown: SalePreviewBreakdown | null = null;

    if (action.type === 'buy') {
      if (this.currentRound >= TurnManager.TOTAL_ROUNDS || !this.handManager.canBuy()) return null;
      const card = this.cardPoolManager.getPublicCards()[action.cardIndex];
      if (!card) return null;
      const buyScore = this.getCardScore(card, currentSeason);
      const buyCost = this.qiManager.calculateBuyCost(buyScore, action.leverage);
      if (!this.qiManager.canAfford(buyCost)) return null;

      actionCardName = card.name;
      actionUsesLeverage = action.leverage;
      actionQiChange = -buyCost;
      virtualHand.push(new HandSlot(
        card,
        buyScore,
        action.leverage,
        action.leverage
          ? this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason())
          : 1,
        this.currentRound,
        buyCost - this.qiManager.getBuyEntryFee(),
      ));
    } else if (action.type === 'sell') {
      const slot = this.handManager.getSlot(action.slotIndex);
      if (!slot) return null;
      const sellCost = this.qiManager.getSellCost();
      if (currentQi + slot.lockedQi < sellCost) return null;

      actionCardName = slot.card.name;
      actionUsesLeverage = slot.useLeverage;
      // 与 executeSell 顺序一致：先 recover(lock) 并封顶，再扣卖出费。
      const qiAfterReturn = Math.min(this.qiManager.getMaxQi(), currentQi + slot.lockedQi);
      const lockedQiReturn = qiAfterReturn - currentQi;
      actionQiChange = qiAfterReturn - sellCost - currentQi;
      actionScoreChange = this.previewSellScore(slot);
      const effectiveLeverage = slot.useLeverage
        ? this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason())
        : 1;
      saleBreakdown = {
        buyScore: slot.buyScore,
        currentScore: this.getCardScore(slot.card, currentSeason),
        leverage: effectiveLeverage,
        scoreChange: actionScoreChange,
        lockedQiReturn,
        exitCost: sellCost,
        qiChange: actionQiChange,
      };
      const virtualIndex = virtualHand.indexOf(slot);
      if (virtualIndex < 0) return null;
      virtualHand.splice(virtualIndex, 1);
    }

    const qiAfterAction = currentQi + actionQiChange;
    const scoreAfterAction = currentScore + actionScoreChange;

    // 第 60 回合会在行动后直接结束；不构造虚假的下一回合持仓、回气或最终数值。
    if (this.currentRound >= TurnManager.TOTAL_ROUNDS) {
      return {
        action,
        actionCardName,
        actionUsesLeverage,
        actionQiChange,
        actionScoreChange,
        saleBreakdown,
        qiAfterAction,
        scoreAfterAction,
        endsGame: true,
        nextRound: null,
        nextSeason: null,
        nextRoundInSeason: null,
        settlementLeverage: null,
        holdItems: [],
        holdEarnings: 0,
        holdQiCost: 0,
        qiAfterHold: null,
        baseQiRecover: 0,
        waitQiRecover: 0,
        willMarginCall: false,
        marginCallCandidateNames: [],
        finalQi: null,
        finalScore: null,
      };
    }

    const nextSeason = this.getSettlementSeason();
    const nextRoundInSeason = this.seasonCycle.getNextRoundInSeason();
    const settlementLeverage = this.getSettlementLeverageMultiplier();
    const holdingSettlement = calculateHoldingSettlement(
      virtualHand.map((slot) => ({
        cardName: slot.card.name,
        cardScore: this.getCardScore(slot.card, nextSeason),
        useLeverage: slot.useLeverage,
        isEarth: slot.card.tianGanElement === Element.EARTH,
      })),
      settlementLeverage,
      {
        calculateHoldEarnings: (cardScore, leverage) => this.scoreManager.calculateHoldEarnings(cardScore, leverage),
        calculateHoldQiCost: (cardScore, leverage, isEarth) => this.leverageCalculator.calculateHoldQiCost(cardScore, leverage, isEarth),
      },
    );
    const qiAfterHold = qiAfterAction - holdingSettlement.holdQiCost;
    const marginCallCandidateNames = virtualHand
      .filter((slot) => slot.useLeverage)
      .map((slot) => slot.card.name);
    const willMarginCall = qiAfterHold <= 0 && marginCallCandidateNames.length > 0;
    const baseQiRecover = this.qiManager.getBaseRecovery();
    const waitQiRecover = action.type === 'wait' ? this.qiManager.getWaitBonus() : 0;

    return {
      action,
      actionCardName,
      actionUsesLeverage,
      actionQiChange,
      actionScoreChange,
      saleBreakdown,
      qiAfterAction,
      scoreAfterAction,
      endsGame: false,
      nextRound: this.currentRound + 1,
      nextSeason,
      nextRoundInSeason,
      settlementLeverage,
      holdItems: holdingSettlement.items,
      holdEarnings: holdingSettlement.holdEarnings,
      holdQiCost: holdingSettlement.holdQiCost,
      qiAfterHold,
      baseQiRecover,
      waitQiRecover,
      willMarginCall,
      marginCallCandidateNames,
      finalQi: willMarginCall
        ? null
        : Math.min(this.qiManager.getMaxQi(), qiAfterHold + baseQiRecover + waitQiRecover),
      finalScore: willMarginCall ? null : scoreAfterAction + holdingSettlement.holdEarnings,
    };
  }

  getLastSettlementDetail(): SettlementDetail | null {
    return this.lastSettlementDetail;
  }

  getTotalBuys(): number {
    return this.totalBuys;
  }

  getTotalSells(): number {
    return this.totalSells;
  }

  getTotalWaits(): number {
    return this.totalWaits;
  }

  getTotalLeverageBuys(): number {
    return this.totalLeverageBuys;
  }

  getTotalLockedQi(): number {
    let total = 0;
    this.handManager.getHand().forEach(slot => {
      if (slot) {
        total += slot.lockedQi;
      }
    });
    return total;
  }

  /** 重置游戏 */
  reset(): void {
    this.seasonCycle.reset();
    this.qiManager.reset();
    this.scoreManager.reset();
    this.handManager.reset();
    this.lockManager.reset();
    // 重置牌池后必须重新装填全套卡牌：CardPoolManager.reset 只清空牌堆，
    // 若不重建，新一局 startGame → drawCards 会从空牌堆抽不出公共牌，
    // 导致界面只剩季节、无牌可买（游戏卡死）。
    this.cardPoolManager.initialize(this.cardDataBank.getAllCards());

    this.currentRound = 1;
    this.state = 'init';
    this.lastAction = null;
    this.selectedCardIndex = -1;
    this.useLeverage = false;
    this.marginCallCount = 0;

    this.lastSettlementDetail = null;
    this.totalBuys = 0;
    this.totalSells = 0;
    this.totalWaits = 0;
    this.totalLeverageBuys = 0;
  }
}
