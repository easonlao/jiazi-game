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
  /** 终局出清收益累计（独立口径：终局强制平仓，非玩家主动释灵，局终修为构成单独展示） */
  private totalSettleEarnings: number;
  /** 反噬罚分累计（局终展示"反噬扣分"用；独立于买卖收益口径） */
  private totalMarginCallPenalty: number;

  constructor() {
    this.score = 0;
    this.totalHoldEarnings = 0;
    this.totalSellEarnings = 0;
    this.totalSettleEarnings = 0;
    this.totalMarginCallPenalty = 0;
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
   * @param marginCallPenalty 反噬罚分累计（老存档无此字段时默认 0）
   * @param settle 终局出清收益累计（老存档无此字段时默认 0）
   */
  setScore(score: number, hold: number, sell: number, marginCallPenalty: number = 0, settle: number = 0): void {
    this.score = score;
    this.totalHoldEarnings = hold;
    this.totalSellEarnings = sell;
    this.totalMarginCallPenalty = marginCallPenalty;
    this.totalSettleEarnings = settle;
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
   * 添加终局出清收益至总分（独立统计口径：终局强制平仓，非玩家主动释灵）。
   * 计分规则与卖出相同（评分差 × 4 × 杠杆），但累计到 totalSettleEarnings，
   * 与 totalSellEarnings 分开，避免污染"主动释灵收益"统计。
   * @param amount 出清收益数额
   */
  addSettleEarnings(amount: number): void {
    this.score += amount;
    this.totalSettleEarnings += amount;
  }

  /** 获取终局出清收益累计 */
  getTotalSettleEarnings(): number {
    return this.totalSettleEarnings;
  }

  /**
   * 应用爆仓强平扣分惩罚
   * @param penaltyAmount 扣分额度（由调用方计算：杠杆 × |爆仓时卡牌评分| × marginCallPenaltyPerScore）
   *
   * 注意：不扣减 totalSellEarnings，因为惩罚不是卖出交易，不应当混淆统计口径。
   * 分数可以为负（与持仓亏损一致），不设下限截断。
   */
  applyMarginCallPenalty(penaltyAmount: number): void {
    this.score -= penaltyAmount;
    this.totalMarginCallPenalty += penaltyAmount;
  }

  /** 获取反噬罚分累计 */
  getTotalMarginCallPenalty(): number {
    return this.totalMarginCallPenalty;
  }

  /**
   * 重置分数与各项收益记录为 0
   */
  reset(): void {
    this.score = 0;
    this.totalHoldEarnings = 0;
    this.totalSellEarnings = 0;
    this.totalSettleEarnings = 0;
    this.totalMarginCallPenalty = 0;
  }
}
