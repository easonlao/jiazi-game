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
import type { TelemetryEvent } from '@core/telemetry';

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
  /** 客户端原始会话开始时间；必须携带，避免 ended_at >= started_at 约束
   *  因数据库默认 now() 晚于客户端 ended_at 而失败（异步时序竞态）。 */
  started_at: string;
  status: 'started' | 'running' | 'completed' | 'abandoned';
  rounds_completed: number;
  final_score: number;
  rules_version: string;
  game_mode: string;
  app_version: string;
  consent_version: string;
  ended_at?: string | null;
}

/** leaderboard_entries 行（仅安全公开字段） */
export interface LeaderboardSubmission {
  public_player_id: string;
  score: number;
  rules_version: string;
  session_id: string;
}

/** 云端排行榜条目（公开安全字段） */
export interface CloudLeaderboardEntry {
  public_player_id: string;
  public_code: string;
  display_name: string;
  score: number;
  date: string;
}

export interface AnalyticsBackend {
  /** 恢复/建立匿名会话；返回是否已就绪（离线等场景返回 false，不抛错） */
  ensureSession(): Promise<boolean>;
  provision(displayName: string): Promise<ProvisionResult>;
  recoverIdentity(recoveryCode: string): Promise<PlayerIdentity>;
  updateDisplayName(playerId: string, name: string): Promise<void>;
  uploadEvents(playerId: string, events: TelemetryEvent[]): Promise<void>;
  upsertSession(playerId: string, session: SessionUpsert): Promise<void>;
  submitLeaderboard(playerId: string, entry: LeaderboardSubmission): Promise<void>;
  fetchLeaderboard(limit?: number, rulesVersion?: string): Promise<CloudLeaderboardEntry[]>;
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

export class SupabaseAnalyticsBackend implements AnalyticsBackend {
  constructor(private readonly client: SupabaseClient) {}

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

  async updateDisplayName(playerId: string, name: string): Promise<void> {
    const { error } = await this.client
      .from('player_profiles')
      .update({ display_name: name })
      .eq('id', playerId);
    if (error) throw normalizeError(error);
  }

  /** 上传事件到 game_events（追加只写，按客户端事件 ID 幂等去重）。 */
  async uploadEvents(playerId: string, events: TelemetryEvent[]): Promise<void> {
    if (events.length === 0) return;
    const rows = events.map((e, index) => {
      const payload = e.payload as { session_id?: unknown; round?: unknown; season?: unknown };
      return {
        player_id: playerId,
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
    const { error } = await this.client
      .from('game_events')
      .upsert(rows, { onConflict: 'player_id,client_event_id', ignoreDuplicates: true });
    if (error) throw normalizeError(error);
  }

  async upsertSession(playerId: string, session: SessionUpsert): Promise<void> {
    const { error } = await this.client
      .from('game_sessions')
      .upsert(
        {
          player_id: playerId,
          id: session.session_id,
          client_session_id: session.session_id,
          started_at: session.started_at,
          status: session.status,
          rounds_completed: session.rounds_completed,
          final_score: session.final_score,
          rules_version: session.rules_version,
          game_mode: session.game_mode,
          app_version: session.app_version,
          consent_version: session.consent_version,
          ...(session.ended_at ? { ended_at: session.ended_at } : {}),
        },
        { onConflict: 'player_id,client_session_id' },
      );
    if (error) throw normalizeError(error);
  }

  async submitLeaderboard(playerId: string, entry: LeaderboardSubmission): Promise<void> {
    // 公开榜只收录非负成绩；负分仍保留在 session_end/round_settled 事件中，
    // 避免丢失合法的反噬结果，同时不放宽榜单表的完整性约束。
    if (entry.score < 0) return;
    const { error } = await this.client
      .from('leaderboard_entries')
      .insert({
        public_player_id: entry.public_player_id,
        score: entry.score,
        rules_version: entry.rules_version,
        session_id: entry.session_id,
      });
    if (error) throw normalizeError(error);
  }

  async fetchLeaderboard(limit = 50, rulesVersion?: string): Promise<CloudLeaderboardEntry[]> {
    let query = this.client
      .from('leaderboard_entries')
      .select('public_player_id, score, created_at');
    if (rulesVersion) query = query.eq('rules_version', rulesVersion);
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
      const r = row as { public_player_id?: unknown; score?: unknown; created_at?: unknown };
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
      };
    });
  }
}

/**
 * 最小 no-op 后端：云端未配置（env 缺失）时的安全回退。
 * 所有方法安全返回；provision/recover 显式抛出"云端未配置"；
 * fetchLeaderboard 返回空数组。保证遥测逻辑在无云端环境下零副作用运行。
 */
export class NoopAnalyticsBackend implements AnalyticsBackend {
  async ensureSession(): Promise<boolean> {
    return false;
  }

  async provision(): Promise<ProvisionResult> {
    throw new Error('云端未配置');
  }

  async recoverIdentity(): Promise<PlayerIdentity> {
    throw new Error('云端未配置');
  }

  async updateDisplayName(): Promise<void> {
    return undefined;
  }

  async uploadEvents(): Promise<void> {
    return undefined;
  }

  async upsertSession(): Promise<void> {
    return undefined;
  }

  async submitLeaderboard(): Promise<void> {
    return undefined;
  }

  async fetchLeaderboard(): Promise<CloudLeaderboardEntry[]> {
    return [];
  }
}
