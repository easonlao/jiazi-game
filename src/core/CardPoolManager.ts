import { JiaziCard } from './JiaziCard';
import { MathRandomSource, RandomSource } from './RandomSource';

/**
 * 牌池管理器
 * 
 * 维护游戏中的共享卡牌堆（Deck）以及每回合刷新到公共展示区域供买入的选择卡牌。
 * 遵循游戏设计中关于每回合从牌堆随机抽取 3 张并在决策后未买入卡牌回洗归还牌堆的规则。
 * 随机源可注入（测试/模拟器用固定 seed），默认 Math.random。
 * 
 * @see {@link design/gdd/system-card-pool.md} 牌池系统设计文档
 */
export class CardPoolManager {
  private static readonly DRAW_COUNT = 3;

  private deck: JiaziCard[];
  private publicCards: JiaziCard[];
  private readonly random: RandomSource;

  constructor(random?: RandomSource) {
    this.deck = [];
    this.publicCards = [];
    this.random = random ?? new MathRandomSource();
  }

  /**
   * 初始化牌池，置入所有的甲子卡牌并进行首轮洗牌
   * @param cards 全套卡牌数组
   */
  initialize(cards: JiaziCard[]): void {
    this.deck = [...cards];
    this.shuffleDeck();
    console.log(`[CardPoolManager] 初始化完成，牌堆 ${this.deck.length} 张`);
  }

  /**
   * 加载保存的牌池与牌堆状态（用于存档还原状态）
   * @param deck 牌堆卡牌列表
   * @param publicCards 公共展示区域卡牌列表
   */
  loadState(deck: JiaziCard[], publicCards: JiaziCard[]): void {
    this.deck = [...deck];
    this.publicCards = [...publicCards];
  }

  /**
   * 获取当前的剩余牌堆列表（不影响原牌堆）
   * @returns 牌堆卡牌数组
   */
  getDeck(): JiaziCard[] {
    return this.deck;
  }

  /**
   * 采用 Fisher-Yates 算法对剩余牌堆进行洗牌
   */
  private shuffleDeck(): void {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = this.random.int(0, i + 1);
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  /**
   * 从剩余牌堆最上方抽取卡牌放入公共展示池。
   * 锁定机制：锁定牌保留在公共区，抽牌数 = DRAW_COUNT - 锁定数（保证公共位不超上限）。
   * @param lockedCardIds 当前锁定的卡牌 ID 列表（锁定牌留在公共区）
   * @returns 抽出的公共卡牌列表
   */
  drawCards(lockedCardIds: number[] = []): JiaziCard[] {
    const lockedCards = this.publicCards.filter((card) => lockedCardIds.includes(card.id));
    const drawCount = Math.min(
      CardPoolManager.DRAW_COUNT - lockedCards.length,
      this.deck.length
    );
    const newCards = this.deck.splice(0, Math.max(0, drawCount));
    this.publicCards = [...lockedCards, ...newCards];
    return this.publicCards;
  }

  /**
   * 玩家买入展示池中指定卡牌，将未选择的牌归还回牌堆中
   * @param index 展示池索引 (0 或 1)
   * @returns 买入的卡牌数据；若索引不合法则返回 null
   */
  buyCard(index: number): JiaziCard | null {
    if (index < 0 || index >= this.publicCards.length) return null;

    const card = this.publicCards[index];
    this.publicCards.splice(index, 1);

    // 未选的牌回牌堆
    this.returnCards(this.publicCards);
    this.publicCards = [];

    return card;
  }

  /**
   * 将多张卡牌归还回剩余牌堆的随机位置，以确保随机洗牌的特性
   * @param cards 待归还的卡牌数组
   */
  returnCards(cards: JiaziCard[]): void {
    for (const card of cards) {
      // 插入范围 [0, deck.length]（含末尾位置），避免末尾位置概率偏低
      const insertIndex = this.random.int(0, this.deck.length + 1);
      this.deck.splice(insertIndex, 0, card);
    }
  }

  /**
   * 获取当前刷新显示的公共卡牌
   * @returns 公共展示卡牌数组
   */
  getPublicCards(): JiaziCard[] {
    return this.publicCards;
  }

  /**
   * 获取剩余牌堆大小
   * @returns 牌堆卡牌张数
   */
  getDeckSize(): number {
    return this.deck.length;
  }

  /**
   * 检查牌堆中是否已经抽空
   * @returns 是否为空
   */
  isEmpty(): boolean {
    return this.deck.length === 0;
  }

  /**
   * 重置牌池，清空牌堆和公共卡牌
   */
  reset(): void {
    this.deck = [];
    this.publicCards = [];
  }
}
