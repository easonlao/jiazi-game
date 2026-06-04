/**
 * 气资源管理器
 * 
 * 管理玩家在游戏中的“气”资源，包括气的当前值、上限、消耗计算、自然回复及等待加成。
 * 符合游戏设计文档中关于气上限（80）、初始气（50）以及动作消耗的相关规范。
 * 
 * @see {@link design/gdd/system-qi-resource.md} 气资源设计文档
 */
export class QiManager {
  private static readonly MAX_QI = 80;
  private static readonly INITIAL_QI = 50;
  private static readonly BASE_RECOVERY = 7;
  private static readonly WAIT_BONUS = 10;
  private static readonly SELL_COST = 3;
  private static readonly SELL_RECOVER = 9;
  private static readonly BASE_BUY_COST = 11;
  private static readonly BUY_COST_FACTOR = 0.05;

  private qi: number;
  private maxQi: number;

  constructor(initialQi?: number) {
    this.maxQi = QiManager.MAX_QI;
    this.qi = initialQi !== undefined ? initialQi : QiManager.INITIAL_QI;
    if (initialQi !== undefined) {
      this.qi = Math.max(0, Math.min(this.maxQi, initialQi));
    }
  }

  /**
   * 获取当前的气值
   * @returns 当前气值
   */
  getQi(): number {
    return this.qi;
  }

  /**
   * 强制设定当前的气值（多用于加载游戏存档还原状态）
   * @param value 气值
   */
  setQi(value: number): void {
    this.qi = Math.max(0, Math.min(this.maxQi, value));
  }

  /**
   * 获取最大气值限制
   * @returns 最大气值限制
   */
  getMaxQi(): number {
    return this.maxQi;
  }

  /**
   * 消耗特定额度的气
   * @param amount 消耗额度
   * @returns 是否扣除成功（气不足返回 false 且不扣除）
   */
  spend(amount: number): boolean {
    if (this.qi < amount) return false;
    this.qi -= amount;
    return true;
  }

  /**
   * 恢复指定额度的气，且不会超过最大气上限限制
   * @param amount 恢复额度
   */
  recover(amount: number): void {
    this.qi = Math.min(this.maxQi, this.qi + amount);
  }

  /**
   * 检查当前是否有足够的气进行某操作
   * @param amount 所需气值
   * @returns 是否足够
   */
  canAfford(amount: number): boolean {
    return this.qi >= amount;
  }

  /**
   * 计算买入某张卡牌时的气耗（受卡牌当前季节评分和是否使用杠杆的影响）
   * 
   * 计算公式: Math.ceil(BASE_BUY_COST * (1 + BUY_COST_FACTOR * cardScore)) [+ 10 (杠杆)]
   * 
   * @param cardScore 该卡牌在当前季节的评分
   * @param useLeverage 是否加杠杆
   * @returns 消耗的气量值
   */
  calculateBuyCost(cardScore: number, useLeverage: boolean = false): number {
    let cost = QiManager.BASE_BUY_COST * (1 + QiManager.BUY_COST_FACTOR * cardScore);
    if (useLeverage) {
      cost += 10; // 杠杆额外消耗 10 气
    }
    return Math.ceil(cost);
  }

  /** 应用自然回复 */
  applyNaturalRecovery(): void {
    this.recover(QiManager.BASE_RECOVERY);
  }

  /** 应用卖出即时回复 */
  applySellRecovery(): void {
    this.recover(QiManager.SELL_RECOVER);
  }

  /** 应用等待额外回复 */
  applyWaitRecovery(): void {
    this.recover(QiManager.WAIT_BONUS);
  }

  /** 计算持仓气耗 */
  calculateHoldCost(score: number, leverage: number): number {
    return Math.max(0.5, 1.5 + 0.4 * score) * leverage;
  }

  /** 扣除气（支持负值以触发爆仓） */
  deductQi(amount: number): void {
    this.qi -= amount;
  }

  /** 检查是否爆仓 */
  isMarginCall(): boolean {
    return this.qi <= 0;
  }

  /**
   * 获取卖出卡牌需要扣除的气耗
   * @returns 卖出气耗 (默认为 3)
   */
  getSellCost(): number {
    return QiManager.SELL_COST;
  }

  /**
   * 获取卖出卡牌后即时回复的气值
   * @returns 卖出回复气量 (默认为 8)
   */
  getSellRecover(): number {
    return QiManager.SELL_RECOVER;
  }

  /**
   * 获取每回合的基础自然回复气量
   * @returns 基础回复气量 (默认为 7)
   */
  getBaseRecovery(): number {
    return QiManager.BASE_RECOVERY;
  }

  /**
   * 获取执行“等待”操作后下回合能获得的额外回复气量
   * @returns 等待额外回复气量 (默认为 10)
   */
  getWaitBonus(): number {
    return QiManager.WAIT_BONUS;
  }

  /**
   * 重置气资源管理器至初始状态
   */
  reset(): void {
    this.qi = QiManager.INITIAL_QI;
  }
}
