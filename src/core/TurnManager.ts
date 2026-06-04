import { JiaziCard } from './JiaziCard';
import { CardDataBank } from './CardDataBank';
import { SeasonCycle, Season } from './SeasonCycle';
import { QiManager } from './QiManager';
import { ScoreManager } from './ScoreManager';
import { LeverageCalculator } from './LeverageCalculator';
import { HandManager } from './HandManager';
import { HandSlot } from './HandSlot';
import { CardPoolManager } from './CardPoolManager';

/** 游戏主状态 */
export type GameState = 'init' | 'settlement' | 'draw' | 'qi_recover' | 'player_action' | 'game_over';

/** 玩家操作类型 */
export type ActionType = 'buy' | 'sell' | 'wait';

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

  // 回调
  private onStateChange?: (state: GameState) => void;
  private onTurnStart?: (round: number) => void;
  private onGameEnd?: (finalScore: number) => void;

  constructor() {
    this.cardDataBank = new CardDataBank();
    this.seasonCycle = new SeasonCycle();
    this.qiManager = new QiManager();
    this.scoreManager = new ScoreManager();
    this.leverageCalculator = new LeverageCalculator();
    this.handManager = new HandManager();
    this.cardPoolManager = new CardPoolManager();

    this.currentRound = 1;
    this.state = 'init';
    this.lastAction = null;
    this.selectedCardIndex = -1;
    this.useLeverage = false;
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

    // 1. 持仓结算
    this.settleHoldings();

    // 2. 抽牌
    this.cardPoolManager.drawCards();

    // 3. 气回复
    this.recoverQi();

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

    for (const slot of hand) {
      if (slot) {
        // 计算持仓收益
        const holdEarnings = this.scoreManager.calculateHoldEarnings(
          slot.card.getSeasonScore(currentSeason),
          slot.leverage
        );
        this.scoreManager.addHoldEarnings(holdEarnings);
        slot.holdEarnings += holdEarnings;

        // 扣除持仓气耗
        const qiCost = this.leverageCalculator.calculateHoldQiCost(
          slot.card.getSeasonScore(currentSeason),
          slot.leverage
        );
        this.qiManager.spend(qiCost);

        // 爆仓检查
        if (this.leverageCalculator.checkMarginCall(this.qiManager.getQi())) {
          this.handleMarginCall();
        }
      }
    }
  }

  /**
   * 处理玩家爆仓情况：寻找玩家手牌中的杠杆卡牌并强行平仓出售
   */
  private handleMarginCall(): void {
    console.log('[TurnManager] 爆仓！气耗尽');
    // 找到杠杆牌并强平
    const hand = this.handManager.getHand();
    for (let i = 0; i < hand.length; i++) {
      if (hand[i] && hand[i]!.leverage > 1) {
        this.handManager.sell(i);
        break;
      }
    }
  }

  /**
   * 自然回复玩家的气，若上回合选择等待则提供额外奖励
   */
  private recoverQi(): void {
    this.qiManager.recover(this.qiManager.getBaseRecovery());

    if (this.lastAction === 'wait') {
      this.qiManager.recover(this.qiManager.getWaitBonus());
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

    const card = this.cardPoolManager.getPublicCards()[cardIndex];
    if (!card) return false;

    // 检查手牌是否已满
    if (!this.handManager.canBuy()) {
      console.log('[TurnManager] 手牌已满');
      return false;
    }

    // 计算买入消耗
    const buyCost = this.qiManager.calculateBuyCost(
      card.getSeasonScore(this.seasonCycle.getCurrentSeason()),
      leverage
    );

    // 检查气是否足够
    if (!this.qiManager.canAfford(buyCost)) {
      console.log('[TurnManager] 气不足');
      return false;
    }

    // 执行买入
    this.qiManager.spend(buyCost);
    const buyScore = card.getSeasonScore(this.seasonCycle.getCurrentSeason());
    const slotIndex = this.handManager.buy(
      card,
      buyScore,
      leverage ? this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason()) : 1,
      this.currentRound
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

    // 检查气是否足够
    if (!this.qiManager.canAfford(this.qiManager.getSellCost())) {
      console.log('[TurnManager] 气不足');
      return false;
    }

    // 执行卖出
    this.qiManager.spend(this.qiManager.getSellCost());

    const currentScore = slot.card.getSeasonScore(this.seasonCycle.getCurrentSeason());
    const sellScore = this.scoreManager.calculateSellScore(
      currentScore,
      slot.buyScore,
      slot.leverage
    );
    this.scoreManager.addSellEarnings(sellScore);

    // 即时回复气
    this.qiManager.recover(this.qiManager.getSellRecover());

    // 移除卡牌
    this.handManager.sell(slotIndex);

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
        season: {
          index: this.seasonCycle.getCurrentSeasonIndex(),
          roundInSeason: this.seasonCycle.getCurrentRoundInSeason(),
          lengths: this.seasonCycle.getSeasonLengths()
        },
        hand: this.handManager.getHand().map(slot => slot ? {
          cardId: slot.card.id,
          buyScore: slot.buyScore,
          leverage: slot.leverage,
          buyRound: slot.buyRound,
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

      // 1. 还原基础状态
      this.currentRound = data.currentRound;
      this.state = data.state;
      this.lastAction = data.lastAction;

      // 2. 还原气与积分
      this.qiManager.setQi(data.qi);
      this.scoreManager.setScore(data.score, data.totalHoldEarnings, data.totalSellEarnings);

      // 3. 还原季节周期
      this.seasonCycle.loadState(data.season.index, data.season.roundInSeason, data.season.lengths);

      // 4. 还原手牌
      const restoredHand = data.hand.map((slotData: any) => {
        if (!slotData) return null;
        const card = this.cardDataBank.getCard(slotData.cardId);
        if (!card) throw new Error(`找不到 ID 为 ${slotData.cardId} 的卡牌`);
        const slot = new HandSlot(card, slotData.buyScore, slotData.leverage, slotData.buyRound);
        slot.holdEarnings = slotData.holdEarnings;
        return slot;
      });
      this.handManager.loadHand(restoredHand);

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

  /** 获取当前气 */
  getQi(): number {
    return this.qiManager.getQi();
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

  /** 获取当前杠杆倍数 */
  getLeverageMultiplier(): number {
    return this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason());
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
  }
}
