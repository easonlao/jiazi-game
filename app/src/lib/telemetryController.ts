/**
 * 遥测控制器（浏览器端适配层）。
 *
 * 职责：
 * - 统一管理同意书（consent）与匿名身份（identity）状态并持久化；
 * - 把游戏生命周期信号转成白名单遥测事件，入队批量上传；
 * - 会话（session）生命周期管理：start/end/abandon/pagehide；
 * - 游戏结束向云端排行榜提交分数（仅已设置用户名的身份）；
 * - 所有遥测操作均为 best-effort：任何失败都不抛给游戏主流程。
 *
 * 安全：
 * - 恢复码只保存在内存/页面级 sessionStorage，绝不写入 localStorage；
 * - 载荷不含恢复码 / auth token；
 * - 未获同意前队列关闭，事件直接丢弃。
 */

import type { StorageProvider } from '@core/index';
import {
  TELEMETRY_CONSENT_VERSION,
  TelemetryQueue,
  newUuid,
  type TelemetryEventType,
  type TelemetryTransport,
} from '@core/telemetry';
import type {
  AnalyticsBackend,
  CloudLeaderboardEntry,
  PlayerIdentity,
} from './analyticsBackend';

const CONSENT_KEY = 'jiazi_consent';
const IDENTITY_KEY = 'jiazi_player_identity';
const RECOVERY_SESSION_KEY = 'jiazi_recovery_code_session';

/** 与 package.json 版本保持一致（发版时同步修改） */
export const APP_VERSION = '0.2.0';

export interface ConsentState {
  version: number;
  granted: boolean;
  granted_at: string | null;
}

export interface ActiveSessionMeta {
  rules_version: string;
  game_mode: string;
  volatility_enabled: boolean;
}

export interface SessionProgress {
  rounds: number;
  final_score: number;
  margin_call_count: number;
}

export interface SessionEndResult extends SessionProgress {
  reason: 'game_over' | 'pagehide' | 'reset';
}

export interface TelemetryControllerState {
  consent: ConsentState | null;
  identity: PlayerIdentity | null;
  /** 一次性恢复码（内存级，不持久化） */
  recovery_code: string | null;
  telemetryEnabled: boolean;
  busy: boolean;
  error: string | null;
}

export interface TelemetryControllerDeps {
  storage: StorageProvider;
  backend: AnalyticsBackend;
  appVersion?: string;
  now?: () => number;
  onStateChange?: (state: TelemetryControllerState) => void;
}

function readJson<T>(storage: StorageProvider, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readConsent(storage: StorageProvider): ConsentState | null {
  const p = readJson<Record<string, unknown>>(storage, CONSENT_KEY);
  if (!p || typeof p.version !== 'number' || typeof p.granted !== 'boolean') return null;
  return {
    version: p.version,
    granted: p.granted,
    granted_at: typeof p.granted_at === 'string' ? p.granted_at : null,
  };
}

function writeConsent(storage: StorageProvider, granted: boolean): void {
  const value: ConsentState = {
    version: TELEMETRY_CONSENT_VERSION,
    granted,
    granted_at: new Date().toISOString(),
  };
  storage.setItem(CONSENT_KEY, JSON.stringify(value));
}

function readIdentity(storage: StorageProvider): PlayerIdentity | null {
  const p = readJson<Record<string, unknown>>(storage, IDENTITY_KEY);
  if (
    !p ||
    typeof p.player_id !== 'string' ||
    typeof p.public_player_id !== 'string' ||
    typeof p.display_name !== 'string'
  ) {
    return null;
  }
  return {
    player_id: p.player_id,
    public_player_id: p.public_player_id,
    public_code:
      typeof p.public_code === 'string'
        ? p.public_code
        : p.public_player_id.replace(/-/g, '').slice(0, 12).toUpperCase(),
    display_name: p.display_name,
    // 兼容旧版本地身份：历史上只有非默认名称才代表玩家主动设置过名称。
    leaderboard_eligible:
      typeof p.leaderboard_eligible === 'boolean'
        ? p.leaderboard_eligible
        : p.display_name.trim().length > 0 && p.display_name !== '玩家',
  };
}

function writeIdentity(storage: StorageProvider, identity: PlayerIdentity): void {
  storage.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

function readSessionRecoveryCode(): string | null {
  try {
    return sessionStorage.getItem(RECOVERY_SESSION_KEY);
  } catch {
    return null;
  }
}

function writeSessionRecoveryCode(code: string | null): void {
  try {
    if (code === null) sessionStorage.removeItem(RECOVERY_SESSION_KEY);
    else sessionStorage.setItem(RECOVERY_SESSION_KEY, code);
  } catch {
    // sessionStorage 不可用时仅内存持有
  }
}

function createTransport(
  backend: AnalyticsBackend,
  getPlayerId: () => string | null,
): TelemetryTransport {
  return {
    async upload(batch) {
      const playerId = getPlayerId();
      if (!playerId) throw new Error('identity-not-ready');
      await backend.uploadEvents(playerId, batch);
    },
  };
}

export class TelemetryController {
  private readonly storage: StorageProvider;
  private readonly backend: AnalyticsBackend;
  private readonly appVersion: string;
  private readonly queue: TelemetryQueue;
  private readonly onStateChange?: (state: TelemetryControllerState) => void;

  private state: TelemetryControllerState;
  private session: { session_id: string; started_at: string; ended: boolean; meta: ActiveSessionMeta } | null = null;
  private sessionProgress: SessionProgress = { rounds: 0, final_score: 0, margin_call_count: 0 };
  private pagehideBound = false;

  constructor(deps: TelemetryControllerDeps) {
    this.storage = deps.storage;
    this.backend = deps.backend;
    this.appVersion = deps.appVersion ?? APP_VERSION;
    this.onStateChange = deps.onStateChange;
    this.state = {
      consent: readConsent(deps.storage),
      identity: readIdentity(deps.storage),
      recovery_code: readSessionRecoveryCode(),
      telemetryEnabled: false,
      busy: false,
      error: null,
    };
    this.queue = new TelemetryQueue({
      storage: deps.storage,
      transport: createTransport(this.backend, () => this.state.identity?.player_id ?? null),
      now: deps.now,
    });
  }

  getState(): TelemetryControllerState {
    return { ...this.state };
  }

  /** 当前活跃会话 id；无会话时返回 null。 */
  getActiveSessionId(): string | null {
    return this.session?.session_id ?? null;
  }

  private setState(patch: Partial<TelemetryControllerState>): void {
    this.state = { ...this.state, ...patch };
    this.onStateChange?.(this.getState());
  }

  private setTelemetryEnabled(enabled: boolean): void {
    this.queue.setEnabled(enabled);
    this.setState({ telemetryEnabled: enabled });
  }

  /** 应用加载时初始化：若已同意则恢复遥测并尝试恢复匿名会话与身份。 */
  async init(): Promise<void> {
    if (this.state.consent?.granted) {
      this.setTelemetryEnabled(true);
      this.bindPagehide();
      this.setState({ busy: true });
      const ok = await this.backend.ensureSession();
      if (ok && !this.state.identity) {
        await this.provision(this.defaultDisplayName());
      }
      this.setState({ busy: false, error: ok ? null : '云端身份暂不可用，可继续本地游玩' });
    }
  }

  /** 玩家同意遥测：持久化同意、打开队列，并建立或恢复匿名身份。 */
  async grantConsent(recoveryCode?: string): Promise<void> {
    writeConsent(this.storage, true);
    this.setState({
      consent: { version: TELEMETRY_CONSENT_VERSION, granted: true, granted_at: new Date().toISOString() },
      busy: true,
      error: null,
    });
    this.setTelemetryEnabled(true);
    this.bindPagehide();
    const ok = await this.backend.ensureSession();
    if (ok) {
      if (recoveryCode?.trim()) await this.recoverIdentity(recoveryCode);
      else await this.provision(this.defaultDisplayName());
    } else {
      this.setState({ error: '云端服务暂不可用，可稍后重试' });
    }
    this.setState({ busy: false });
  }

  /** 玩家拒绝遥测：持久化拒绝并彻底关闭遥测。 */
  declineConsent(): void {
    writeConsent(this.storage, false);
    this.session = null;
    this.setTelemetryEnabled(false);
    this.setState({
      consent: { version: TELEMETRY_CONSENT_VERSION, granted: false, granted_at: new Date().toISOString() },
      recovery_code: null,
      error: null,
    });
  }

  /** 创建/返回匿名身份（幂等：已有身份直接返回）。恢复码只在创建时返回一次。 */
  async provision(displayName?: string): Promise<PlayerIdentity | null> {
    if (this.state.identity) return this.state.identity;
    try {
      const result = await this.backend.provision(displayName ?? this.defaultDisplayName());
      const identity: PlayerIdentity = {
        player_id: result.player_id,
        public_player_id: result.public_player_id,
        public_code: result.public_code,
        display_name: result.display_name,
        leaderboard_eligible: result.leaderboard_eligible,
      };
      writeIdentity(this.storage, identity);
      writeSessionRecoveryCode(result.recovery_code);
      this.setState({ identity, recovery_code: result.recovery_code, error: null });
      void this.queue.flush();
      return identity;
    } catch (e) {
      console.warn('[telemetry] provision 失败', e);
      this.setState({ error: '身份创建失败，请稍后重试' });
      return null;
    }
  }

  /** 用恢复码在另一台设备上找回身份。 */
  async recoverIdentity(recoveryCode: string): Promise<PlayerIdentity | null> {
    if (!this.state.consent?.granted) return null;
    try {
      const identity = await this.backend.recoverIdentity(recoveryCode.trim());
      writeIdentity(this.storage, identity);
      writeSessionRecoveryCode(null);
      this.setState({ identity, recovery_code: null, error: null });
      void this.queue.flush();
      return identity;
    } catch (e) {
      console.warn('[telemetry] recover 失败', e);
      this.setState({ error: '恢复码无效或已被使用' });
      return null;
    }
  }

  /** 更新显示昵称（客户端校验 + 服务端持久化；数据库限 1-12 字符）。 */
  async updateDisplayName(name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!this.state.identity) return false;
    if (trimmed.length < 1 || trimmed.length > 12) {
      this.setState({ error: '昵称需为 1-12 个字符' });
      return false;
    }
    try {
      await this.backend.updateDisplayName(this.state.identity.player_id, trimmed);
      const next = { ...this.state.identity, display_name: trimmed };
      next.leaderboard_eligible = true;
      writeIdentity(this.storage, next);
      this.setState({ identity: next, error: null });
      return true;
    } catch (e) {
      console.warn('[telemetry] updateDisplayName 失败', e);
      this.setState({ error: '昵称更新失败，请稍后重试' });
      return false;
    }
  }

  // ── 会话生命周期 ──────────────────────────────────────────

  /** 开始一次游戏会话（仅同意后生效；返回是否启用）。 */
  startSession(meta: ActiveSessionMeta): boolean {
    if (!this.state.consent?.granted || !this.state.identity || !this.state.telemetryEnabled) return false;
    const session_id = newUuid();
    this.session = { session_id, started_at: new Date().toISOString(), ended: false, meta };
    this.sessionProgress = { rounds: 0, final_score: 0, margin_call_count: 0 };
    this.track('session_start', {
      session_id,
      rules_version: meta.rules_version,
      game_mode: meta.game_mode,
      volatility_enabled: meta.volatility_enabled,
      app_version: this.appVersion,
      consent_version: this.state.consent.version,
      platform: 'web',
    });
    void this.upsertSessionNow(this.session).catch(() => {});
    return true;
  }

  /** 游戏过程中持续刷新当前进度（页面关闭/放弃时带走真实数值）。 */
  updateSessionProgress(progress: SessionProgress): void {
    if (!this.session || this.session.ended) return;
    this.sessionProgress = { ...progress };
  }

  /** 结束会话：正常结束上报 session_end；放弃/页面离开上报 session_abandon。 */
  endSession(result: SessionEndResult): void {
    const session = this.session;
    if (!session || session.ended) return;
    session.ended = true;
    const progress = {
      rounds: result.rounds,
      final_score: result.final_score,
      margin_call_count: result.margin_call_count,
    };
    this.sessionProgress = { ...progress };
    const abandoned = result.reason !== 'game_over';
    this.track(abandoned ? 'session_abandon' : 'session_end', {
      session_id: session.session_id,
      final_score: result.final_score,
      rounds: result.rounds,
      abandoned,
      margin_call_count: result.margin_call_count,
      reason: result.reason,
    });
    void this.finalizeSession(session, result, abandoned).catch(() => {});
    this.session = null;
  }

  /** 页面离开/放弃当前会话（best-effort，最终由队列重试保证送达）。 */
  abandonSession(reason: 'pagehide' | 'reset'): void {
    this.endSession({
      reason,
      ...this.sessionProgress,
    });
    void this.queue.flush();
  }

  // ── 事件上报 ──────────────────────────────────────────────

  /** 入队一条白名单遥测事件；未启用/非法载荷时返回 false（不影响调用方）。 */
  track(type: TelemetryEventType, payload: Record<string, unknown>): boolean {
    if (!this.state.identity) return false;
    return this.queue.track({ type, payload });
  }

  /** 立即尝试上传队列（供关键节点主动触发；失败静默保留重试）。 */
  async flush(): Promise<void> {
    await this.queue.flush();
  }

  /** 读取云端排行榜（公开安全字段；娱乐榜，未认证）。 */
  async fetchLeaderboard(limit = 50, rulesVersion?: string): Promise<CloudLeaderboardEntry[]> {
    try {
      return await this.backend.fetchLeaderboard(limit, rulesVersion);
    } catch (e) {
      console.warn('[telemetry] fetchLeaderboard 失败', e);
      return [];
    }
  }

  /** 队列内积压事件数（诊断用）。 */
  pendingCount(): number {
    return this.queue.pendingCount();
  }

  private defaultDisplayName(): string {
    return '';
  }

  private async upsertSessionNow(
    session: { session_id: string; started_at: string; meta: ActiveSessionMeta },
    end?: { ended: boolean; abandoned: boolean; rounds: number; final_score: number },
  ): Promise<void> {
    const playerId = this.state.identity?.player_id;
    if (!playerId) return;
    const status = !end?.ended ? 'started' : end.abandoned ? 'abandoned' : 'completed';
    await this.backend.upsertSession(playerId, {
      session_id: session.session_id,
      status,
      rounds_completed: end?.rounds ?? this.sessionProgress.rounds,
      // 汇总字段保持数据库的非负约束；负分原值由 session_end 与
      // round_settled 事件载荷保留，供后续策略分析使用。
      final_score: Math.max(0, end?.final_score ?? this.sessionProgress.final_score),
      rules_version: session.meta.rules_version,
      game_mode: session.meta.game_mode,
      app_version: this.appVersion,
      consent_version: String(this.state.consent?.version ?? 0),
      ended_at: end?.ended ? new Date().toISOString() : null,
    });
  }

  private async finalizeSession(
    session: { session_id: string; started_at: string; meta: ActiveSessionMeta },
    result: SessionEndResult,
    abandoned: boolean,
  ): Promise<void> {
    await this.upsertSessionNow(session, {
      ended: true,
      abandoned,
      rounds: result.rounds,
      final_score: result.final_score,
    });
    if (!abandoned && this.state.identity) {
      await this.submitLeaderboard(session, result.final_score);
    }
  }

  private async submitLeaderboard(
    session: { session_id: string; meta: ActiveSessionMeta },
    score: number,
  ): Promise<void> {
    const identity = this.state.identity;
    if (!identity || !identity.leaderboard_eligible || !identity.display_name.trim() || !session?.session_id) return;
    await this.backend.submitLeaderboard(identity.player_id, {
      public_player_id: identity.public_player_id,
      score: Math.round(score * 10) / 10,
      rules_version: session.meta.rules_version,
      session_id: session.session_id,
    });
  }

  private bindPagehide(): void {
    if (this.pagehideBound) return;
    this.pagehideBound = true;
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', () => {
        if (this.session && !this.session.ended) {
          this.abandonSession('pagehide');
        }
      });
    }
  }
}
