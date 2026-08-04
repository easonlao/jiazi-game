/**
 * 强平引擎：处理玩家爆仓时对杠杆仓位的强制平仓。
 *
 * 领域术语「强平」是系统强制（气量归零触发），与玩家主动「卖出」是两个概念（见 CONTEXT.md）。
 *
 * 强平会循环随机平仓杠杆牌，正常结算卖出积分，但强平不消耗气，亦不提供卖出即时回气。
 * 爆仓扣分公式：杠杆倍数 × |爆仓时卡牌评分| × balanceConfig.marginCallPenaltyPerScore
 * 设计意图：惩罚与杠杆倍数和卡牌价值正相关——高杠杆 + 极端分数 = 剧痛。
 */

import type { BalanceConfig } from './BalanceConfig';
import type { HandManager } from './HandManager';
import type { JiaziCard } from './JiaziCard';
import type { CardPoolManager } from './CardPoolManager';
import type { QiManager } from './QiManager';
import type { ScoreManager } from './ScoreManager';
import type { LeverageCalculator } from './LeverageCalculator';
import type { SeasonCycle } from './SeasonCycle';
import type { RandomSource } from './RandomSource';
import type { MarginCallDetail } from './TurnManager';

export interface MarginCallEngineDeps {
  qiManager: QiManager;
  handManager: HandManager;
  cardPoolManager: CardPoolManager;
  scoreManager: ScoreManager;
  leverageCalculator: LeverageCalculator;
  seasonCycle: SeasonCycle;
  random: RandomSource;
  balanceConfig: BalanceConfig;
  /** 外部注入的季节评分入口（TurnManager.getCardScore） */
  getCardScore: (card: JiaziCard, season: string) => number;
  /** 手牌总锁定气（强平返还时按剩余总锁定气封顶） */
  getTotalLockedQi: () => number;
  /** 每次成功强平触发一次（TurnManager 用于统计 marginCallCount） */
  onMarginCall: () => void;
}

export class MarginCallEngine {
  private readonly deps: MarginCallEngineDeps;

  constructor(deps: MarginCallEngineDeps) {
    this.deps = deps;
  }

  /**
   * 执行强平循环：气量 ≤ 0 时不断随机平仓杠杆牌，直到气回正或无杠杆牌可平。
   * @returns 本次强平的明细（供 UI 展示）
   */
  execute(): MarginCallDetail[] {
    const {
      qiManager,
      handManager,
      cardPoolManager,
      scoreManager,
      leverageCalculator,
      seasonCycle,
      random,
      balanceConfig,
    } = this.deps;

    console.log('[MarginCallEngine] 爆仓！气耗尽');
    const details: MarginCallDetail[] = [];

    while (qiManager.getQi() <= 0) {
      const hand = handManager.getHand();
      const leverageIndices: number[] = [];

      // 收集所有手牌中带有杠杆的插槽索引
      for (let i = 0; i < hand.length; i++) {
        if (hand[i] && hand[i]!.useLeverage) {
          leverageIndices.push(i);
        }
      }

      // 若已无杠杆牌，强平终止（仅剩的普通无杠杆牌允许气为 0 持有，下回合被迫等待）
      if (leverageIndices.length === 0) {
        break;
      }

      // 随机选择一张杠杆牌进行强平（使用注入随机源，保证固定 seed 可复现）
      const targetIndex = leverageIndices[random.int(0, leverageIndices.length)];
      const slot = hand[targetIndex]!;

      // 强平移除卡牌 (直接 sell，不扣卖出气耗，亦不提供卖出即时回气)，并将卡牌回洗入牌堆
      const liquidatedSlot = handManager.sell(targetIndex);
      if (liquidatedSlot) {
        cardPoolManager.returnCards([liquidatedSlot.card]);
      }
      const newTotalLocked = this.deps.getTotalLockedQi();
      this.deps.onMarginCall();

      // 爆仓时取当前实际杠杆倍数（动态）
      const effectiveLeverage =
        slot.useLeverage
          ? leverageCalculator.getMultiplier(seasonCycle.getCurrentRoundInSeason())
          : 1;

      // 正常获得卖出分数（强平惩罚：正收益打 8 折，负收益 100% 承担）
      const currentScore = this.deps.getCardScore(slot.card, seasonCycle.getCurrentSeason());
      const baseSellScore = scoreManager.calculateSellScore(
        currentScore,
        slot.buyScore,
        effectiveLeverage
      );
      const multiplier = qiManager.getForcedLiquidationScoreMultiplier();
      const finalSellScore = baseSellScore > 0 ? Math.floor(baseSellScore * multiplier) : baseSellScore;
      scoreManager.addSellEarnings(finalSellScore);

      // 爆仓扣分：当前杠杆 × |爆仓时卡牌评分| × 系数（来自 BalanceConfig）
      const marginCallPenalty = Math.round(
        effectiveLeverage * Math.abs(currentScore) * balanceConfig.marginCallPenaltyPerScore
      );
      scoreManager.applyMarginCallPenalty(marginCallPenalty);

      // 强平返还部分占用气
      const forcedLiquidationQiReturn = Math.floor(slot.lockedQi * qiManager.getForcedLiquidationQiReturnFactor());
      qiManager.recover(forcedLiquidationQiReturn, newTotalLocked);

      // 记录强平细节（扣分系数来自配置，避免调参后展示与实扣不一致）
      const penaltyCoeff = balanceConfig.marginCallPenaltyPerScore;
      details.push({
        cardName: slot.card.name,
        sellScore: finalSellScore,
        reason: `气量归零强制平仓，杠杆 ${effectiveLeverage}x，卡牌评分 ${currentScore}，扣分 ${marginCallPenalty}（杠杆 × |评分| × ${penaltyCoeff}）`
      });

      console.log(`[MarginCallEngine] 爆仓强平：移除卡牌 ${slot.card.name}，结算收益 ${finalSellScore} 分，扣分 ${marginCallPenalty}（${effectiveLeverage} × |${currentScore}| × ${penaltyCoeff}），退回占用气 ${forcedLiquidationQiReturn}`);

      // 强平成功后退出，不再提供低保缓冲——玩家必须自行管理气量，感受到爆仓的持续压力
      break;
    }

    return details;
  }
}
