/**
 * 平衡配置：唯一参数来源
 *
 * 所有影响经济/数值的常量收拢于此，通过构造函数注入到各管理器。
 * 默认值与现状（2026-07-31 Codex handoff 核对）一致。
 *
 * 候选参数（Codex handoff 建议，未经模拟验证前不启用）：
 *   baseRecovery: 4, waitBonus: 8, buyEntryFee: 3, sellCost: 5
 */

/** 杠杆曲线表：季内回合上限 → 杠杆倍数 */
export type LeverageTable = [number, number][];

export interface BalanceConfig {
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
   * 默认每 3 个季内回合升一档；3 回合的最短季也能在季末升至 1.5x，
   * 换季重新传入第 1 回合后回到 1.0x。
   */
  leverageTable: LeverageTable;
  /** 持仓气耗公式：base = max(holdQiMin, holdQiBase + holdQiScoreFactor * cardScore) */
  holdQiBase: number;
  holdQiScoreFactor: number;
  holdQiMin: number;
  /** 杠杆每倍额外气耗：extra = leverage * leverageQiCostPerX */
  leverageQiCostPerX: number;
}

/** 当前默认配置（与现有行为一致） */
export const DEFAULT_BALANCE_CONFIG: BalanceConfig = {
  maxQi: 80,
  initialQi: 50,
  baseRecovery: 10,
  waitBonus: 10,
  sellCost: 4,
  baseBuyCost: 11,
  buyCostFactor: 0.05,
  lqc: 14,
  buyEntryFee: 2,
  forcedLiquidationQiReturnFactor: 0.5,
  forcedLiquidationScoreMultiplier: 0.8,
  marginCallPenaltyPerScore: 6,
  leverageTable: [
    [2, 1.0],
    [5, 1.5],
    [8, 2.0],
    [11, 2.5],
    [12, 3.0],
  ],
  holdQiBase: 1.5,
  holdQiScoreFactor: 0.4,
  holdQiMin: 0.5,
  leverageQiCostPerX: 4,
};

/** Codex handoff 候选配置（Phase 3 模拟验证用，勿直接设为默认） */
export const CANDIDATE_BALANCE_CONFIG: BalanceConfig = {
  ...DEFAULT_BALANCE_CONFIG,
  baseRecovery: 4,
  waitBonus: 8,
  buyEntryFee: 3,
  sellCost: 5,
};
