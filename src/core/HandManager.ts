import { JiaziCard } from './JiaziCard';
import { HandSlot } from './HandSlot';

/** 手牌管理器 */
export class HandManager {
  private static readonly MAX_HAND_SIZE = 3;

  private hand: (HandSlot | null)[];

  constructor() {
    this.hand = [null, null, null];
  }

  /** 获取手牌 */
  getHand(): (HandSlot | null)[] {
    return this.hand;
  }

  /** 获取手牌数量 */
  getHandSize(): number {
    return this.hand.filter(slot => slot !== null).length;
  }

  /** 检查是否可以买入 */
  canBuy(): boolean {
    return this.getHandSize() < HandManager.MAX_HAND_SIZE;
  }

  /** 检查是否可以卖出 */
  canSell(): boolean {
    return this.getHandSize() > 0;
  }

  /** 买入卡牌 */
  buy(card: JiaziCard, buyScore: number, leverage: number, buyRound: number): number {
    if (!this.canBuy()) return -1;

    const emptySlotIndex = this.hand.findIndex(slot => slot === null);
    if (emptySlotIndex === -1) return -1;

    this.hand[emptySlotIndex] = new HandSlot(card, buyScore, leverage, buyRound);
    return emptySlotIndex;
  }

  /** 卖出卡牌 */
  sell(slotIndex: number): HandSlot | null {
    if (slotIndex < 0 || slotIndex >= this.hand.length) return null;

    const slot = this.hand[slotIndex];
    this.hand[slotIndex] = null;
    return slot;
  }

  /** 获取指定槽位 */
  getSlot(slotIndex: number): HandSlot | null {
    return this.hand[slotIndex] || null;
  }

  /** 重置 */
  reset(): void {
    this.hand = [null, null, null];
  }
}
