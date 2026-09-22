import { JiaziCard } from './JiaziCard.ts';
import { HandSlot } from './HandSlot.ts';

/**
 * 手牌管理器

/**
 * 手牌管理器
 * 
 * 控制玩家当前持有的卡牌。最大手牌数上限为 3 张。
 * 提供了买入、卖出和检索特定槽位的方法。
 * 
 * @see {@link design/gdd/system-hand-cards.md} 手牌系统设计文档
 */
export class HandManager {
  public static readonly MAX_HAND_SIZE = 3;
  public static readonly MAX_DANTIAN_SIZE = 3;
  public static readonly DEFAULT_MAX_LEYLINE = 2;

  private hand: (HandSlot | null)[];
  private leyline: HandSlot[];
  private maxLeyline: number;

  constructor(maxLeyline: number = HandManager.DEFAULT_MAX_LEYLINE) {
    this.hand = [null, null, null];
    this.leyline = [];
    this.maxLeyline = maxLeyline;
  }

  /**
   * 获取当前活跃丹田手牌列表（包含空位 null）
   * @returns 长度为 3 的手牌数组
   */
  getHand(): (HandSlot | null)[] {
    return this.hand;
  }

  /** 丹田槽位别名 */
  getDantian(): (HandSlot | null)[] {
    return this.hand;
  }

  /** 获取丹田非空卡牌列表 */
  getDantianCards(): HandSlot[] {
    return this.hand.filter((slot): slot is HandSlot => slot !== null);
  }

  /** 活跃丹田卡牌 getter */
  get dantianCards(): HandSlot[] {
    return this.getDantianCards();
  }

  /**
   * 强制载入手牌状态（多用于加载游戏存档还原状态）
   * @param slots 手牌数组 (长度必须为 3)
   * @param leylineSlots 可选的地脉卡牌数组
   */
  loadHand(slots: (HandSlot | null)[], leylineSlots?: HandSlot[]): void {
    this.hand = [...slots];
    if (leylineSlots) {
      this.leyline = [...leylineSlots];
    }
  }

  /** 加载地脉卡牌数据 */
  loadLeyline(slots: HandSlot[]): void {
    this.leyline = [...slots];
  }

  /**
   * 获取当前丹田已持有的卡牌数量
   * @returns 持有卡牌数 (0-3)
   */
  getHandSize(): number {
    return this.hand.filter(slot => slot !== null).length;
  }

  /** 丹田持有数别名 */
  getDantianSize(): number {
    return this.getHandSize();
  }

  /**
   * 检查玩家是否能够买入新牌至丹田
   * @returns 是否可买
   */
  canBuy(): boolean {
    return this.getHandSize() < HandManager.MAX_DANTIAN_SIZE;
  }

  /** 丹田可买别名 */
  canBuyDantian(): boolean {
    return this.canBuy();
  }

  /**
   * 检查玩家是否可以执行卖出操作（丹田或地脉中至少持有一张牌）
   * @returns 是否可卖
   */
  canSell(): boolean {
    return this.getHandSize() > 0 || this.leyline.length > 0;
  }

  /**
   * 买入一张卡牌并放置在丹田第一个空插槽中
   * @param card 卡牌数据对象
   * @param buyScore 购买时当季该卡牌的分数
   * @param useLeverage 是否使用杠杆
   * @param leverage 购买时设置的杠杆倍数
   * @param buyRound 购买时的游戏大回合数
   * @returns 成功放置的插槽索引 (0-2)；若满仓失败则返回 -1
   */
  buy(card: JiaziCard, buyScore: number, useLeverage: boolean, leverage: number, buyRound: number, lockedQi: number): number {
    if (!this.canBuy()) return -1;

    const emptySlotIndex = this.hand.findIndex(slot => slot === null);
    if (emptySlotIndex === -1) return -1;

    this.hand[emptySlotIndex] = new HandSlot(card, buyScore, useLeverage, leverage, buyRound, lockedQi);
    return emptySlotIndex;
  }

  /**
   * 从指定丹田插槽卖出卡牌并清空插槽
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
   * 获取指定插槽内的丹田手牌信息，不影响原手牌数据
   * @param slotIndex 插槽索引 (0-2)
   * @returns 手牌插槽数据
   */
  getSlot(slotIndex: number): HandSlot | null {
    return this.hand[slotIndex] || null;
  }

  // =========================================================================
  // 潜伏地脉 (Leyline Slots) 体系与软超限机制
  // =========================================================================

  /** 获取地脉容量上限（默认 2，造化机缘可临时扩至 3） */
  getMaxLeyline(): number {
    return this.maxLeyline;
  }

  /** 设置地脉容量上限 */
  setMaxLeyline(max: number): void {
    this.maxLeyline = max;
  }

  /** 获取地脉卡牌数组 */
  getLeylineCards(): HandSlot[] {
    return this.leyline;
  }

  /** 地脉卡牌 getter */
  get leylineCards(): HandSlot[] {
    return this.leyline;
  }

  /**
   * 获取用于槽位渲染的地脉数组（补全至 maxLeyline 长度的 null 占位）
   */
  getLeyline(): (HandSlot | null)[] {
    const totalSlots = Math.max(this.maxLeyline, this.leyline.length);
    const result: (HandSlot | null)[] = [];
    for (let i = 0; i < totalSlots; i++) {
      result.push(this.leyline[i] ?? null);
    }
    return result;
  }

  /** 获取当前地脉已潜伏卡牌数 */
  getLeylineSize(): number {
    return this.leyline.length;
  }

  /** 获取指定地脉索引的卡牌插槽 */
  getLeylineSlot(index: number): HandSlot | null {
    return this.leyline[index] ?? null;
  }

  /**
   * 软超限（Soft Cap）判定：
   * 当 leylineCards.length >= maxLeyline 时，严格拒绝新的迁入和新购；
   * 但已有超限卡牌完全保留，可读、可卖、可成局、可升入丹田。
   */
  canAddToLeyline(): boolean {
    return this.leyline.length < this.maxLeyline;
  }

  /** 是否处于地脉软超限状态（数量达到或超过上限） */
  isLeylineSoftCapped(): boolean {
    return this.leyline.length >= this.maxLeyline;
  }

  /**
   * 直接购买卡牌潜入地脉
   * @returns 成功放置的地脉索引；若满仓（软超限拦截）则返回 -1
   */
  buyToLeyline(card: JiaziCard, buyScore: number, useLeverage: boolean, leverage: number, buyRound: number, lockedQi: number): number {
    if (!this.canAddToLeyline()) return -1;

    const slot = new HandSlot(card, buyScore, useLeverage, leverage, buyRound, lockedQi);
    this.leyline.push(slot);
    return this.leyline.length - 1;
  }

  /**
   * 从地脉中释灵卖出卡牌
   * @param index 地脉索引
   * @returns 被卖出的插槽；若索引无效返回 null
   */
  sellLeyline(index: number): HandSlot | null {
    if (index < 0 || index >= this.leyline.length) return null;
    const [slot] = this.leyline.splice(index, 1);
    return slot ?? null;
  }

  /**
   * 丹田下沉地脉：将丹田指定槽位的卡牌移入地脉
   * @param dantianIndex 丹田槽位索引 (0-2)
   * @returns 是否转移成功（若软超限或槽位为空返回 false）
   */
  moveToLeyline(dantianIndex: number): boolean {
    if (dantianIndex < 0 || dantianIndex >= this.hand.length) return false;
    const slot = this.hand[dantianIndex];
    if (!slot) return false;

    // 软超限拦截
    if (!this.canAddToLeyline()) return false;

    this.hand[dantianIndex] = null;
    this.leyline.push(slot);
    return true;
  }

  /**
   * 地脉升入丹田：将地脉指定索引的卡牌移入丹田
   * @param leylineIndex 地脉索引
   * @param targetDantianIndex 可选指定的丹田目标槽位；若未指定则置入第一个空位
   * @returns 是否转移成功（丹田已满或索引无效返回 false）
   */
  moveToDantian(leylineIndex: number, targetDantianIndex?: number): boolean {
    if (leylineIndex < 0 || leylineIndex >= this.leyline.length) return false;
    const slot = this.leyline[leylineIndex];
    if (!slot) return false;

    if (targetDantianIndex !== undefined) {
      if (targetDantianIndex < 0 || targetDantianIndex >= this.hand.length) return false;
      if (this.hand[targetDantianIndex] !== null) return false;
      this.leyline.splice(leylineIndex, 1);
      this.hand[targetDantianIndex] = slot;
      return true;
    }

    const emptyIndex = this.hand.findIndex(s => s === null);
    if (emptyIndex === -1) return false;

    this.leyline.splice(leylineIndex, 1);
    this.hand[emptyIndex] = slot;
    return true;
  }

  /** 获取所有手牌（包含丹田与地脉） */
  getAllCards(): HandSlot[] {
    return [...this.getDantianCards(), ...this.leyline];
  }

  /**
   * 三合大阵引动：按指定 3 个地支寻找并消解卡牌
   * 优先从活跃丹田移除以腾出宝贵前台位，其次从潜伏地脉移除。
   * @param branches 三合局 3 个地支
   * @returns 成功消解的 3 个手牌插槽数据；若未凑齐返回 null 且不修改手牌
   */
  dissolveTriadCards(branches: readonly [string, string, string]): HandSlot[] | null {
    const dantianIndices: number[] = [];
    const leylineIndices: number[] = [];

    const availableDantian: { s: HandSlot | null; idx: number }[] = this.hand.map((s, idx) => ({ s, idx }));
    const availableLeyline: { s: HandSlot | null; idx: number }[] = this.leyline.map((s, idx) => ({ s, idx }));

    for (const b of branches) {
      // 1. 优先丹田
      const dIdx = availableDantian.findIndex(item => item.s !== null && item.s.card.diZhi === b);
      if (dIdx !== -1) {
        dantianIndices.push(availableDantian[dIdx].idx);
        availableDantian[dIdx].s = null;
        continue;
      }
      // 2. 地脉
      const lIdx = availableLeyline.findIndex(item => item.s !== null && item.s.card.diZhi === b);
      if (lIdx !== -1) {
        leylineIndices.push(availableLeyline[lIdx].idx);
        availableLeyline[lIdx].s = null;
        continue;
      }
      return null;
    }

    const dissolved: HandSlot[] = [];
    // 执行丹田清除
    for (const idx of dantianIndices) {
      const slot = this.hand[idx];
      if (slot) {
        dissolved.push(slot);
        this.hand[idx] = null;
      }
    }
    // 执行地脉清除（从大到小删除索引避免漂移）
    leylineIndices.sort((a, b) => b - a);
    for (const idx of leylineIndices) {
      const [slot] = this.leyline.splice(idx, 1);
      if (slot) {
        dissolved.push(slot);
      }
    }

    return dissolved.length === 3 ? dissolved : null;
  }

  /**
   * 重置手牌管理器，清空所有丹田与地脉槽位
   */
  reset(): void {
    this.hand = [null, null, null];
    this.leyline = [];
  }
}
