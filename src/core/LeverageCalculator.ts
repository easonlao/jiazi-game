/** 杠杆计算器 */
export class LeverageCalculator {
  private static readonly MULTIPLIER_TABLE: [number, number][] = [
    [3, 1.0],
    [6, 1.5],
    [9, 2.0],
    [11, 2.5],
    [12, 3.0],
  ];

  /** 获取当前杠杆倍数 */
  getMultiplier(seasonRound: number): number {
    for (const [maxRound, multiplier] of LeverageCalculator.MULTIPLIER_TABLE) {
      if (seasonRound <= maxRound) {
        return multiplier;
      }
    }
    return 3.0;
  }

  /** 获取当前杠杆倍数（支持边界） */
  getLeverage(seasonRound: number): number {
    if (seasonRound <= 0) return 1.0;
    return this.getMultiplier(seasonRound);
  }

  /** 计算持仓气耗 */
  calculateHoldQiCost(cardScore: number, leverage: number): number {
    return Math.max(0.5, 1.5 + 0.4 * cardScore) * leverage;
  }

  /** 检查是否需要强制平仓 */
  checkMarginCall(currentQi: number): boolean {
    return currentQi <= 0;
  }
}
