/**
 * 遥测事件载荷白名单校验（平台无关）。
 *
 * 只放行白名单内的字段并做类型校验；未知字段一律剔除（allowlist 而非 denylist），
 * 保证下游收到的永远是结构化、有界、可安全落库的载荷。
 */

import {
  TELEMETRY_EVENT_TYPES,
  makeEvent,
  type TelemetryEvent,
  type TelemetryEventType,
} from './types';

type Validator = (raw: unknown) => Record<string, unknown> | null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isNullableNumber(v: unknown): v is number | null {
  return v === null || isNumber(v);
}

/** 可读短字符串（卡名/季节/模式等），长度受限防滥用 */
function isShortString(v: unknown): v is string {
  return isString(v) && v.length <= 64;
}

function contextCard(raw: unknown, withLeverage: boolean): { id: number; name: string; score: number } | null {
  if (!isRecord(raw)) return null;
  if (!isNumber(raw.id) || !isShortString(raw.name) || !isNumber(raw.score)) return null;
  if (withLeverage && !isBoolean(raw.use_leverage)) return null;
  return {
    id: raw.id,
    name: raw.name,
    score: raw.score,
    ...(withLeverage ? { use_leverage: raw.use_leverage } : {}),
  };
}

function contextCards(raw: unknown, withLeverage: boolean): { id: number; name: string; score: number }[] | null {
  if (!Array.isArray(raw)) return null;
  const out: { id: number; name: string; score: number }[] = [];
  for (const item of raw) {
    const c = contextCard(item, withLeverage);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

function validateBaseAction(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  if (!isString(raw.session_id)) return null;
  if (!isNumber(raw.round) || raw.round < 1 || !Number.isInteger(raw.round)) return null;
  if (!isShortString(raw.season)) return null;
  if (!isNumber(raw.qi_before)) return null;
  if (!isNumber(raw.qi_after)) return null;
  if (!isNumber(raw.score_before)) return null;
  if (!isNumber(raw.score_after)) return null;
  if (!isNumber(raw.leverage_multiplier)) return null;
  const publicContext = contextCards(raw.public_context, false);
  const handContext = contextCards(raw.hand_context, true);
  if (!publicContext || !handContext) return null;
  return {
    session_id: raw.session_id,
    round: raw.round,
    season: raw.season,
    qi_before: raw.qi_before,
    qi_after: raw.qi_after,
    score_before: raw.score_before,
    score_after: raw.score_after,
    leverage_multiplier: raw.leverage_multiplier,
    public_context: publicContext,
    hand_context: handContext,
  };
}

const validators: Record<TelemetryEventType, Validator> = {
  session_start: (raw) => {
    if (!isRecord(raw)) return null;
    if (!isString(raw.session_id)) return null;
    if (!isShortString(raw.rules_version)) return null;
    if (!isShortString(raw.game_mode)) return null;
    if (!isBoolean(raw.volatility_enabled)) return null;
    if (!isShortString(raw.app_version)) return null;
    if (!isNumber(raw.consent_version) || !Number.isInteger(raw.consent_version)) return null;
    if (!isShortString(raw.platform)) return null;
    return {
      session_id: raw.session_id,
      rules_version: raw.rules_version,
      game_mode: raw.game_mode,
      volatility_enabled: raw.volatility_enabled,
      app_version: raw.app_version,
      consent_version: raw.consent_version,
      platform: raw.platform,
    };
  },
  session_end: (raw) => {
    if (!isRecord(raw)) return null;
    if (!isString(raw.session_id)) return null;
    if (!isNumber(raw.final_score)) return null;
    if (!isNumber(raw.rounds) || !Number.isInteger(raw.rounds)) return null;
    if (!isBoolean(raw.abandoned)) return null;
    if (!isNumber(raw.margin_call_count) || !Number.isInteger(raw.margin_call_count)) return null;
    if (!isShortString(raw.reason)) return null;
    return {
      session_id: raw.session_id,
      final_score: raw.final_score,
      rounds: raw.rounds,
      abandoned: raw.abandoned,
      margin_call_count: raw.margin_call_count,
      reason: raw.reason,
    };
  },
  session_abandon: (raw) => {
    // 与 session_end 载荷同构（abandoned=true 由调用方保证）
    return validators.session_end(raw);
  },
  action_buy: (raw) => {
    const base = validateBaseAction(raw);
    if (!base) return null;
    if (!isRecord(raw)) return null;
    if (!isNumber(raw.card_id)) return null;
    if (!isShortString(raw.card_name)) return null;
    if (!isShortString(raw.card_main_element)) return null;
    if (!isShortString(raw.card_yin_yang)) return null;
    if (!isNumber(raw.card_score)) return null;
    if (!isNumber(raw.base_score)) return null;
    if (!isNullableNumber(raw.volatility_delta)) return null;
    if (!isNumber(raw.buy_cost)) return null;
    if (!isBoolean(raw.use_leverage)) return null;
    return {
      ...base,
      card_id: raw.card_id,
      card_name: raw.card_name,
      card_main_element: raw.card_main_element,
      card_yin_yang: raw.card_yin_yang,
      card_score: raw.card_score,
      base_score: raw.base_score,
      volatility_delta: raw.volatility_delta,
      buy_cost: raw.buy_cost,
      use_leverage: raw.use_leverage,
    };
  },
  action_sell: (raw) => {
    const base = validateBaseAction(raw);
    if (!base) return null;
    if (!isRecord(raw)) return null;
    if (!isNumber(raw.slot_index)) return null;
    if (!isNumber(raw.card_id)) return null;
    if (!isShortString(raw.card_name)) return null;
    if (!isNumber(raw.card_score)) return null;
    if (!isNumber(raw.buy_score)) return null;
    if (!isNumber(raw.sell_score)) return null;
    if (!isBoolean(raw.use_leverage)) return null;
    if (!isNumber(raw.qi_return)) return null;
    return {
      ...base,
      slot_index: raw.slot_index,
      card_id: raw.card_id,
      card_name: raw.card_name,
      card_score: raw.card_score,
      buy_score: raw.buy_score,
      sell_score: raw.sell_score,
      use_leverage: raw.use_leverage,
      qi_return: raw.qi_return,
    };
  },
  action_wait: (raw) => {
    const base = validateBaseAction(raw);
    if (!base) return null;
    if (!isRecord(raw)) return null;
    if (!isBoolean(raw.ends_game)) return null;
    return { ...base, ends_game: raw.ends_game };
  },
  action_lock: (raw) => {
    const base = validateBaseAction(raw);
    if (!base) return null;
    if (!isRecord(raw)) return null;
    if (!isNumber(raw.card_id)) return null;
    if (!isShortString(raw.card_name)) return null;
    return { ...base, card_id: raw.card_id, card_name: raw.card_name };
  },
  action_unlock: (raw) => {
    const base = validateBaseAction(raw);
    if (!base) return null;
    if (!isRecord(raw)) return null;
    if (!isNumber(raw.card_id)) return null;
    if (!isShortString(raw.card_name)) return null;
    return { ...base, card_id: raw.card_id, card_name: raw.card_name };
  },
  round_settled: (raw) => {
    if (!isRecord(raw)) return null;
    if (!isString(raw.session_id)) return null;
    if (!isNumber(raw.round) || raw.round < 1 || !Number.isInteger(raw.round)) return null;
    if (!isShortString(raw.season)) return null;
    if (!isNumber(raw.hold_earnings)) return null;
    if (!isNumber(raw.hold_qi_cost)) return null;
    if (!isNumber(raw.base_qi_recover)) return null;
    if (!isNumber(raw.wait_qi_recover)) return null;
    if (!isBoolean(raw.margin_call_triggered)) return null;
    if (!isNumber(raw.margin_call_count) || !Number.isInteger(raw.margin_call_count)) return null;
    if (!isNumber(raw.qi_after)) return null;
    if (!isNumber(raw.score_after)) return null;
    return {
      session_id: raw.session_id,
      round: raw.round,
      season: raw.season,
      hold_earnings: raw.hold_earnings,
      hold_qi_cost: raw.hold_qi_cost,
      base_qi_recover: raw.base_qi_recover,
      wait_qi_recover: raw.wait_qi_recover,
      margin_call_triggered: raw.margin_call_triggered,
      margin_call_count: raw.margin_call_count,
      qi_after: raw.qi_after,
      score_after: raw.score_after,
    };
  },
};

/** 校验并净化载荷：只返回白名单内的字段；非法载荷返回 null。 */
export function sanitizePayload(type: string, payload: unknown): Record<string, unknown> | null {
  if (!TELEMETRY_EVENT_TYPES.includes(type as TelemetryEventType)) return null;
  return validators[type as TelemetryEventType](payload);
}

/** 校验并构造一条带 envelope 的事件（id/ts/version 由本函数生成）。 */
export function sanitizeEvent(input: { type: string; payload: unknown }): TelemetryEvent | null {
  const type = input.type;
  if (!TELEMETRY_EVENT_TYPES.includes(type as TelemetryEventType)) return null;
  const payload = sanitizePayload(type, input.payload);
  if (!payload) return null;
  return makeEvent({ type: type as TelemetryEventType, payload });
}
