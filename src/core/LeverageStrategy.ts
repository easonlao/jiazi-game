/**
 * 玩家加杠杆策略（2026-08-08 用户明确规则）
 *
 * 规则：
 *  1. 当买入的牌为「高分牌」时必定启用杠杆；
 *  2. 通常手里只保持 1 张杠杆牌；
 *  3. 少数情况下（神识极充足且非季末）允许增加到 2 张；最多 2 张。
 *
 * 纯函数决策逻辑，不耦合引擎，便于单元测试与模拟脚本复用。
 * 「高分牌」分界沿用代码既有强牌约定（strong_card_leverage / expert-lock 均用 cur>=20），
 * 集中为常量便于校准——确切分界以玩家确认为准。
 */
import type { HandSlot } from './HandSlot.ts';

/** 高分牌阈值：当前季评分 ≥ 此值视为高分牌（沿用 strong_card_leverage 的强牌约定） */
export const HIGH_SCORE_THRESHOLD = 20;
/** 杠杆槽位上限：玩家同时持有的杠杆牌最多 2 张 */
export const MAX_LEVERAGE_SLOTS = 2;
/** 少数情况开第 2 张杠杆的最低神识门槛：神识极充足才敢加第 2 张（避免双杠杆神识崩盘） */
export const SECOND_LEVERAGE_MIN_QI = 55;
/** 季末（下回合换季）风险高，少数情况也不开第 2 张杠杆 */
export const SECOND_LEVERAGE_AVOID_SEASON_END = true;

export interface LeverageDecisionContext {
  /** 候选买入牌的当前季评分 */
  candidateScore: number;
  /** 当前手牌中已启用杠杆的槽位数 */
  currentLeverageSlots: number;
  /** 当前神识值 */
  qi: number;
  /** 神识上限 */
  maxQi: number;
  /** 是否季末（下回合将换季）：季末加杠杆会放大换季亏损 */
  isSeasonEnd: boolean;
}

/** 判定某评分的牌是否为高分牌 */
export function isHighScoreCard(score: number, threshold: number = HIGH_SCORE_THRESHOLD): boolean {
  return score >= threshold;
}

/** 统计手牌中已启用杠杆的槽位数 */
export function countLeverageSlots(hand: readonly (HandSlot | null)[]): number {
  let n = 0;
  for (const slot of hand) if (slot && slot.useLeverage) n++;
  return n;
}

/**
 * 玩家加杠杆决策：返回买入该候选牌时是否启用杠杆。
 *
 * 逻辑：
 *  - 非高分牌 → 不加；
 *  - 已到上限（2 张）→ 不加；
 *  - 当前 0 张 → 加（常态第一张）；
 *  - 当前 1 张 → 仅少数情况（神识足且非季末）开第二张。
 */
export function shouldUseLeverage(ctx: LeverageDecisionContext): boolean {
  if (!isHighScoreCard(ctx.candidateScore)) return false;
  if (ctx.currentLeverageSlots >= MAX_LEVERAGE_SLOTS) return false;
  if (ctx.currentLeverageSlots === 0) return true;
  // 已 1 张，少数情况开第 2 张
  if (SECOND_LEVERAGE_AVOID_SEASON_END && ctx.isSeasonEnd) return false;
  return ctx.qi >= SECOND_LEVERAGE_MIN_QI;
}
