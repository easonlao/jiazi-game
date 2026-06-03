import { JiaziCard } from './JiaziCard';

/** 牌池管理器 */
export class CardPoolManager {
  private static readonly DRAW_COUNT = 2;

  private deck: JiaziCard[];
  private publicCards: JiaziCard[];

  constructor() {
    this.deck = [];
    this.publicCards = [];
  }

  /** 初始化牌池 */
  initialize(cards: JiaziCard[]): void {
    this.deck = [...cards];
    this.shuffleDeck();
    console.log(`[CardPoolManager] 初始化完成，牌堆 ${this.deck.length} 张`);
  }

  /** 洗牌 */
  private shuffleDeck(): void {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  /** 抽牌 */
  drawCards(): JiaziCard[] {
    const drawCount = Math.min(CardPoolManager.DRAW_COUNT, this.deck.length);
    this.publicCards = this.deck.splice(0, drawCount);
    return this.publicCards;
  }

  /** 买入卡牌 */
  buyCard(index: number): JiaziCard | null {
    if (index < 0 || index >= this.publicCards.length) return null;

    const card = this.publicCards[index];
    this.publicCards.splice(index, 1);

    // 未选的牌回牌堆
    this.returnCards(this.publicCards);
    this.publicCards = [];

    return card;
  }

  /** 回牌 */
  returnCards(cards: JiaziCard[]): void {
    for (const card of cards) {
      const insertIndex = Math.floor(Math.random() * this.deck.length);
      this.deck.splice(insertIndex, 0, card);
    }
  }

  /** 获取公共牌 */
  getPublicCards(): JiaziCard[] {
    return this.publicCards;
  }

  /** 获取牌堆大小 */
  getDeckSize(): number {
    return this.deck.length;
  }

  /** 检查牌堆是否为空 */
  isEmpty(): boolean {
    return this.deck.length === 0;
  }

  /** 重置 */
  reset(): void {
    this.deck = [];
    this.publicCards = [];
  }
}
