/**
 * 强平引擎：处理玩家爆仓时对杠杆仓位的强制平仓。
 *
 * 领域术语「强平」是系统强制（气量归零触发），与玩家主动「卖出」是两个概念（见 CONTEXT.md）。
 *
 * 强平会选中「当前评分最高」的杠杆牌（正分最大者，价值最高的牌），
 * 被反噬的牌**不产生卖出收益**（无卖出结算），直接承受反噬罚分。
 * 爆仓扣分公式：杠杆倍数 × |爆仓时卡牌评分| × balanceConfig.marginCallPenaltyPerScore
 * 设计意图：惩罚与杠杆倍数和卡牌价值正相关——高杠杆 + 极端分数 = 剧痛；
 * 且反噬是"灵气失控"而非"主动卖出"，所以无收益、只有惩罚。
 * 2026-08-05 用户设计确认：选牌随机 → 评分最高；强平不卖出（直接无收益 + 反噬罚分）。
 */

import type { BalanceConfig } from './BalanceConfig.ts';
import type { HandManager } from './HandManager.ts';
import type { JiaziCard } from './JiaziCard.ts';
import type { CardPoolManager } from './CardPoolManager.ts';
import type { QiManager } from './QiManager.ts';
import type { ScoreManager } from './ScoreManager.ts';
import type { LeverageCalculator } from './LeverageCalculator.ts';
import type { SeasonCycle } from './SeasonCycle.ts';
import type { MarginCallDetail } from './TurnManager.ts';

export interface MarginCallEngineDeps {
  qiManager: QiManager;
  handManager: HandManager;
  cardPoolManager: CardPoolManager;
  scoreManager: ScoreManager;
  leverageCalculator: LeverageCalculator;
  seasonCycle: SeasonCycle;
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
   * 执行强平循环：气量 ≤ 0 时不断平仓「评分最高」的杠杆牌，直到气回正或无杠杆牌可平。
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
      balanceConfig,
    } = this.deps;

    console.log('[MarginCallEngine] 爆仓！神识耗尽');
    const details: MarginCallDetail[] = [];

    while (qiManager.getQi() <= 0) {
      const hand = handManager.getHand();
      const currentSeason = seasonCycle.getCurrentSeason();

      // 收集所有手牌中带有杠杆的插槽（含其当前评分，用于选"价值最高"）
      interface LeverageSlot { index: number; score: number; }
      const leverageSlots: LeverageSlot[] = [];
      for (let i = 0; i < hand.length; i++) {
        if (hand[i] && hand[i]!.useLeverage) {
          leverageSlots.push({
            index: i,
            score: this.deps.getCardScore(hand[i]!.card, currentSeason),
          });
        }
      }

      // 若已无杠杆牌，强平终止（仅剩的普通无杠杆牌允许神识为 0 持有，下回合被迫等待）
      if (leverageSlots.length === 0) {
        break;
      }

      // 选中「当前评分最高」的杠杆牌（正分最大 = 价值最高的牌；并列取第一个）
      const target = leverageSlots.reduce((max, slot) => (slot.score > max.score ? slot : max), leverageSlots[0]);
      const targetIndex = target.index;
      const slot = hand[targetIndex]!;

      // 强平移除卡牌（不产生卖出收益，也不扣卖出气耗、不提供卖出即时回气），并将卡牌回洗入牌堆
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

      // 被反噬的牌无卖出收益（2026-08-05 用户确认：不卖出结算，直接无收益）

      // 爆仓扣分：当前杠杆 × |爆仓时卡牌评分| × 系数（来自 BalanceConfig）
      const currentScore = this.deps.getCardScore(slot.card, currentSeason);
      const marginCallPenalty = Math.round(
        effectiveLeverage * Math.abs(currentScore) * balanceConfig.marginCallPenaltyPerScore
      );
      scoreManager.applyMarginCallPenalty(marginCallPenalty);

      // 强平返还部分占用气
      const forcedLiquidationQiReturn = Math.floor(slot.lockedQi * qiManager.getForcedLiquidationQiReturnFactor());
      qiManager.recover(forcedLiquidationQiReturn, newTotalLocked);

      // 记录强平细节（结构化字段供 UI 大字展示，reason 保留为兜底；扣分系数来自配置，避免调参后展示与实扣不一致）
      const penaltyCoeff = balanceConfig.marginCallPenaltyPerScore;
      details.push({
        cardName: slot.card.name,
        slotIndex: targetIndex,
        penaltyScore: marginCallPenalty,
        leverage: effectiveLeverage,
        cardScore: currentScore,
        reason: `气量归零强制平仓，杠杆 ${effectiveLeverage}x，卡牌评分 ${currentScore}，扣分 ${marginCallPenalty}（杠杆 × |评分| × ${penaltyCoeff}）`
      });

      console.log(`[MarginCallEngine] 爆仓强平：移除卡牌 ${slot.card.name}（评分最高 ${currentScore}），无卖出收益，扣分 ${marginCallPenalty}（${effectiveLeverage} × |${currentScore}| × ${penaltyCoeff}），退回锁定气 ${forcedLiquidationQiReturn}`);

      // 强平成功后退出，不再提供低保缓冲——玩家必须自行管理气量，感受到爆仓的持续压力
      break;
    }

    return details;
  }
}
