/**
 * 气资源管理器
 * 
 * 管理玩家在游戏中的“气”资源，包括气的当前值、上限、消耗计算、自然回复及等待加成。
 * 数值参数全部来自注入的 BalanceConfig（唯一参数来源）。
 * 
 * @see {@link design/gdd/system-qi-resource.md} 气资源设计文档
 */
import { BalanceConfig, DEFAULT_BALANCE_CONFIG } from './BalanceConfig';

export class QiManager {
  private readonly cfg: BalanceConfig;

  private qi: number;
  private maxQi: number;

  constructor(initialQi?: number, config?: BalanceConfig) {
    this.cfg = config ?? DEFAULT_BALANCE_CONFIG;
    this.maxQi = this.cfg.maxQi;
    this.qi = initialQi !== undefined ? initialQi : this.cfg.initialQi;
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
   * @param _totalLockedQi 已废弃：qi 是总气，lockedQi 不应影响 qi 的存储上限
   */
  setQi(value: number, _totalLockedQi: number = 0): void {
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
   * @param _totalLockedQi 已废弃：qi 是总气，lockedQi 不应影响回气上限
   */
  recover(amount: number, _totalLockedQi: number = 0): void {
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
   * 计算公式: Math.ceil(BASE_BUY_COST * (1 + BUY_COST_FACTOR * cardScore)) [+ LQC (杠杆)]
   * 
   * @param cardScore 该卡牌在当前季节的评分
   * @param useLeverage 是否加杠杆
   * @returns 消耗的气量值
   */
  calculateBuyCost(cardScore: number, useLeverage: boolean = false): number {
    let cost = this.cfg.baseBuyCost * (1 + this.cfg.buyCostFactor * cardScore);
    if (useLeverage) {
      cost += this.cfg.lqc; // 杠杆额外消耗 LQC
    }
    return Math.ceil(cost);
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
   * @returns 卖出气耗 (当前设定为 4)
   */
  getSellCost(): number {
    return this.cfg.sellCost;
  }

  /**
   * 获取每回合的基础自然回复气量
   * @returns 基础回复气量 (默认为 10)
   */
  getBaseRecovery(): number {
    return this.cfg.baseRecovery;
  }

  /**
   * 获取执行“等待”操作后下回合能获得的额外回复气量
   * @returns 等待额外回复气量 (默认为 10)
   */
  getWaitBonus(): number {
    return this.cfg.waitBonus;
  }

  /**
   * 获取杠杆额外买入消耗气值
   * @returns 杠杆额外消耗
   */
  getLQC(): number {
    return this.cfg.lqc;
  }

  /**
   * 获取买入手续费
   */
  getBuyEntryFee(): number {
    return this.cfg.buyEntryFee;
  }

  /**
   * 获取强平占用气退还系数
   */
  getForcedLiquidationQiReturnFactor(): number {
    return this.cfg.forcedLiquidationQiReturnFactor;
  }

  /**
   * 重置气资源管理器至初始状态
   */
  reset(): void {
    this.qi = this.cfg.initialQi;
  }
}
