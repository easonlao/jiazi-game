/**
 * 计分管理器
 * 
 * 记录玩家的总得分，并提供持仓收益和卖出收益的详细构成统计。
 * 遵循当前规则：持仓系数为 1.2x，卖出没有基础分，只结算评分差价的 4 倍。
 * 
 * @see {@link design/gdd/system-scoring.md} 计分系统设计文档
 */
export class ScoreManager {
  private static readonly HOLD_BONUS = 1.2;
  private static readonly SELL_BASE = 0;
  private static readonly SPREAD_MULTIPLIER = 4;

  private score: number;
  private totalHoldEarnings: number;
  private totalSellEarnings: number;

  constructor() {
    this.score = 0;
    this.totalHoldEarnings = 0;
    this.totalSellEarnings = 0;
  }

  /**
   * 获取当前游戏的总分数
   * @returns 总分
   */
  getScore(): number {
    return this.score;
  }

  /**
   * 强制设定当前分数状态（多用于加载游戏存档还原状态）
   * @param score 总分
   * @param hold 总持仓收益
   * @param sell 总卖出收益
   */
  setScore(score: number, hold: number, sell: number): void {
    this.score = score;
    this.totalHoldEarnings = hold;
    this.totalSellEarnings = sell;
  }

  /**
   * 获取游戏内累计获得的持仓收益总和
   * @returns 总持仓收益
   */
  getTotalHoldEarnings(): number {
    return this.totalHoldEarnings;
  }

  /**
   * 获取游戏内累计获得的卖出收益总和
   * @returns 总卖出收益
   */
  getTotalSellEarnings(): number {
    return this.totalSellEarnings;
  }

  /**
   * 计算卡牌的持仓收益值
   * 
   * 计算公式: HOLD_BONUS(1.2) * 当季评分 * 杠杆倍数
   * 
   * @param cardScore 该卡牌在当前季节的评分
   * @param leverage 卡牌购买时记录的杠杆倍数
   * @returns 单回合产生的持仓收益
   */
  calculateHoldEarnings(cardScore: number, leverage: number): number {
    return ScoreManager.HOLD_BONUS * cardScore * leverage;
  }

  /** 计算卡牌持仓收益（别名） */
  calculateHoldEarning(cardScore: number, leverage: number): number {
    return this.calculateHoldEarnings(cardScore, leverage);
  }

  /**
   * 计算卡牌卖出时的得分收益
   * 
   * 计算公式: (卖出时评分 - 买入时评分) * SPREAD_MULTIPLIER(4) * 杠杆倍数
   * 
   * @param currentScore 卖出当季卡牌的评分
   * @param buyScore 购买时记录的卡牌评分
   * @param leverage 卡牌持有的杠杆倍数
   * @returns 卖出时获得的得分
   */
  calculateSellScore(currentScore: number, buyScore: number, leverage: number): number {
    return (ScoreManager.SELL_BASE + (currentScore - buyScore) * ScoreManager.SPREAD_MULTIPLIER) * leverage;
  }

  /**
   * 添加持仓收益至总分，并累计至持仓收益统计
   * @param amount 持仓收益数额
   */
  addHoldEarnings(amount: number): void {
    this.score += amount;
    this.totalHoldEarnings += amount;
  }

  /**
   * 添加卖出收益至总分，并累计至卖出收益统计
   * @param amount 卖出收益数额
   */
  addSellEarnings(amount: number): void {
    this.score += amount;
    this.totalSellEarnings += amount;
  }

  /**
   * 应用爆仓强平扣分惩罚
   * @param penaltyAmount 扣分额度（由调用方计算：杠杆 × |爆仓时卡牌评分| × 6）
   *
   * 注意：不扣减 totalSellEarnings，因为惩罚不是卖出交易，不应当混淆统计口径。
   */
  applyMarginCallPenalty(penaltyAmount: number): void {
    this.score = Math.max(0, this.score - penaltyAmount);
  }

  /**
   * 重置分数与各项收益记录为 0
   */
  reset(): void {
    this.score = 0;
    this.totalHoldEarnings = 0;
    this.totalSellEarnings = 0;
  }
}
