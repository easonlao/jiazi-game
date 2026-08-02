import type { SettlementDetail } from '@core/index';

/** FX 事件类型：id 递增，组件监听 id 变化触发动画 */
export interface FxSeasonEvent {
  id: number;
  season: string;
  prevSeason: string;
}
export interface FxMarginCallEvent {
  id: number;
  detail: SettlementDetail;
}
export interface FxDeltaEvent {
  id: number;
  delta: number;
}
export interface FxRoundEvent {
  id: number;
  round: number;
  season: string;
}

/** FX 事件 diff 前后对比所需的旧值快照 */
export interface FxDiffPrev {
  season: string;
  round: number;
  qi: number;
  score: number;
  marginCallCount: number;
}

/** FX 事件 diff 后的新值 */
export interface FxDiffNext {
  season: string;
  round: number;
  qi: number;
  score: number;
  marginCallCount: number;
  settlement: SettlementDetail | null;
}

/** FX 事件 diff 产出的 patch（空对象表示无变化） */
export interface FxPatch {
  seasonEvent?: FxSeasonEvent;
  marginCallEvent?: FxMarginCallEvent;
  scoreDelta?: FxDeltaEvent;
  qiDelta?: FxDeltaEvent;
  roundEvent?: FxRoundEvent;
}

/**
 * 全局自增序列，由 diffFxEvents 维护。
 * 组件只需监听对应字段的 id 变化即可触发动画，天然支持重复触发。
 */
let fxSeq = 0;

/** 重置 FX 序列（仅测试用） */
export function _resetFxSeq(): void {
  fxSeq = 0;
}

/**
 * 对比新旧值产出 FX 事件 patch。
 * 值真正变化才产生新事件（id 递增），避免无变化时误触动画。
 */
export function diffFxEvents(prev: FxDiffPrev, next: FxDiffNext): FxPatch {
  const patch: FxPatch = {};

  // 回合推进（第 1 回合开局不播过渡动画）
  if (next.round !== prev.round && next.round > 1) {
    patch.roundEvent = { id: ++fxSeq, round: next.round, season: next.season };
  }

  // 季节切换
  if (next.season !== prev.season) {
    patch.seasonEvent = { id: ++fxSeq, season: next.season, prevSeason: prev.season };
  }

  // 爆仓强平（计数增加且结算详情确认触发）
  if (next.marginCallCount > prev.marginCallCount && next.settlement?.marginCallTriggered) {
    patch.marginCallEvent = { id: ++fxSeq, detail: next.settlement };
  }

  // 每次进入新回合都记录本回合分数增量；即使为 0，也清除上一回合的旧提示。
  if (next.round !== prev.round || next.score !== prev.score) {
    patch.scoreDelta = { id: ++fxSeq, delta: next.score - prev.score };
  }

  // 气量变化
  if (next.qi !== prev.qi) {
    patch.qiDelta = { id: ++fxSeq, delta: next.qi - prev.qi };
  }

  return patch;
}
