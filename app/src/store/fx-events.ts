import type { SettlementDetail, Element, VoidStep } from '@core/index';

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

/**
 * V5 空亡触发事件（批 2 动画信号，票 09 预留）：每张空亡牌触发分配一个 id 递增事件。
 * 组件监听 id 变化即可驱动「时间吞噬」动画，天然支持同回合多张连续触发。
 *
 * ⚠️ 单槽契约（P2-2 定稿）：store 的 voidTriggerEvent 是单值槽，同一同步吞噬回合内
 * 多张空亡牌连续触发时，后者覆盖前者，最终只保留**最后一张牌**的事件——动画按最后一张
 * 的 K 播放；同回合总吞噬量（次数 / 季节步数）由合并 Toast（「连续吞噬 N 次」）补足。
 * 消费方（VoidTriggerAnimation）不得假设能拿到同 tick 的全部触发。
 */
export interface FxVoidTriggerEvent {
  id: number;
  /** 本次吞噬的季节步数 K */
  k: number;
  /** 吞噬前的季节 */
  prevSeason: string;
  /** 吞噬后的季节 */
  nextSeason: string;
  /**
   * K 步推进的完整轨迹（长度 = k；每步 { season, roundInSeason }，终点 = nextSeason 当前季内回合）。
   * 批 2 动画据此做「剩余 K 逐回合倒数 + 当前位置逐回合递增」——引擎逐步 advance 采集，
   * 不消耗额外随机数、不改变引擎推进的最终状态。
   */
  path: VoidStep[];
}

/**
 * 跨回合买入结算事件（issue：cross-round buy settlement animation）。
 * 玩家确认纳灵后游戏立即进入下一回合，此时公共牌已被移除、手牌已就位；
 * 本事件在「执行买入前」由 store 快照卡牌身份与公共牌源几何，
 * 供 BuySettlementAnimation 在新回合把购入牌从原公共位飞入丹田槽位，
 * 再展示本次实际纳灵耗神（−N 神识），之后才轮到炼化/回神结算序列。
 */
export interface FxBuySettlementEvent {
  id: number;
  /** 被买入卡牌身份（供飞行卡牌渲染） */
  cardId: number;
  cardName: string;
  tianGan: string;
  diZhi: string;
  tianGanElement: Element;
  diZhiElement: Element;
  mainElement: Element;
  /** 实际纳灵耗神（正值；展示为 −N 神识）。与下回合持仓炼化/炼耗互不合并。 */
  buyCost: number;
  /** 燃灵（杠杆买入） */
  useLeverage: boolean;
  /** 买入前该公共牌处于锁定状态 */
  wasLocked: boolean;
  /** 行动前公共牌中心 view 坐标（无 DOM 环境为 0） */
  sourceX: number;
  sourceY: number;
  /** 买入后所在的丹田槽位索引 */
  slotIndex: number;
  /** 目标回合（买入推进后的当前回合；用于判定是否本轮买入） */
  round: number;
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
 * 跨回合买入事件自增序列（由 store 的 confirmSettlementPreview 分配）。
 * 买入事件不是 diff 产物，独立于 fxSeq；组件按 id 去重，天然支持重复触发。
 */
let buyFxSeq = 0;

/** 重置买入事件序列（仅测试用） */
export function _resetBuyFxSeq(): void {
  buyFxSeq = 0;
}

/** 分配下一个跨回合买入结算事件 id */
export function nextBuyFxId(): number {
  return ++buyFxSeq;
}

/**
 * V5 空亡触发事件自增序列（由 store 的 bindTurnManagerCallbacks 分配）。
 * 空亡触发不是 diff 产物，独立于 fxSeq；组件按 id 去重，天然支持重复触发。
 */
let voidTriggerSeq = 0;

/** 重置空亡触发序列（仅测试用） */
export function _resetVoidTriggerSeq(): void {
  voidTriggerSeq = 0;
}

/** 分配下一个空亡触发事件 id */
export function nextVoidTriggerId(): number {
  return ++voidTriggerSeq;
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
