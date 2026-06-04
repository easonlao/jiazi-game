import { JiaziCard } from './JiaziCard';
import { HandSlot } from './HandSlot';

/**
 * 手牌管理器
 * 
 * 控制玩家当前持有的卡牌。最大手牌数上限为 3 张。
 * 提供了买入、卖出和检索特定槽位的方法。
 * 
 * @see {@link design/gdd/system-hand-cards.md} 手牌系统设计文档
 */
export class HandManager {
  private static readonly MAX_HAND_SIZE = 3;

  private hand: (HandSlot | null)[];

  constructor() {
    this.hand = [null, null, null];
  }

  /**
   * 获取当前手牌列表（包含空位 null）
   * @returns 长度为 3 的手牌数组
   */
  getHand(): (HandSlot | null)[] {
    return this.hand;
  }

  /**
   * 强制载入手牌状态（多用于加载游戏存档还原状态）
   * @param slots 手牌数组 (长度必须为 3)
   */
  loadHand(slots: (HandSlot | null)[]): void {
    this.hand = [...slots];
  }

  /**
   * 获取当前已持有的卡牌数量
   * @returns 持有卡牌数 (0-3)
   */
  getHandSize(): number {
    return this.hand.filter(slot => slot !== null).length;
  }

  /**
   * 检查玩家是否能够买入新牌
   * @returns 是否可买
   */
  canBuy(): boolean {
    return this.getHandSize() < HandManager.MAX_HAND_SIZE;
  }

  /**
   * 检查玩家是否可以执行卖出操作（即至少持有一张牌）
   * @returns 是否可卖
   */
  canSell(): boolean {
    return this.getHandSize() > 0;
  }

  /**
   * 买入一张卡牌并放置在第一个空插槽中
   * @param card 卡牌数据对象
   * @param buyScore 购买时当季该卡牌的分数
   * @param leverage 购买时设置的杠杆倍数
   * @param buyRound 购买时的游戏大回合数
   * @returns 成功放置的插槽索引 (0-2)；若满仓失败则返回 -1
   */
  buy(card: JiaziCard, buyScore: number, leverage: number, buyRound: number): number {
    if (!this.canBuy()) return -1;

    const emptySlotIndex = this.hand.findIndex(slot => slot === null);
    if (emptySlotIndex === -1) return -1;

    this.hand[emptySlotIndex] = new HandSlot(card, buyScore, leverage, buyRound);
    return emptySlotIndex;
  }

  /**
   * 从指定手牌插槽强平或卖出卡牌并清空插槽
   * @param slotIndex 插槽索引 (0-2)
   * @returns 被卖出的手牌插槽数据；若无牌或索引无效返回 null
   */
  sell(slotIndex: number): HandSlot | null {
    if (slotIndex < 0 || slotIndex >= this.hand.length) return null;

    const slot = this.hand[slotIndex];
    this.hand[slotIndex] = null;
    return slot;
  }

  /**
   * 获取指定插槽内的手牌信息，不影响原手牌数据
   * @param slotIndex 插槽索引 (0-2)
   * @returns 手牌插槽数据
   */
  getSlot(slotIndex: number): HandSlot | null {
    return this.hand[slotIndex] || null;
  }

  /**
   * 重置手牌管理器，清空所有槽位
   */
  reset(): void {
    this.hand = [null, null, null];
  }
}
