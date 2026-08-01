/**
 * 平衡配置：唯一参数来源
 *
 * 所有影响经济/数值的常量收拢于此，通过构造函数注入到各管理器。
 * 默认值与已验证的候选经济模型一致。
 */

/** 杠杆曲线表：季内回合上限 → 杠杆倍数 */
export type LeverageTable = [number, number][];

export interface BalanceConfig {
  /** 评分基线与阴阳波动系数：最终分 = beta + polarity * (raw - 四季均值) */
  scoreBeta: number;
  yangPolarityFactor: number;
  yinPolarityFactor: number;
  // 气
  maxQi: number;
  initialQi: number;
  /** 每回合自然回气 */
  baseRecovery: number;
  /** 等待动作额外回气奖励 */
  waitBonus: number;
  /** 卖出固定手续费 */
  sellCost: number;
  /** 买入基数（不随评分变化的部分） */
  baseBuyCost: number;
  /** 买入消耗随评分的系数：cost = ceil(baseBuyCost * (1 + factor * score)) */
  buyCostFactor: number;
  /** 杠杆买入附加费 LQC。
   *  注意：当前实现中主动卖出仍随 lockedQi 全额返还（lockedQi = buyCost - entryFee 含 LQC），
   *  「LQC 不可退」模型尚未实施（见 handoff 待确认判断）。 */
  lqc: number;
  /** 买入入场手续费，lockedQi = buyCost - buyEntryFee */
  buyEntryFee: number;
  /** 强平保证金退还系数 */
  forcedLiquidationQiReturnFactor: number;
  /** 强平得分折价系数（正收益打折） */
  forcedLiquidationScoreMultiplier: number;

  /** 强平扣分系数：penalty = 杠杆 × |爆仓时评分| × marginCallPenaltyPerScore */
  marginCallPenaltyPerScore: number;

  // 杠杆
  /**
   * 杠杆曲线：[[季内回合上限, 倍数], ...]。
   * 换季重新传入第 1 回合后回到 1.0x。
   */
  leverageTable: LeverageTable;
  /** 持仓气耗公式：base = max(holdQiMin, holdQiBase + holdQiScoreFactor * cardScore) */
  holdQiBase: number;
  holdQiScoreFactor: number;
  holdQiMin: number;
  /** 杠杆每倍额外气耗（仅当倍率大于 1 时）：extra = (leverage - 1) * leverageQiCostPerX */
  leverageQiCostPerX: number;
}

/** 当前默认配置（模拟验证候选） */
export const DEFAULT_BALANCE_CONFIG: BalanceConfig = {
  scoreBeta: 0.02,
  yangPolarityFactor: 1.1,
  yinPolarityFactor: 0.9,
  maxQi: 80,
  initialQi: 50,
  baseRecovery: 10,
  waitBonus: 10,
  sellCost: 4,
  baseBuyCost: 11,
  buyCostFactor: 0.05,
  lqc: 8,
  buyEntryFee: 2,
  forcedLiquidationQiReturnFactor: 0.5,
  forcedLiquidationScoreMultiplier: 0.8,
  marginCallPenaltyPerScore: 6,
  leverageTable: [
    [2, 1.0],
    [5, 2.0],
    [8, 2.5],
    [11, 3.0],
    [12, 3.5],
  ],
  holdQiBase: 1.5,
  holdQiScoreFactor: 0.4,
  holdQiMin: 0.5,
  leverageQiCostPerX: 1,
};

/** 兼容旧调用方的候选配置别名；默认经济参数已采用同一模型。 */
export const CANDIDATE_BALANCE_CONFIG: BalanceConfig = {
  ...DEFAULT_BALANCE_CONFIG,
  baseRecovery: 4,
  waitBonus: 8,
  buyEntryFee: 3,
  sellCost: 5,
};
