/** 杠杆计算器（数值参数来自注入的 BalanceConfig） */
import { BalanceConfig, DEFAULT_BALANCE_CONFIG } from './BalanceConfig';

export class LeverageCalculator {
  private readonly cfg: BalanceConfig;

  constructor(config?: BalanceConfig) {
    this.cfg = config ?? DEFAULT_BALANCE_CONFIG;
  }

  /** 获取当前杠杆倍数（seasonRound 为季内回合进度，换季时由调用方传回 1） */
  getMultiplier(seasonRound: number): number {
    for (const [maxRound, multiplier] of this.cfg.leverageTable) {
      if (seasonRound <= maxRound) {
        return multiplier;
      }
    }
    // 超过表末（总回合 > 表末）兜底返回表内最大倍数
    return this.cfg.leverageTable[this.cfg.leverageTable.length - 1]?.[1] ?? 1.0;
  }

  /** 获取当前杠杆倍数（支持边界） */
  getLeverage(seasonRound: number): number {
    if (seasonRound <= 0) return 1.0;
    return this.getMultiplier(seasonRound);
  }

  /**
   * 计算持仓气耗
   *
   * 基础气耗 = max(holdQiMin, holdQiBase + holdQiScoreFactor * cardScore)
   * 杠杆额外气耗 = (leverage - 1) × leverageQiCostPerX（仅实际放大部分计费）
   *
   * 设计意图：杠杆同时放大收益和持仓压力，让高杠杆位置有真实的持续风险。
   */
  calculateHoldQiCost(cardScore: number, leverage: number): number {
    const baseCost = Math.max(
      this.cfg.holdQiMin,
      this.cfg.holdQiBase + this.cfg.holdQiScoreFactor * cardScore
    );
    return baseCost + (leverage > 1 ? (leverage - 1) * this.cfg.leverageQiCostPerX : 0);
  }

  /** 检查是否需要强制平仓 */
  checkMarginCall(currentQi: number): boolean {
    return currentQi <= 0;
  }
}
