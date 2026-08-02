import { JiaziCard } from './JiaziCard';
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

/** 游戏主状态 */
export type GameState = 'init' | 'settlement' | 'draw' | 'qi_recover' | 'player_action' | 'game_over';

/** 玩家操作类型 */
export type ActionType = 'buy' | 'sell' | 'wait';

export interface MarginCallDetail {
  cardName: string;
  sellScore: number;
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

  constructor(config?: BalanceConfig, random?: RandomSource) {
    const balanceConfig = config ?? DEFAULT_BALANCE_CONFIG;
    const randomSource = random ?? new MathRandomSource();
    this.balanceConfig = balanceConfig;
    this.random = randomSource;
    this.cardDataBank = new CardDataBank();
    this.seasonCycle = new SeasonCycle(randomSource);
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

    this.lastSettlementDetail = null;
    this.totalBuys = 0;
    this.totalSells = 0;
    this.totalWaits = 0;
    this.totalLeverageBuys = 0;
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

    // 2. 抽牌
    this.cardPoolManager.drawCards();

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
    let totalQiCost = 0;
    let totalHoldEarnings = 0;

    for (const slot of hand) {
      if (slot) {
        // 杠杆持仓：每回合结算时取当前季内回合的实际倍数（换季从 1.0x 重置）
        const effectiveLeverage =
          slot.useLeverage
            ? this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason())
            : 1;

        // 计算持仓收益
        const holdEarnings = this.scoreManager.calculateHoldEarnings(
          this.getCardScore(slot.card, currentSeason),
          effectiveLeverage
        );
        this.scoreManager.addHoldEarnings(holdEarnings);
        slot.holdEarnings += holdEarnings;
        totalHoldEarnings += holdEarnings;

        // 累计持仓气耗
        const qiCost = this.leverageCalculator.calculateHoldQiCost(
          this.getCardScore(slot.card, currentSeason),
          effectiveLeverage
        );
        totalQiCost += qiCost;

        // 记录明细项
        this.lastSettlementDetail?.holdItems.push({
          cardName: slot.card.name,
          earning: holdEarnings,
          qiCost: qiCost,
          leverage: effectiveLeverage
        });
      }
    }

    if (this.lastSettlementDetail) {
      this.lastSettlementDetail.holdEarnings = totalHoldEarnings;
      this.lastSettlementDetail.holdQiCost = totalQiCost;
    }

    // 强制扣除全部持仓气耗（支持扣成负数或0）
    if (totalQiCost > 0) {
      this.qiManager.deductQi(totalQiCost);
    }

    // 结算完成后进行爆仓判定
    if (this.leverageCalculator.checkMarginCall(this.qiManager.getQi())) {
      const details = this.handleMarginCall();
      if (this.lastSettlementDetail && details.length > 0) {
        this.lastSettlementDetail.marginCallTriggered = true;
        this.lastSettlementDetail.marginCallDetails = details;
      }
    }
  }

  /**
   * 处理玩家爆仓情况：寻找玩家手牌中的杠杆卡牌并强行平仓出售
   * 强平会循环随机平仓杠杆牌，正常结算卖出积分，但强平不消耗气，亦不提供卖出即时回气
   *
   * 爆仓扣分公式：杠杆倍数 × |爆仓时卡牌评分| × balanceConfig.marginCallPenaltyPerScore
   * 设计意图：惩罚与杠杆倍数和卡牌价值正相关——高杠杆 + 极端分数 = 剧痛。
   * 示例：3 倍杠杆买入 +4 分牌，爆仓时评分 -2，扣分 = 3 × 2 × 当前配置的 marginCallPenaltyPerScore。
   */
  private handleMarginCall(): MarginCallDetail[] {
    console.log('[TurnManager] 爆仓！气耗尽');
    const details: MarginCallDetail[] = [];

    while (this.qiManager.getQi() <= 0) {
      const hand = this.handManager.getHand();
      const leverageIndices: number[] = [];

      // 收集所有手牌中带有杠杆的插槽索引
      for (let i = 0; i < hand.length; i++) {
        if (hand[i] && hand[i]!.useLeverage) {
          leverageIndices.push(i);
        }
      }

      // 若已无杠杆牌，强平终止（仅剩的普通无杠杆牌允许气为 0 持有，下回合被迫等待）
      if (leverageIndices.length === 0) {
        break;
      }

      // 随机选择一张杠杆牌进行强平（使用注入随机源，保证固定 seed 可复现）
      const targetIndex = leverageIndices[this.random.int(0, leverageIndices.length)];
      const slot = hand[targetIndex]!;

      // 强平移除卡牌 (直接 sell，不扣���卖出气耗，亦不提供卖出即时回气)，并将卡牌回洗入牌堆
      const liquidatedSlot = this.handManager.sell(targetIndex);
      if (liquidatedSlot) {
        this.cardPoolManager.returnCards([liquidatedSlot.card]);
      }
      const newTotalLocked = this.getTotalLockedQi();
      this.marginCallCount++;

      // 爆仓时取当前实际杠杆倍数（动态）
      const effectiveLeverage =
        slot.useLeverage
          ? this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason())
          : 1;

      // 正常获得卖出分数（强平惩罚：正收益打 8 折，负收益 100% 承担）
      const currentScore = this.getCardScore(slot.card, this.seasonCycle.getCurrentSeason());
      const baseSellScore = this.scoreManager.calculateSellScore(
        currentScore,
        slot.buyScore,
        effectiveLeverage
      );
      const multiplier = this.qiManager.getForcedLiquidationScoreMultiplier();
      const finalSellScore = baseSellScore > 0 ? Math.floor(baseSellScore * multiplier) : baseSellScore;
      this.scoreManager.addSellEarnings(finalSellScore);

      // 爆仓扣分：当前杠杆 × |爆仓时卡牌评分| × 系数（来自 BalanceConfig）
      const marginCallPenalty = Math.round(
        effectiveLeverage * Math.abs(currentScore) * this.balanceConfig.marginCallPenaltyPerScore
      );
      this.scoreManager.applyMarginCallPenalty(marginCallPenalty);

      // 强平返还部分占用气
      const forcedLiquidationQiReturn = Math.floor(slot.lockedQi * this.qiManager.getForcedLiquidationQiReturnFactor());
      this.qiManager.recover(forcedLiquidationQiReturn, newTotalLocked);

      // 记录强平细节（扣分系数来自配置，避免调参后展示与实扣不一致）
      const penaltyCoeff = this.balanceConfig.marginCallPenaltyPerScore;
      details.push({
        cardName: slot.card.name,
        sellScore: finalSellScore,
        reason: `气量归零强制平仓，杠杆 ${effectiveLeverage}x，卡牌评分 ${currentScore}，扣分 ${marginCallPenalty}（杠杆 × |评分| × ${penaltyCoeff}）`
      });

      console.log(`[TurnManager] 爆仓强平：移除卡牌 ${slot.card.name}，结算收益 ${finalSellScore} 分，扣分 ${marginCallPenalty}（${effectiveLeverage} × |${currentScore}| × ${penaltyCoeff}），退回占用气 ${forcedLiquidationQiReturn}`);

      // 强平成功后退出，不再提供低保缓冲——玩家必须自行管理气量，感受到爆仓的持续压力
      break;
    }

    return details;
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

    // 未选的牌回牌堆
    const remainingCards = this.cardPoolManager.getPublicCards().filter((_, i) => i !== cardIndex);
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

    // 公共牌回牌堆
    const publicCards = this.cardPoolManager.getPublicCards();
    this.cardPoolManager.returnCards(publicCards);

    this.lastAction = 'wait';
    this.totalWaits++;
    this.advanceTurn();
    return true;
  }

  /**
   * 推进游戏回合以及季节流转
   */
  private advanceTurn(): void {
    this.currentRound++;

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
   * 一键保存游戏状态至 LocalStorage
   * @returns 是否保存成功
   */
  saveGame(): boolean {
    try {
      const stateData = {
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
        }
      };
      localStorage.setItem('jiazi_game_save', JSON.stringify(stateData));
      console.log('[TurnManager] 存档成功');
      return true;
    } catch (e) {
      console.error('[TurnManager] 存档失败:', e);
      return false;
    }
  }

  /**
   * 从 LocalStorage 一键读取还原存档
   * @returns 是否读档成功
   */
  loadGame(): boolean {
    try {
      const raw = localStorage.getItem('jiazi_game_save');
      if (!raw) {
        console.log('[TurnManager] 找不到存档');
        return false;
      }
      const data = JSON.parse(raw);

      // 1. 基础字段验证，确保 qi 是有效数值
      if (
        data.currentRound === undefined ||
        data.qi === undefined ||
        typeof data.qi !== 'number' ||
        isNaN(data.qi)
      ) {
        console.warn('[TurnManager] 存档数据格式不正确，qi 为无效数值');
        this.clearSave();
        return false;
      }

      // 2. 校验无效存档（Round 1 且无手牌且气 <= 0 视为无效坏档）
      const isHandEmpty = !data.hand || data.hand.every((slot: any) => slot === null);
      if (data.currentRound <= 1 && isHandEmpty && data.qi <= 0) {
        console.warn('[TurnManager] 检测到 Round 1 的无效坏档');
        this.clearSave();
        return false;
      }

      // 3. 还原基础状态
      this.currentRound = data.currentRound;
      this.state = data.state;
      this.lastAction = data.lastAction;

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
      const restoredHand = data.hand.map((slotData: any) => {
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

      // 5. 还原公共牌池与牌堆
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

      console.log('[TurnManager] 读档还原成功');
      
      // 成功读档后手动触发一次状态广播，让 UI 自动绘制更新
      this.onStateChange?.(this.state);
      this.onTurnStart?.(this.currentRound);
      
      return true;
    } catch (e) {
      console.error('[TurnManager] 读档失败:', e);
      return false;
    }
  }

  /**
   * 检查 LocalStorage 中是否已存在有游戏存档
   * @returns 是否有存档
   */
  hasSave(): boolean {
    return localStorage.getItem('jiazi_game_save') !== null;
  }

  /**
   * 清除已有的存档
   */
  clearSave(): void {
    localStorage.removeItem('jiazi_game_save');
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
      return total + this.previewHoldQiCost(this.getCardScore(slot.card, currentSeason), leverage);
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
  previewHoldQiCost(cardScore: number, leverage: number): number {
    return this.leverageCalculator.calculateHoldQiCost(cardScore, leverage);
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
    const holdItems = virtualHand.map((slot) => {
      const leverage = slot.useLeverage ? settlementLeverage : 1;
      const cardScore = this.getCardScore(slot.card, nextSeason);
      return {
        cardName: slot.card.name,
        earning: this.scoreManager.calculateHoldEarnings(cardScore, leverage),
        qiCost: this.leverageCalculator.calculateHoldQiCost(cardScore, leverage),
        leverage,
      };
    });
    const holdEarnings = holdItems.reduce((total, item) => total + item.earning, 0);
    const holdQiCost = holdItems.reduce((total, item) => total + item.qiCost, 0);
    const qiAfterHold = qiAfterAction - holdQiCost;
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
      holdItems,
      holdEarnings,
      holdQiCost,
      qiAfterHold,
      baseQiRecover,
      waitQiRecover,
      willMarginCall,
      marginCallCandidateNames,
      finalQi: willMarginCall
        ? null
        : Math.min(this.qiManager.getMaxQi(), qiAfterHold + baseQiRecover + waitQiRecover),
      finalScore: willMarginCall ? null : scoreAfterAction + holdEarnings,
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
    this.cardPoolManager.reset();

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
