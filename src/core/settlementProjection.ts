import type { TurnManager } from './TurnManager';
import type { HandSlot } from './HandSlot';
import { Element, type JiaziCard } from './JiaziCard';
import type { SettlementPreviewAction } from './TurnManager';

export interface ProjectedHolding {
  name: string;
  earning: number;
  qiCost: number;
  isLeverage: boolean;
  isNewBuy: boolean;
  /** 该牌在投影手牌中的浓度信息（仅 V7 生效且同元素 ≥2 张时存在），UI 展示浓度来源用。 */
  concentration?: { count: number; premium: number };
}

/**
 * 预测层「持仓明细」的预期手牌投影（假设不换季口径）。
 *
 * 与 previewSettlement 的 virtualHand 同口径：纳灵预览并入将入手的牌、
 * 释灵预览剔除将卖出的牌——使蓝框完整呈现"预期持有结构"（含新买入牌的每回合炼化属性）。
 *
 * 杠杆用 getNextLeverageNoSeasonChange（恒定 roundInSeason+1，不查季末），
 * 不泄露换季。这是"买入后炼化"歧义行的替代方案：信息不丢、且不再与"本次行动"卡混淆。
 */
export function buildProjectedHoldings(
  tm: TurnManager,
  hand: (HandSlot | null)[] | null,
  action: SettlementPreviewAction,
  publicCards: JiaziCard[],
  actionUsesLeverage: boolean,
): ProjectedHolding[] {
  const nextLev = tm.getNextLeverageNoSeasonChange();
  type Slot = { card: JiaziCard; useLeverage: boolean; isNewBuy: boolean };
  const slots: Slot[] = [];

  if (hand) {
    hand.forEach((slot, idx) => {
      if (!slot) return;
      // 释灵预览：剔除将卖出的牌
      if (action.type === 'sell' && 'slotIndex' in action && action.slotIndex === idx) {
        return;
      }
      slots.push({ card: slot.card, useLeverage: slot.useLeverage, isNewBuy: false });
    });
  }

  // 纳灵预览：并入将入手的牌（预览时它尚未进入 handManager）
  if (action.type === 'buy' && 'cardIndex' in action) {
    const card = publicCards[action.cardIndex];
    if (card) slots.push({ card, useLeverage: actionUsesLeverage, isNewBuy: true });
  }

  const factor = tm.getConcentrationPremiumFactor();
  // 浓度基于投影后的虚拟手牌计数（纳灵并入新牌/释灵剔除卖出牌后），与 previewSettlement 的
  // virtualConcentration 同口径——否则买/卖预览的浓度会与真实结算不一致。
  const countOf = (card: JiaziCard) => slots.filter((s) => s.card.mainElement === card.mainElement).length;

  return slots.map((slot) => {
    const score = tm.getCardScore(slot.card, tm.getCurrentSeason());
    const lev = slot.useLeverage ? nextLev : 1;
    const earning = tm.previewHoldEarning(score, lev);
    const count = countOf(slot.card);
    const premium = factor * Math.max(0, count - 1);
    const qiCost = tm.previewHoldQiCost(score, lev, slot.card.tianGanElement === Element.EARTH, count, factor);
    return {
      name: slot.card.name,
      earning,
      qiCost,
      isLeverage: slot.useLeverage,
      isNewBuy: slot.isNewBuy,
      concentration: factor > 0 && count >= 2 ? { count, premium } : undefined,
    };
  });
}
