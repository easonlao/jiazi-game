/**
 * 遥测与匿名身份的后端接口及其 Supabase 实现。
 *
 * 接口（AnalyticsBackend）以最小化鸭子类型设计，测试可注入 mock 后端
 * 而无需真实 Supabase SDK / 网络。
 *
 * 安全约束：
 * - 客户端只用 anon key 与会话 JWT；
 * - 恢复码只在 provision 时由 Edge Function 返回一次，客户端不持久化；
 * - player_id 为内部档案 id（player_profiles.id），RLS 通过
 *   player_identity_links 将 auth user 与 player_id 关联后做约束；
 * - 事件/会话/排行榜上传都经由上述 RLS 约束；
 * - 绝不在遥测载荷中放入恢复码或 auth token。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  validateRulesSnapshotContract,
  type ReplayAction,
  type ReplayRulesSnapshot,
} from '@core/index';
import type { TelemetryEvent } from '@core/telemetry';
import {
  summarizeCultivationLedger,
  type CultivationLedgerRecord,
  type CultivationLedgerSummary,
} from './cultivationLedger';

/** 服务端自动 provision 的默认占位名（未设置自定义用户名） */
export const DEFAULT_PLACEHOLDER_DISPLAY_NAME = '玩家';

/** 玩家公开身份（不包含恢复码） */
export interface PlayerIdentity {
  /** 内部档案 id（player_profiles.id；RLS 经 player_identity_links 关联 auth user） */
  player_id: string;
  /** 不可变的公开 Jiazi ID（排行榜展示用） */
  public_player_id: string;
  /** 受数据库唯一约束的短公开编码（排行榜展示用） */
  public_code: string;
  display_name: string;
  /**
   * 云端上榜资格：设置过非空用户名后为 true。
   * 自动 provision 的占位"玩家"为 false，终局分数只能写入本地榜。
   */
  leaderboard_eligible: boolean;
}

/** provision 一次性返回：公开身份 + 恢复码（仅此一次） */
export interface ProvisionResult extends PlayerIdentity {
  recovery_code: string;
}

/** game_sessions 行（按 (player_id, client_session_id) upsert 收敛） */
export interface SessionUpsert {
  session_id: string;
  client_session_id?: string;
  /** 客户端原始会话开始时间；必须携带，避免 ended_at >= started_at 约束
   *  因数据库默认 now() 晚于客户端 ended_at 而失败（异步时序竞态）。 */
  started_at: string;
  status: 'started' | 'running' | 'completed' | 'abandoned' | 'failed' | 'corrupted_recovery';
  rounds_completed: number;
  final_score: number;
  rules_version: string;
  balance_profile_id?: string;
  game_mode: string;
  app_version: string;
  consent_version: string;
  ended_at?: string | null;
  expected_session_revision?: number;
  expected_last_event_sequence?: number;
}

export interface CloudActiveGameSession {
  session_id: string;
  client_session_id?: string;
  started_at: string;
  seed: number;
  rules_snapshot: ReplayRulesSnapshot;
  actions: ReplayAction[];
  rounds_completed: number;
  final_score: number;
  session_revision: number;
  last_event_sequence?: number;
}

export interface VerifiedSessionStart {
  session_id: string;
  started_at: string;
  seed: number;
  rules_snapshot: ReplayRulesSnapshot;
}

export interface VerifiedScoreSubmission {
  session_id: string;
  actions: readonly ReplayAction[];
}

/**
 * 校验提交结果（服务端重放结果），永远以结果对象返回，不抛错。
 * - verified：重放通过，分数已可信（score 为该服务端重放分数）；
 * - rejected：服务端明确拒绝重放（动作序列不可信/不完整）；
 * - 其余（网络失败、服务端错误等）为 verified=false && rejected=false。
 */
export interface VerifiedScoreOutcome {
  verified: boolean;
  rejected: boolean;
  score: number | null;
  /** 校验通过后是否已写入云端榜（未设置昵称等资格限制时为 false）。 */
  leaderboard_submitted: boolean;
  message: string | null;
}

/** 云端排行榜条目（公开安全字段） */
export interface CloudLeaderboardEntry {
  public_player_id: string;
  public_code: string;
  display_name: string;
  score: number;
  date: string;
  rules_version?: string;
  balance_profile_id?: string;
}

export type CultivationLedgerRecordSource = 'local_claim' | 'verified_session';

export interface CultivationLedgerEntry {
  player_id: string;
  local_game_id: string;
  game_session_id: string | null;
  rules_version: number;
  balance_profile_id?: string | null;
  started_at: string;
  ended_at: string | null;
  outcome: Exclude<CultivationLedgerRecord['outcome'], 'active'>;
  final_score: number | null;
  record_source: CultivationLedgerRecordSource;
  created_at: string;
  updated_at: string;
}

export interface CultivationLedgerSnapshot {
  records: CultivationLedgerEntry[];
  summary: CultivationLedgerSummary;
}

/** 云端开局失败的结构化错误码 */
export type CloudStartErrorCode =
  | 'telemetry_disabled'       // 遥测或授权未开启
  | 'cloud_not_configured'     // 云端客户端未配置
  | 'identity_not_ready'       // 玩家身份未就绪 / 鉴权失效 (401/403)
  | 'network_error'            // 网络不可达 / 超时
  | 'service_unavailable'     // 云端开局函数异常 (5xx)
  | 'service_contract_error'   // 云端返回响应格式异常或结构损坏
  | 'rules_version_mismatch'   // 服务端规则版本与客户端不一致 (409)
  | 'session_rejected'         // 会话创建被拒绝 (400/409/其他)
  | 'unknown_error';           // 未知异常

export interface CloudStartError {
  code: CloudStartErrorCode;
  message: string;
  userMessage: string;
  statusCode?: number | null;
  rawError?: unknown;
}

export type VerifiedSessionStartResult =
  | { success: true; session: VerifiedSessionStart }
  | { success: false; error: CloudStartError };

export interface AnalyticsBackend {
  readonly isConfigured?: boolean;
  /** 恢复/建立匿名会话；返回是否已就绪（离线等场景返回 false，不抛错） */
  ensureSession(): Promise<boolean>;
  provision(displayName: string): Promise<ProvisionResult>;
  recoverIdentity(recoveryCode: string): Promise<PlayerIdentity>;
  /**
   * 更新显示昵称并返回服务端确认后的身份。
   * 只有服务端确认返回的行才算成功（含 RLS/未命中拒绝）；实现不得静默成功。
   */
  updateDisplayName(playerId: string, name: string): Promise<PlayerIdentity>;
  uploadEvents(playerId: string, events: TelemetryEvent[]): Promise<Array<{ session_id: string; session_revision: number; inserted_count: number }>>;
  upsertSession(playerId: string, session: SessionUpsert): Promise<void>;
  startVerifiedSession(playerId: string, meta: SessionUpsert): Promise<VerifiedSessionStartResult>;
  submitVerifiedScore(playerId: string, submission: VerifiedScoreSubmission): Promise<VerifiedScoreOutcome>;
  fetchLeaderboard(limit?: number, rulesVersion?: string, balanceProfileId?: string): Promise<CloudLeaderboardEntry[]>;
  fetchActiveGameSession(playerId: string): Promise<CloudActiveGameSession | null>;
  fetchCultivationLedger(playerId: string): Promise<CultivationLedgerSnapshot>;
  /** 鉴权查询服务端当前为该玩家分配的平衡档案标识 */
  fetchAssignedBalanceProfile(playerId: string): Promise<string | null>;
  /** 服务端重放验证受损对局并执行免惩罚恢复 */
  recoverCorruptedSession(
    sessionId: string,
    expectedLastEventSequence?: number,
  ): Promise<{ success: boolean; error?: string; isConflict?: boolean }>;
}

export class SessionConflictError extends Error {
  readonly isConflict = true;
  constructor(message: string) {
    super(message);
    this.name = 'SessionConflictError';
  }
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'object' && error !== null) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string') return new Error(msg);
  }
  return new Error('analytics backend error');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(v: unknown, field: string): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= 128 ? v : null;
}

/** 提取 Edge Function 调用的 HTTP 状态码与 JSON 错误码（Supabase FunctionsHttpError 等）。 */
async function extractFunctionError(error: unknown): Promise<{ statusCode: number | null; message: string }> {
  if (typeof error === 'object' && error !== null) {
    const ctx = (error as {
      context?: {
        status?: unknown;
        status_code?: unknown;
        clone?: () => { json?: () => Promise<unknown> };
        json?: () => Promise<unknown>;
      };
    }).context;
    const statusCode = ctx && typeof ctx.status === 'number'
      ? ctx.status
      : ctx && typeof ctx.status_code === 'number'
        ? ctx.status_code
        : null;
    let message =
      typeof (error as { message?: unknown }).message === 'string'
        ? ((error as { message?: unknown }).message as string)
        : 'verification_error';
    try {
      const readable = ctx?.clone?.() ?? ctx;
      const body = readable?.json ? await readable.json() : null;
      if (isRecord(body) && typeof body.error === 'string') message = body.error;
    } catch {
      // 响应体不可读时保留 SDK 错误信息。
    }
    return { statusCode, message };
  }
  return { statusCode: null, message: 'verification_error' };
}

function parseVerifiedSessionStart(data: unknown): VerifiedSessionStart | null {
  if (!isRecord(data)) return null;
  const session_id = requireString(data.session_id, 'session_id');
  const started_at = requireString(data.started_at, 'started_at');
  const seed = data.seed;
  const snapshot = data.rules_snapshot;
  if (!session_id || !started_at || !Number.isSafeInteger(seed) || !isRecord(snapshot)) return null;
  const volatility = snapshot.volatility;
  const scoreRules = snapshot.scoreRules;
  const rulesVersion = snapshot.rulesVersion;
  if (
    typeof rulesVersion !== 'number' ||
    !Number.isInteger(rulesVersion) ||
    snapshot.gameMode !== 'volatility_trade' ||
    snapshot.volatilityEnabled !== true ||
    !isRecord(volatility) ||
    !isRecord(scoreRules) ||
    typeof scoreRules.holdBonus !== 'number' ||
    typeof scoreRules.sellMultiplier !== 'number'
  ) return null;
  // 完整冻结契约由 startVerifiedSession 返回细分错误；此处只做结构解析，避免吞掉可诊断的漂移原因。
  return {
    session_id,
    started_at,
    seed: seed as number,
    rules_snapshot: snapshot as unknown as ReplayRulesSnapshot,
  };
}

function parseCultivationLedgerEntry(data: unknown): CultivationLedgerEntry | null {
  if (!isRecord(data)) return null;
  const player_id = requireString(data.player_id, 'player_id');
  const local_game_id = requireString(data.local_game_id, 'local_game_id');
  const record_source = data.record_source;
  const started_at = requireString(data.started_at, 'started_at');
  const created_at = requireString(data.created_at, 'created_at');
  const updated_at = requireString(data.updated_at, 'updated_at');
  if (!player_id || !local_game_id || !started_at || !created_at || !updated_at) return null;
  if (record_source !== 'local_claim' && record_source !== 'verified_session') return null;
  const rules_version = typeof data.rules_version === 'number' && Number.isInteger(data.rules_version)
    ? data.rules_version
    : null;
  if (rules_version === null) return null;
  const outcome = data.outcome;
  if (outcome !== 'completed' && outcome !== 'abandoned') return null;
  const final_score = data.final_score;
  if (!(final_score === null || typeof final_score === 'number')) return null;
  const game_session_id = data.game_session_id === null
    ? null
    : requireString(data.game_session_id, 'game_session_id');
  const ended_at = data.ended_at === null
    ? null
    : requireString(data.ended_at, 'ended_at');
  const balance_profile_id = typeof data.balance_profile_id === 'string'
    ? data.balance_profile_id
    : null;
  if (game_session_id === undefined || ended_at === undefined) return null;
  return {
    player_id,
    local_game_id,
    game_session_id,
    rules_version,
    balance_profile_id,
    started_at,
    ended_at,
    outcome,
    final_score,
    record_source,
    created_at,
    updated_at,
  };
}

function parseCultivationLedgerSnapshot(data: unknown): CultivationLedgerSnapshot | null {
  if (!isRecord(data) || !Array.isArray(data.records)) return null;
  const records = data.records
    .map((record) => parseCultivationLedgerEntry(record))
    .filter((record): record is CultivationLedgerEntry => Boolean(record));
  const summary = summarizeCultivationLedger(
    records.map((record) => ({
      rulesVersion: record.rules_version,
      outcome: record.outcome,
      finalScore: record.final_score,
    })),
  );
  return { records, summary };
}

/** 解析 Edge Function 返回的公开身份（严格校验字段形状，防脏数据入库）。
 *  player_id 视为内部档案 id（player_profiles.id）。 */
function parsePlayerIdentity(data: unknown): PlayerIdentity | null {
  if (!isRecord(data)) return null;
  const player_id = requireString(data.player_id, 'player_id');
  const public_player_id = requireString(data.public_player_id, 'public_player_id');
  const public_code = requireString(data.public_code, 'public_code');
  const display_name = requireString(data.display_name, 'display_name');
  if (!player_id || !public_player_id || display_name === null) return null;
  const leaderboard_eligible =
    typeof data.leaderboard_eligible === 'boolean'
      ? data.leaderboard_eligible
      : display_name.trim().length > 0 && display_name !== DEFAULT_PLACEHOLDER_DISPLAY_NAME;
  return {
    player_id,
    public_player_id,
    public_code: public_code ?? public_player_id.replace(/-/g, '').slice(0, 12).toUpperCase(),
    display_name,
    leaderboard_eligible,
  };
}

export function mapFunctionErrorToCloudStartError(
  error: unknown,
  extracted?: { statusCode?: number | null; message: string },
): CloudStartError {
  const isNetwork =
    (error as any)?.name === 'TypeError' ||
    (error as any)?.message?.includes('fetch') ||
    (error as any)?.message?.includes('network') ||
    (error as any)?.message?.includes('Failed to fetch');

  if (isNetwork) {
    return {
      code: 'network_error',
      message: (error as any)?.message || 'Failed to fetch',
      userMessage: '网络连接失败，无法访问云端服务器',
      statusCode: null,
      rawError: error,
    };
  }

  const message = extracted?.message || (error as any)?.message || '';
  const statusCode = extracted?.statusCode ?? (error as any)?.status ?? null;

  if (statusCode === 401 || message.includes('unauthorized') || message.includes('auth_required')) {
    return {
      code: 'identity_not_ready',
      message: message || 'unauthorized',
      userMessage: '修士身份鉴权已失效（请在修行档案中重新立档）',
      statusCode,
      rawError: error,
    };
  }

  if (statusCode === 403 || message.includes('forbidden') || message.includes('identity_not_found')) {
    return {
      code: 'identity_not_ready',
      message: message || 'identity_forbidden',
      userMessage: '修士身份尚未在云端立档（请先在修行档案中生成玩家 ID）',
      statusCode,
      rawError: error,
    };
  }

  if (statusCode === 409 || message.includes('rules_version') || message.includes('rules_mismatch')) {
    const isRulesMismatch = message.includes('rules_version') || message.includes('rules_mismatch');
    return {
      code: isRulesMismatch ? 'rules_version_mismatch' : 'session_rejected',
      message: message || 'conflict',
      userMessage: isRulesMismatch
        ? '云端规则版本与当前客户端不一致（请刷新网页）'
        : '云端存在冲突的进行中对局，开局被拒绝',
      statusCode,
      rawError: error,
    };
  }

  if (statusCode && statusCode >= 500) {
    return {
      code: 'service_unavailable',
      message: message || `Server error ${statusCode}`,
      userMessage: '云端开局服务暂时不可用（HTTP 5xx，请稍后重试）',
      statusCode,
      rawError: error,
    };
  }

  return {
    code: 'unknown_error',
    message: message || 'unknown error',
    userMessage: `云端开局失败：${message || '未知错误'}`,
    statusCode,
    rawError: error,
  };
}

export class SupabaseAnalyticsBackend implements AnalyticsBackend {
  readonly isConfigured = true;
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async ensureSession(): Promise<boolean> {
    try {
      const { data } = await this.client.auth.getSession();
      if (data.session) return true;
      const { error } = await this.client.auth.signInAnonymously();
      if (error) return false;
      return true;
    } catch {
      return false;
    }
  }

  async provision(displayName: string): Promise<ProvisionResult> {
    const { data, error } = await this.client.functions.invoke('provision-player', {
      body: { display_name: displayName },
    });
    if (error) throw normalizeError(error);
    const identity = parsePlayerIdentity(data);
    if (!identity) throw new Error('provision-player 返回异常');
    const recovery_code = requireString(isRecord(data) ? data.recovery_code : undefined, 'recovery_code');
    if (!recovery_code) throw new Error('provision-player 缺少恢复码');
    return { ...identity, recovery_code };
  }

  async recoverIdentity(recoveryCode: string): Promise<PlayerIdentity> {
    const { data, error } = await this.client.functions.invoke('recover-player', {
      body: { recovery_code: recoveryCode },
    });
    if (error) throw normalizeError(error);
    const identity = parsePlayerIdentity(data);
    if (!identity) throw new Error('recover-player 返回异常');
    return identity;
  }

  async updateDisplayName(playerId: string, name: string): Promise<PlayerIdentity> {
    // update 后 select+single 拿回服务端（DB 触发器）重新计算的资格，而不是乐观假设命中。
    // RLS 拒绝或档案不存在时 PostgREST 返回空集，.single() 抛 PGRST116 使调用失败。
    const { data, error } = await this.client
      .from('player_profiles')
      .update({ display_name: name })
      .eq('id', playerId)
      .select('player_id:id, public_player_id, public_code, display_name, leaderboard_eligible')
      .single();
    if (error) throw normalizeError(error);
    const identity = parsePlayerIdentity(data);
    if (!identity) throw new Error('updateDisplayName 未命中档案或返回异常');
    return identity;
  }

  /** 上传事件到 game_events（通过受控 append-only RPC 幂等追加并返回最新 session_revision）。 */
  async uploadEvents(playerId: string, events: TelemetryEvent[]): Promise<Array<{ session_id: string; session_revision: number; inserted_count: number }>> {
    if (events.length === 0) return [];
    const rows = events.map((e, index) => {
      const payload = e.payload as { session_id?: unknown; round?: unknown; season?: unknown };
      return {
        session_id: String(payload.session_id ?? ''),
        client_event_id: e.id,
        sequence: e.sequence ?? index,
        event_type: e.type,
        round: typeof payload.round === 'number' ? payload.round : null,
        season: typeof payload.season === 'string' ? payload.season : null,
        action: e.type.startsWith('action_') ? e.type.slice('action_'.length) : null,
        payload: e.payload,
        occurred_at: e.ts,
      };
    });
    const { data, error } = await this.client.rpc('append_game_events', {
      p_player_id: playerId,
      p_events: rows,
    });
    if (error) throw normalizeError(error);
    return Array.isArray(data) ? (data as Array<{ session_id: string; session_revision: number; inserted_count: number }>) : [];
  }

  async upsertSession(playerId: string, session: SessionUpsert): Promise<void> {
    const revision = session.expected_session_revision ?? session.expected_last_event_sequence ?? null;
    const { error } = await this.client.rpc('upsert_game_session', {
      p_player_id: playerId,
      p_session_id: session.session_id,
      p_client_session_id: session.client_session_id ?? session.session_id,
      p_started_at: session.started_at,
      p_status: session.status,
      p_rounds_completed: session.rounds_completed,
      p_final_score: session.final_score,
      p_rules_version: session.rules_version,
      p_game_mode: session.game_mode,
      p_app_version: session.app_version,
      p_consent_version: session.consent_version,
      p_ended_at: session.ended_at ?? null,
      p_expected_session_revision: revision,
    });
    if (error) {
      const msg = error.message ?? '';
      const code = (error as any).code ?? '';
      const details = (error as any).details ?? '';
      if (msg.includes('conflict') || code === '40900' || details.includes('40900')) {
        throw new SessionConflictError(msg || 'newer session revision exists on cloud session');
      }
      throw normalizeError(error);
    }
  }

  async recoverCorruptedSession(
    sessionId: string,
    expectedSessionRevision?: number,
  ): Promise<{ success: boolean; error?: string; isConflict?: boolean }> {
    try {
      const { data, error } = await this.client.functions.invoke('recover-corrupted-session', {
        body: {
          session_id: sessionId,
          expected_session_revision: expectedSessionRevision ?? null,
        },
      });
      if (error) {
        const parsed = await extractFunctionError(error);
        const isConflict =
          parsed.statusCode === 409 ||
          parsed.message === 'conflict' ||
          parsed.message.includes('conflict') ||
          parsed.message === 'session_already_finalized' ||
          parsed.message.includes('session_already_finalized');
        return { success: false, error: parsed.message, isConflict };
      }
      const ok = isRecord(data) && data.success === true;
      const err = ok ? undefined : String(data?.error ?? 'recovery_failed');
      const isConflict = !ok && (err === 'conflict' || err === 'session_already_finalized');
      return { success: ok, error: err, isConflict };
    } catch (e) {
      const parsed = await extractFunctionError(e);
      const isConflict =
        parsed.statusCode === 409 ||
        parsed.message === 'conflict' ||
        parsed.message.includes('conflict') ||
        parsed.message === 'session_already_finalized' ||
        parsed.message.includes('session_already_finalized');
      return { success: false, error: parsed.message, isConflict };
    }
  }

  async startVerifiedSession(playerId: string, meta: SessionUpsert): Promise<VerifiedSessionStartResult> {
    try {
      const { data, error } = await this.client.functions.invoke('start-verified-session', {
        body: {
          client_session_id: meta.session_id,
          app_version: meta.app_version,
          consent_version: meta.consent_version,
        },
      });

      if (error) {
        const extracted = await extractFunctionError(error);
        return {
          success: false,
          error: mapFunctionErrorToCloudStartError(error, extracted),
        };
      }

      const parsed = parseVerifiedSessionStart(data);
      if (!parsed) {
        return {
          success: false,
          error: {
            code: 'service_contract_error',
            message: 'Invalid verified session response structure',
            userMessage: '云端返回的对局种子或规则快照格式异常（请稍后重试）',
            statusCode: 200,
          },
        };
      }

      const requestedVersion = Number(meta.rules_version);
      if (parsed.rules_snapshot.rulesVersion !== requestedVersion) {
        return {
          success: false,
          error: {
            code: 'rules_version_mismatch',
            message: `Rules version mismatch: expected ${requestedVersion}, got ${parsed.rules_snapshot.rulesVersion}`,
            userMessage: `云端规则版本 (V${parsed.rules_snapshot.rulesVersion}) 与客户端 (V${requestedVersion}) 不一致`,
            statusCode: 200,
          },
        };
      }

      const contractCheck = validateRulesSnapshotContract(parsed.rules_snapshot);
      if (!contractCheck.valid) {
        return {
          success: false,
          error: {
            code: 'service_contract_error',
            message: `Rules snapshot contract violation: ${contractCheck.reason}`,
            userMessage: `云端规则快照参数异常（${contractCheck.reason}）`,
            statusCode: 200,
          },
        };
      }

      return { success: true, session: parsed };
    } catch (err: any) {
      return {
        success: false,
        error: mapFunctionErrorToCloudStartError(err),
      };
    }
  }

  async submitVerifiedScore(playerId: string, submission: VerifiedScoreSubmission): Promise<VerifiedScoreOutcome> {
    const { data, error } = await this.client.functions.invoke('submit-verified-score', {
      body: {
        session_id: submission.session_id,
        actions: submission.actions,
      },
    });
    if (!error) {
      const ok = isRecord(data) && data.verified === true;
      return {
        verified: ok,
        rejected: false,
        score: ok && typeof data.score === 'number' ? data.score : null,
        leaderboard_submitted: ok && data.leaderboard_submitted === true,
        message: ok ? null : 'verified_score_rejected',
      };
    }
    const { statusCode, message } = await extractFunctionError(error);
    return {
      verified: false,
      rejected: statusCode === 404 || statusCode === 409 || statusCode === 422,
      score: null,
      leaderboard_submitted: false,
      message: message || 'verification_error',
    };
  }

  async fetchLeaderboard(limit = 50, rulesVersion?: string, balanceProfileId?: string): Promise<CloudLeaderboardEntry[]> {
    let query = this.client
      .from('leaderboard_entries')
      .select('public_player_id, score, created_at, rules_version, balance_profile_id');
    if (rulesVersion) query = query.eq('rules_version', rulesVersion);
    if (balanceProfileId) query = query.eq('balance_profile_id', balanceProfileId);
    const { data, error } = await query.order('score', { ascending: false }).limit(limit);
    if (error) throw normalizeError(error);
    if (!Array.isArray(data)) return [];
    const publicIds = data
      .map((row) => (row as { public_player_id?: unknown }).public_player_id)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    const profilesByPublicId = new Map<
      string,
      { public_code: string; display_name: string; leaderboard_eligible: boolean }
    >();
    if (publicIds.length > 0) {
      const { data: profiles, error: profilesError } = await this.client
        .from('player_profiles')
        .select('public_player_id, public_code, display_name, leaderboard_eligible')
        .in('public_player_id', publicIds);
      if (profilesError) throw normalizeError(profilesError);
      for (const profile of profiles ?? []) {
        const p = profile as {
          public_player_id?: unknown;
          public_code?: unknown;
          display_name?: unknown;
          leaderboard_eligible?: unknown;
        };
        if (typeof p.public_player_id === 'string' && typeof p.display_name === 'string') {
          profilesByPublicId.set(p.public_player_id, {
            public_code:
              typeof p.public_code === 'string'
                ? p.public_code
                : p.public_player_id.replace(/-/g, '').slice(0, 12).toUpperCase(),
            display_name: p.display_name,
            leaderboard_eligible: p.leaderboard_eligible === true,
          });
        }
      }
    }
    return data.flatMap((row) => {
      const r = row as {
        public_player_id?: unknown;
        score?: unknown;
        created_at?: unknown;
        rules_version?: unknown;
        balance_profile_id?: unknown;
      };
      const public_player_id = String(r.public_player_id ?? '');
      const profile = profilesByPublicId.get(public_player_id);
      // Hide legacy rows created before the username gate, even if they remain
      // in the table. New inserts are blocked by RLS and the DB trigger.
      if (!profile?.leaderboard_eligible || profile.display_name.trim().length === 0) return [];
      return {
        public_player_id,
        public_code: profile.public_code,
        display_name: profile.display_name,
        score: Number(r.score ?? 0),
        date: String(r.created_at ?? ''),
        rules_version: typeof r.rules_version === 'string' ? r.rules_version : undefined,
        balance_profile_id: typeof r.balance_profile_id === 'string' ? r.balance_profile_id : undefined,
      };
    });
  }

  async fetchActiveGameSession(playerId: string): Promise<CloudActiveGameSession | null> {
    try {
      const { data, error } = await this.client
        .from('game_sessions')
        .select('id, client_session_id, started_at, replay_seed, rules_snapshot, status, rounds_completed, final_score, session_revision')
        .eq('player_id', playerId)
        .in('status', ['started', 'running'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      const session_id = String(data.id ?? '');
      const client_session_id = typeof data.client_session_id === 'string' ? data.client_session_id : undefined;
      const seed = data.replay_seed;
      const snapshot = data.rules_snapshot;
      if (!session_id || typeof seed !== 'number' || !snapshot || !validateRulesSnapshotContract(snapshot).valid) return null;

      let actions: ReplayAction[] = [];
      let last_event_sequence = 0;
      let eventCount = 0;
      try {
        const { data: events } = await this.client
          .from('game_events')
          .select('event_type, sequence, payload, occurred_at')
          .eq('player_id', playerId)
          .eq('session_id', session_id)
          .order('sequence', { ascending: true })
          .order('occurred_at', { ascending: true });
        if (Array.isArray(events)) {
          eventCount = events.length;
          for (const ev of events) {
            if (typeof ev.sequence === 'number' && ev.sequence > last_event_sequence) {
              last_event_sequence = ev.sequence;
            }
            const p = (ev.payload as Record<string, unknown>) ?? {};
            if (p.replay_action && typeof (p.replay_action as { type?: unknown }).type === 'string') {
              actions.push(p.replay_action as ReplayAction);
            } else if (ev.event_type === 'action_buy' && typeof p.card_index === 'number') {
              actions.push({ type: 'buy', cardIndex: p.card_index, leverage: Boolean(p.use_leverage) });
            } else if (ev.event_type === 'action_sell' && typeof p.slot_index === 'number') {
              actions.push({ type: 'sell', slotIndex: p.slot_index });
            } else if (ev.event_type === 'action_wait') {
              actions.push({ type: 'wait' });
            } else if (ev.event_type === 'action_lock' && typeof p.card_index === 'number') {
              actions.push({ type: 'lock', cardIndex: p.card_index });
            } else if (ev.event_type === 'action_unlock' && typeof p.card_index === 'number') {
              actions.push({ type: 'unlock', cardIndex: p.card_index });
            }
          }
        }
      } catch (e) {
        console.warn('[analytics] fetchActiveGameSession events failed', e);
      }

      const dbRevision = typeof data.session_revision === 'number' ? data.session_revision : 0;
      const session_revision = Math.max(dbRevision, eventCount);

      return {
        session_id,
        client_session_id,
        started_at: data.started_at,
        seed,
        rules_snapshot: snapshot as ReplayRulesSnapshot,
        actions,
        rounds_completed: data.rounds_completed ?? 0,
        final_score: data.final_score ?? 0,
        session_revision,
        last_event_sequence,
      };
    } catch {
      return null;
    }
  }

  async fetchCultivationLedger(playerId: string): Promise<CultivationLedgerSnapshot> {
    const { data, error } = await this.client
      .from('cultivation_ledger_entries')
      .select('player_id, local_game_id, game_session_id, rules_version, balance_profile_id, started_at, ended_at, outcome, final_score, record_source, created_at, updated_at')
      .eq('player_id', playerId)
      .order('started_at', { ascending: false });
    if (error) throw normalizeError(error);
    return parseCultivationLedgerSnapshot({ records: data ?? [] }) ?? {
      records: [],
      summary: summarizeCultivationLedger([]),
    };
  }

  async fetchAssignedBalanceProfile(_playerId: string): Promise<string | null> {
    try {
      const { data, error } = await this.client.functions.invoke('get-player-profile');
      if (error) {
        console.warn('[analyticsBackend] get-player-profile invoke failed', error);
        return null;
      }
      if (data && typeof data.balance_profile_id === 'string') {
        return data.balance_profile_id;
      }
      return null;
    } catch (e) {
      console.warn('[analyticsBackend] fetchAssignedBalanceProfile failed', e);
      return null;
    }
  }
}

/**
 * 最小 no-op 后端：云端未配置（env 缺失）时的安全回退。
 * 所有方法安全返回；provision/recover 显式抛出"云端未配置"；
 * fetchLeaderboard 返回空数组。保证遥测逻辑在无云端环境下零副作用运行。
 */
export class NoopAnalyticsBackend implements AnalyticsBackend {
  readonly isConfigured = false;
  async ensureSession(): Promise<boolean> {
    return false;
  }

  async provision(): Promise<ProvisionResult> {
    throw new Error('云端未配置');
  }

  async recoverIdentity(): Promise<PlayerIdentity> {
    throw new Error('云端未配置');
  }

  async updateDisplayName(): Promise<PlayerIdentity> {
    throw new Error('云端未配置');
  }

  async uploadEvents(): Promise<Array<{ session_id: string; session_revision: number; inserted_count: number }>> {
    return [];
  }

  async upsertSession(): Promise<void> {
    return undefined;
  }

  async startVerifiedSession(): Promise<VerifiedSessionStartResult> {
    return {
      success: false,
      error: {
        code: 'cloud_not_configured',
        message: 'Supabase client not configured',
        userMessage: '云端服务未配置（未检测到 Supabase 凭据）',
        statusCode: null,
      },
    };
  }

  async submitVerifiedScore(): Promise<VerifiedScoreOutcome> {
    return {
      verified: false,
      rejected: false,
      score: null,
      leaderboard_submitted: false,
      message: '云端未配置',
    };
  }

  async fetchLeaderboard(): Promise<CloudLeaderboardEntry[]> {
    return [];
  }

  async fetchActiveGameSession(): Promise<CloudActiveGameSession | null> {
    return null;
  }

  async fetchCultivationLedger(): Promise<CultivationLedgerSnapshot> {
    return { records: [], summary: summarizeCultivationLedger([]) };
  }

  async fetchAssignedBalanceProfile(): Promise<string | null> {
    return null;
  }

  async recoverCorruptedSession(): Promise<{ success: boolean; error?: string; isConflict?: boolean }> {
    return { success: true };
  }
}
