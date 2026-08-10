/**
 * 遥测事件类型与载荷白名单定义（平台无关）。
 *
 * 设计约束（PRD §4）：
 * - 只允许收集白名单内的结构化字段，禁止整包快照（GameSnapshot / roundLog blob）；
 * - 事件载荷使用 version 版本化，便于未来演进与下游解析；
 * - 载荷不得包含恢复码、Supabase auth token 等机密（身份链接只通过
 *   player_id / session_id 等稳定键在服务端完成）。
 */

/** 事件载荷版本（payload 结构演进时递增） */
export const TELEMETRY_PAYLOAD_VERSION = 1;
/** 同意书版本（策略变更需重新征得同意） */
export const TELEMETRY_CONSENT_VERSION = 1;
/** 本地队列最大容量（防止离线长期积压无界增长；超限丢弃最旧事件） */
export const TELEMETRY_MAX_QUEUE = 500;

export type TelemetryEventType =
  | 'session_start'
  | 'session_end'
  | 'session_abandon'
  | 'action_buy'
  | 'action_sell'
  | 'action_wait'
  | 'action_lock'
  | 'action_unlock'
  | 'round_settled';

/** 当前允许采集的事件类型集合（白名单） */
export const TELEMETRY_EVENT_TYPES: readonly TelemetryEventType[] = [
  'session_start',
  'session_end',
  'session_abandon',
  'action_buy',
  'action_sell',
  'action_wait',
  'action_lock',
  'action_unlock',
  'round_settled',
];

/** 会话开始：游戏开局时上报一次 */
export interface SessionStartPayload {
  session_id: string;
  /** 规则版本（RULES_BASE / RULES_VERSION_VOLATILE / RULES_VERSION_TRADE 的数值） */
  rules_version: string;
  /** 游戏模式标识：base / volatility_trade */
  game_mode: string;
  /** 是否启用实验性波动规则（v2/v3） */
  volatility_enabled: boolean;
  app_version: string;
  consent_version: number;
  platform: string;
}

export interface SessionEndPayload {
  session_id: string;
  final_score: number;
  rounds: number;
  abandoned: boolean;
  margin_call_count: number;
  /** 结束原因：pagehide（页面离开/关闭）/ reset（放弃并重开） */
  reason: 'game_over' | 'pagehide' | 'reset';
}

/** 行动时可见的公共牌上下文（已抽牌后的候选牌，最多 3 张） */
export interface ContextCard {
  id: number;
  name: string;
  score: number;
}

/** 行动时可见的手牌上下文（最多 3 张） */
export interface HandContextCard extends ContextCard {
  use_leverage: boolean;
}

/** 行动事件的公共字段（每个行动事件都携带的气/分/情境上下文） */
export interface BaseActionPayload {
  session_id: string;
  round: number;
  season: string;
  qi_before: number;
  qi_after: number;
  score_before: number;
  score_after: number;
  leverage_multiplier: number;
  /** 行动时可见公共牌上下文 */
  public_context: ContextCard[];
  /** 行动时可见手牌上下文 */
  hand_context: HandContextCard[];
}

export interface ActionBuyPayload extends BaseActionPayload {
  card_id: number;
  card_name: string;
  card_main_element: string;
  card_yin_yang: string;
  /** 行动时当前评分数值 */
  card_score: number;
  /** 无波动偏移的基础评分 */
  base_score: number;
  /** 当前评分 - 基础评分（波动规则下非空；base 规则下为 null） */
  volatility_delta: number | null;
  buy_cost: number;
  use_leverage: boolean;
}

export interface ActionSellPayload extends BaseActionPayload {
  slot_index: number;
  card_id: number;
  card_name: string;
  /** 卖出时评分数值 */
  card_score: number;
  /** 买入时评分（价差基准） */
  buy_score: number;
  /** 卖出收益（(卖出-买入)×4×杠杆） */
  sell_score: number;
  use_leverage: boolean;
  /** 归还锁气量 */
  qi_return: number;
}

export interface ActionWaitPayload extends BaseActionPayload {
  /** 末回合等待直接结束游戏 */
  ends_game: boolean;
}

export interface ActionLockPayload extends BaseActionPayload {
  card_id: number;
  card_name: string;
}

export interface ActionUnlockPayload extends BaseActionPayload {
  card_id: number;
  card_name: string;
}

/** 每回合结算完成后的汇总（回合事实，不含任何预测字段） */
export interface RoundSettledPayload {
  session_id: string;
  round: number;
  season: string;
  hold_earnings: number;
  hold_qi_cost: number;
  base_qi_recover: number;
  wait_qi_recover: number;
  margin_call_triggered: boolean;
  margin_call_count: number;
  qi_after: number;
  score_after: number;
}

/** 事件载荷联合类型（用于构造与校验） */
export type TelemetryPayload =
  | SessionStartPayload
  | SessionEndPayload
  | ActionBuyPayload
  | ActionSellPayload
  | ActionWaitPayload
  | ActionLockPayload
  | ActionUnlockPayload
  | RoundSettledPayload;

/** 事件类型 → 载荷类型映射 */
export interface TelemetryEventTypeMap {
  session_start: SessionStartPayload;
  session_end: SessionEndPayload;
  session_abandon: SessionEndPayload;
  action_buy: ActionBuyPayload;
  action_sell: ActionSellPayload;
  action_wait: ActionWaitPayload;
  action_lock: ActionLockPayload;
  action_unlock: ActionUnlockPayload;
  round_settled: RoundSettledPayload;
}

/**
 * 队列中的完整事件（envelope）。
 * id 为客户端生成的幂等事件 ID（uuid），服务端按 client_event_id 去重。
 */
export interface TelemetryEvent {
  id: string;
  ts: string;
  /** 持久化的本地单调序号；用于跨批次重建玩家行动顺序。 */
  sequence: number;
  type: TelemetryEventType;
  version: number;
  payload: Record<string, unknown>;
}

export interface TrackedEventInput {
  type: TelemetryEventType;
  payload: Record<string, unknown>;
}

/** 生成幂等事件 ID / 会话 ID 的 uuid（v4） */
export function newUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  // 旧环境回退：用 getRandomValues 手工拼 v4 uuid
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 构造一个带 envelope 的待发送事件 */
export function makeEvent(
  input: TrackedEventInput,
  now: () => string = () => new Date().toISOString(),
  sequence = 0,
): TelemetryEvent {
  return {
    id: newUuid(),
    ts: now(),
    sequence,
    type: input.type,
    version: TELEMETRY_PAYLOAD_VERSION,
    payload: input.payload,
  };
}
