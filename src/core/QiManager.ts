/** 气资源管理器 */
export class QiManager {
  private static readonly MAX_QI = 80;
  private static readonly INITIAL_QI = 50;
  private static readonly BASE_RECOVERY = 7;
  private static readonly WAIT_BONUS = 10;
  private static readonly SELL_COST = 3;
  private static readonly SELL_RECOVER = 8;
  private static readonly BASE_BUY_COST = 12;
  private static readonly BUY_COST_FACTOR = 0.05;

  private qi: number;
  private maxQi: number;

  constructor() {
    this.qi = QiManager.INITIAL_QI;
    this.maxQi = QiManager.MAX_QI;
  }

  /** 获取当前气值 */
  getQi(): number {
    return this.qi;
  }

  /** 获取最大气值 */
  getMaxQi(): number {
    return this.maxQi;
  }

  /** 消耗气 */
  spend(amount: number): boolean {
    if (this.qi < amount) return false;
    this.qi -= amount;
    return true;
  }

  /** 恢复气 */
  recover(amount: number): void {
    this.qi = Math.min(this.maxQi, this.qi + amount);
  }

  /** 检查是否有足够的气 */
  canAfford(amount: number): boolean {
    return this.qi >= amount;
  }

  /** 计算买入消耗 */
  calculateBuyCost(cardScore: number, useLeverage: boolean): number {
    let cost = QiManager.BASE_BUY_COST * (1 + QiManager.BUY_COST_FACTOR * cardScore);
    if (useLeverage) {
      cost += 10; // 杠杆额外消耗
    }
    return Math.ceil(cost);
  }

  /** 获取卖出消耗 */
  getSellCost(): number {
    return QiManager.SELL_COST;
  }

  /** 获取卖出回复 */
  getSellRecover(): number {
    return QiManager.SELL_RECOVER;
  }

  /** 获取基础回复量 */
  getBaseRecovery(): number {
    return QiManager.BASE_RECOVERY;
  }

  /** 获取等待额外回复 */
  getWaitBonus(): number {
    return QiManager.WAIT_BONUS;
  }

  /** 重置 */
  reset(): void {
    this.qi = QiManager.INITIAL_QI;
  }
}
