/** 计分管理器 */
export class ScoreManager {
  private static readonly HOLD_BONUS = 1.2;
  private static readonly SELL_BASE = 8;
  private static readonly SPREAD_MULTIPLIER = 4;

  private score: number;
  private totalHoldEarnings: number;
  private totalSellEarnings: number;

  constructor() {
    this.score = 0;
    this.totalHoldEarnings = 0;
    this.totalSellEarnings = 0;
  }

  /** 获取当前总分 */
  getScore(): number {
    return this.score;
  }

  /** 获取总持仓收益 */
  getTotalHoldEarnings(): number {
    return this.totalHoldEarnings;
  }

  /** 获取总卖出收益 */
  getTotalSellEarnings(): number {
    return this.totalSellEarnings;
  }

  /** 计算持仓收益 */
  calculateHoldEarnings(cardScore: number, leverage: number): number {
    return ScoreManager.HOLD_BONUS * cardScore * leverage;
  }

  /** 计算卖出得分 */
  calculateSellScore(currentScore: number, buyScore: number, leverage: number): number {
    return (ScoreManager.SELL_BASE + (currentScore - buyScore) * ScoreManager.SPREAD_MULTIPLIER) * leverage;
  }

  /** 添加持仓收益 */
  addHoldEarnings(amount: number): void {
    this.score += amount;
    this.totalHoldEarnings += amount;
  }

  /** 添加卖出收益 */
  addSellEarnings(amount: number): void {
    this.score += amount;
    this.totalSellEarnings += amount;
  }

  /** 重置 */
  reset(): void {
    this.score = 0;
    this.totalHoldEarnings = 0;
    this.totalSellEarnings = 0;
  }
}
