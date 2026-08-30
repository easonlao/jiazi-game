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

import { CURRENT_RULES_VERSION, type ReplayAction, type StorageProvider } from '@core/index';
import {
  TELEMETRY_CONSENT_VERSION,
  TelemetryQueue,
  newUuid,
  type TelemetryEventType,
  type TelemetryTransport,
} from '@core/telemetry';
import {
  type AnalyticsBackend,
  type CultivationLedgerSnapshot,
  type CloudLeaderboardEntry,
  type PlayerIdentity,
  type VerifiedSessionStart,
  type VerifiedSessionStartResult,
  type CloudActiveGameSession,
  mapFunctionErrorToCloudStartError,
} from './analyticsBackend';
import {
  VerificationStateController,
  type VerificationRecord,
} from './verificationState';
import {
  readPendingTerminations,
  writePendingTermination,
  removePendingTermination,
  type PendingTerminationRecord,
} from './pendingTerminationStorage';

const CONSENT_KEY = 'jiazi_consent';
const IDENTITY_KEY = 'jiazi_player_identity';
const RECOVERY_SESSION_KEY = 'jiazi_recovery_code_session';
const ACTIVE_SESSION_STORAGE_KEY = 'jiazi_active_verified_session';
export const PENDING_CORRUPTED_RECOVERY_STORAGE_KEY = 'jiazi_pending_corrupted_recovery';

export interface PendingCorruptedRecoveryRecord {
  sessionId: string;
  playerId?: string;
  source: 'local_save' | 'cloud_session';
  createdAt: string;
}

export function readAllPendingCorruptedRecoveries(storage: StorageProvider): Record<string, PendingCorruptedRecoveryRecord> {
  const raw = storage.getItem(PENDING_CORRUPTED_RECOVERY_STORAGE_KEY);
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return {};
    if (typeof data.sessionId === 'string') {
      const key = data.playerId ?? '__default__';
      return { [key]: data };
    }
    return data as Record<string, PendingCorruptedRecoveryRecord>;
  } catch {
    return {};
  }
}

export function writePendingCorruptedRecovery(storage: StorageProvider, payload: PendingCorruptedRecoveryRecord | null): void {
  if (!payload) {
    storage.removeItem(PENDING_CORRUPTED_RECOVERY_STORAGE_KEY);
    return;
  }
  const all = readAllPendingCorruptedRecoveries(storage);
  const key = payload.playerId ?? '__default__';
  all[key] = payload;
  storage.setItem(PENDING_CORRUPTED_RECOVERY_STORAGE_KEY, JSON.stringify(all));
}

export function clearPendingCorruptedRecovery(storage: StorageProvider, playerId?: string | null): void {
  const all = readAllPendingCorruptedRecoveries(storage);
  const key = playerId ?? '__default__';
  delete all[key];
  if (Object.keys(all).length === 0) {
    storage.removeItem(PENDING_CORRUPTED_RECOVERY_STORAGE_KEY);
  } else {
    storage.setItem(PENDING_CORRUPTED_RECOVERY_STORAGE_KEY, JSON.stringify(all));
  }
}

export function readPendingCorruptedRecovery(storage: StorageProvider, currentPlayerId?: string | null): PendingCorruptedRecoveryRecord | null {
  const all = readAllPendingCorruptedRecoveries(storage);
  if (currentPlayerId) {
    return all[currentPlayerId] ?? null;
  }
  return all['__default__'] ?? null;
}

/** 与 package.json 版本保持一致（发版时同步修改） */
export const APP_VERSION = '0.2.0';

export function isSameAction(a: ReplayAction, b: ReplayAction): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'buy' && b.type === 'buy') {
    return a.cardIndex === b.cardIndex && Boolean(a.leverage) === Boolean(b.leverage);
  }
  if (a.type === 'sell' && b.type === 'sell') {
    return a.slotIndex === b.slotIndex;
  }
  if (a.type === 'lock' && b.type === 'lock') {
    return a.cardIndex === b.cardIndex;
  }
  if (a.type === 'unlock' && b.type === 'unlock') {
    return a.cardIndex === b.cardIndex;
  }
  if (a.type === 'wait' && b.type === 'wait') {
    return true;
  }
  return false;
}

export type ActionChainMergeResult =
  | { type: 'match'; actions: ReplayAction[]; source: 'local' | 'cloud' | 'identical' }
  | { type: 'conflict'; divergedAt: number; localAction: ReplayAction; cloudAction: ReplayAction };

export function mergeActionChains(
  localActions: readonly ReplayAction[],
  cloudActions: readonly ReplayAction[],
): ActionChainMergeResult {
  const minLen = Math.min(localActions.length, cloudActions.length);
  for (let i = 0; i < minLen; i++) {
    if (!isSameAction(localActions[i], cloudActions[i])) {
      return {
        type: 'conflict',
        divergedAt: i,
        localAction: localActions[i],
        cloudAction: cloudActions[i],
      };
    }
  }

  // 共同前缀完全一致：安全超集
  if (localActions.length > cloudActions.length) {
    return { type: 'match', actions: [...localActions], source: 'local' };
  } else if (cloudActions.length > localActions.length) {
    return { type: 'match', actions: [...cloudActions], source: 'cloud' };
  } else {
    return { type: 'match', actions: [...localActions], source: 'identical' };
  }
}

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
  reason: 'game_over' | 'voluntary_termination' | 'new_game_override' | 'reset' | 'pagehide' | 'corrupted_recovery';
}

export interface PersistedVerifiedSession {
  session_id: string;
  client_session_id?: string;
  started_at: string;
  meta: ActiveSessionMeta;
  verified: VerifiedSessionStart | null;
  replayActions: ReplayAction[];
  playerId: string;
  progress: SessionProgress;
  sessionRevision?: number;
  lastEventSequence?: number;
}

function readActiveSession(storage: StorageProvider): PersistedVerifiedSession | null {
  const p = readJson<PersistedVerifiedSession>(storage, ACTIVE_SESSION_STORAGE_KEY);
  if (!p || typeof p.session_id !== 'string' || !Array.isArray(p.replayActions)) return null;
  return p;
}

function writeActiveSession(storage: StorageProvider, session: PersistedVerifiedSession | null): void {
  try {
    if (!session) {
      storage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    } else {
      storage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(session));
    }
  } catch (e) {
    console.warn('[telemetry] 写入活跃会话快照失败:', e);
  }
}

export interface TerminationConflict {
  sessionId: string;
  kind: 'voluntary_termination' | 'corrupted_recovery';
  localTermination: PendingTerminationRecord;
  cloudSession: CloudActiveGameSession;
}

export interface TelemetryControllerState {
  consent: ConsentState | null;
  identity: PlayerIdentity | null;
  /** 一次性恢复码（内存级，不持久化） */
  recovery_code: string | null;
  telemetryEnabled: boolean;
  busy: boolean;
  error: string | null;
  cultivationLedger: CultivationLedgerSnapshot | null;
  cultivationLedgerBusy: boolean;
  cultivationLedgerError: string | null;
  activeCloudSession: CloudActiveGameSession | null;
  activeCloudSessionBusy: boolean;
  terminationConflict: TerminationConflict | null;
}

export interface TelemetryControllerDeps {
  storage: StorageProvider;
  backend: AnalyticsBackend;
  appVersion?: string;
  now?: () => number;
  onStateChange?: (state: TelemetryControllerState) => void;
  /** 云端成绩校验状态变化回调（记录已按 session_id 隔离，含固定 player_id）。 */
  onVerificationChange?: (record: VerificationRecord) => void;
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
  onUploaded?: (results: Array<{ session_id: string; session_revision: number; inserted_count: number }>) => void,
): TelemetryTransport {
  return {
    async upload(batch) {
      const playerId = getPlayerId();
      if (!playerId) throw new Error('identity-not-ready');
      const results = await backend.uploadEvents(playerId, batch);
      if (Array.isArray(results) && results.length > 0) {
        onUploaded?.(results);
      }
    },
  };
}

export class TelemetryController {
  private readonly storage: StorageProvider;
  private readonly backend: AnalyticsBackend;
  private readonly appVersion: string;
  private readonly queue: TelemetryQueue;
  private readonly onStateChange?: (state: TelemetryControllerState) => void;
  private readonly onVerificationChange?: (record: VerificationRecord) => void;

  /** 云端成绩校验状态层（pending/verified/rejected/failed，按 session_id 隔离）。 */
  readonly verification: VerificationStateController;

  private state: TelemetryControllerState;
  private session: {
    session_id: string;
    client_session_id?: string;
    started_at: string;
    ended: boolean;
    meta: ActiveSessionMeta;
    verified: VerifiedSessionStart | null;
    replayActions: ReplayAction[];
    /** 该局开始时的 player_id（固定，身份切换不影响提交归属）。 */
    playerId: string;
    sessionRevision?: number;
    lastEventSequence?: number;
  } | null = null;
  private sessionProgress: SessionProgress = { rounds: 0, final_score: 0, margin_call_count: 0 };
  private pagehideBound = false;

  constructor(deps: TelemetryControllerDeps) {
    this.storage = deps.storage;
    this.backend = deps.backend;
    this.appVersion = deps.appVersion ?? APP_VERSION;
    this.onStateChange = deps.onStateChange;
    this.onVerificationChange = deps.onVerificationChange;
    this.state = {
      consent: readConsent(deps.storage),
      identity: readIdentity(deps.storage),
      recovery_code: readSessionRecoveryCode(),
      telemetryEnabled: false,
      busy: false,
      error: null,
      cultivationLedger: null,
      cultivationLedgerBusy: false,
      cultivationLedgerError: null,
      activeCloudSession: null,
      activeCloudSessionBusy: false,
      terminationConflict: null,
    };
    this.queue = new TelemetryQueue({
      storage: deps.storage,
      transport: createTransport(
        this.backend,
        () => this.state.identity?.player_id ?? null,
        (results) => this.handleEventsUploaded(results),
      ),
      now: deps.now,
    });
    this.verification = new VerificationStateController({ backend: deps.backend, storage: deps.storage });
    this.verification.subscribe((record) => this.onVerificationChange?.(record));

    // 页面刷新恢复：若本地存在该玩家尚未结束的活跃会话快照，自动复原内存会话与已记录的动作链
    const savedSession = readActiveSession(deps.storage);
    if (savedSession && savedSession.playerId === this.state.identity?.player_id) {
      this.session = {
        session_id: savedSession.session_id,
        client_session_id: savedSession.client_session_id,
        started_at: savedSession.started_at,
        ended: false,
        meta: savedSession.meta,
        verified: savedSession.verified,
        replayActions: [...savedSession.replayActions],
        playerId: savedSession.playerId,
        sessionRevision: savedSession.sessionRevision ?? 0,
        lastEventSequence: savedSession.lastEventSequence,
      };
      this.sessionProgress = { ...savedSession.progress };
    }
  }

  /** 服务端事件入库确认回调：更新活跃会话 revision，并为待同步记录累加本端已确认上传的事件数（不直接替换基础因果 revision）。 */
  private handleEventsUploaded(results: Array<{ session_id: string; session_revision: number; inserted_count: number }>): void {
    const identity = this.state.identity;
    for (const res of results) {
      if (this.session && this.session.session_id === res.session_id) {
        this.session.sessionRevision = Math.max(this.session.sessionRevision ?? 0, res.session_revision);
        this.persistCurrentSession();
      }
      if (identity && res.inserted_count > 0) {
        const pendingList = readPendingTerminations(this.storage, identity.player_id);
        const match = pendingList.find((p) => p.sessionId === res.session_id);
        if (match) {
          match.localEventsUploaded = (match.localEventsUploaded ?? 0) + res.inserted_count;
          writePendingTermination(this.storage, match);
        }
      }
    }
  }

  getState(): TelemetryControllerState {
    return { ...this.state };
  }

  /** 当前活跃会话 id；无会话时返回 null。 */
  getActiveSessionId(): string | null {
    return this.session?.session_id ?? null;
  }

  /** 在当前版本游戏真正开始前向服务端申请 seed；返回结构化结果或失败诊断。 */
  async prepareVerifiedSession(meta: ActiveSessionMeta): Promise<VerifiedSessionStartResult> {
    if (this.backend.isConfigured === false) {
      return {
        success: false,
        error: {
          code: 'cloud_not_configured',
          message: 'Cloud backend not configured',
          userMessage: '云端服务未配置（未检测到 Supabase 凭据）',
          statusCode: null,
        },
      };
    }

    const requestedRulesVersion = Number(meta.rules_version);
    if (!this.state.consent?.granted || !this.state.telemetryEnabled) {
      return {
        success: false,
        error: {
          code: 'telemetry_disabled',
          message: 'Telemetry not enabled or consent not granted',
          userMessage: '未开启遥测或未同意立档协议',
          statusCode: null,
        },
      };
    }

    const identity = this.state.identity;
    if (!identity) {
      return {
        success: false,
        error: {
          code: 'identity_not_ready',
          message: 'Player identity is not initialized',
          userMessage: '修士身份尚未在云端立档（请先在修行档案中生成玩家 ID）',
          statusCode: 403,
        },
      };
    }

    if (requestedRulesVersion !== CURRENT_RULES_VERSION || meta.game_mode !== 'volatility_trade') {
      return {
        success: false,
        error: {
          code: 'rules_version_mismatch',
          message: `Requested rules version ${requestedRulesVersion} does not match current ${CURRENT_RULES_VERSION}`,
          userMessage: '当前对局模式或规则版本不支持云端开局',
          statusCode: 409,
        },
      };
    }

    try {
      return await this.backend.startVerifiedSession(identity.player_id, {
        session_id: newUuid(),
        started_at: new Date().toISOString(),
        status: 'started',
        rounds_completed: 0,
        final_score: 0,
        rules_version: meta.rules_version,
        game_mode: meta.game_mode,
        app_version: this.appVersion,
        consent_version: String(this.state.consent.version),
      });
    } catch (e: any) {
      console.warn('[telemetry] verified session 准备失败，交由玩家决定是否本地开局', e);
      return {
        success: false,
        error: mapFunctionErrorToCloudStartError(e),
      };
    }
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
      if (ok && this.state.identity) {
        await this.syncPendingTerminations();
        await this.verification.resumePending();
        await Promise.all([this.refreshCultivationLedger(), this.refreshActiveSession()]);
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
      await this.syncPendingTerminations();
      await this.verification.resumePending();
      await Promise.all([this.refreshCultivationLedger(), this.refreshActiveSession()]);
    } else {
      this.setState({ error: '云端服务暂不可用，可稍后重试' });
    }
    this.setState({ busy: false });
  }

  /** 玩家拒绝遥测：持久化拒绝并彻底关闭遥测。 */
  declineConsent(): void {
    writeConsent(this.storage, false);
    this.session = null;
    this.verification.clear();
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
      await this.syncPendingTerminations();
      await Promise.all([this.refreshCultivationLedger(), this.refreshActiveSession()]);
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
      await this.syncPendingTerminations();
      await Promise.all([this.refreshCultivationLedger(), this.refreshActiveSession()]);
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
      // 采用服务端确认后返回的身份（含 DB 触发器重算的 leaderboard_eligible），
      // 不乐观宣称有资格——update 未命中或 RLS 拒绝时后端必须抛错。
      const identity = await this.backend.updateDisplayName(this.state.identity.player_id, trimmed);
      writeIdentity(this.storage, identity);
      this.setState({ identity, error: null });
      await Promise.all([this.refreshCultivationLedger(), this.refreshActiveSession()]);
      return true;
    } catch (e) {
      console.warn('[telemetry] updateDisplayName 失败', e);
      this.setState({ error: '昵称更新失败，请稍后重试' });
      return false;
    }
  }

  // ── 会话生命周期 ──────────────────────────────────────────

  /** 开始一次游戏会话（仅同意后生效；返回是否启用）。只接收验证成功的 VerifiedSessionStart。 */
  startSession(
    meta: ActiveSessionMeta,
    verified: VerifiedSessionStart | null = null,
  ): boolean {

    // 活动交易局只允许当前规则版本，并且必须绑定服务端 seed 会话。
    // 旧版本只保留存档/历史重放兼容，不再创建新的云端会话或事件。
    if (meta.game_mode === 'volatility_trade') {
      if (
        Number(meta.rules_version) !== CURRENT_RULES_VERSION ||
        !verified ||
        verified.rules_snapshot?.rulesVersion !== CURRENT_RULES_VERSION
      ) {
        return false;
      }
    }
    if (!this.state.consent?.granted || !this.state.identity || !this.state.telemetryEnabled) return false;
    const session_id = verified?.session_id ?? newUuid();
    const client_session_id = verified ? ((meta as { client_session_id?: string }).client_session_id ?? (verified as { client_session_id?: string }).client_session_id ?? session_id) : session_id;
    const started_at = verified?.started_at ?? new Date().toISOString();
    this.session = {
      session_id,
      client_session_id,
      started_at,
      ended: false,
      meta,
      verified,
      replayActions: [],
      // 固定该局开始时的 player_id：身份切换后旧局提交仍归属原始身份。
      playerId: this.state.identity.player_id,
      sessionRevision: verified ? ((verified as { session_revision?: number }).session_revision ?? 0) : 0,
    };
    this.sessionProgress = { rounds: 0, final_score: 0, margin_call_count: 0 };
    this.persistCurrentSession();

    this.track('session_start', {
      session_id,
      rules_version: meta.rules_version,
      game_mode: meta.game_mode,
      volatility_enabled: meta.volatility_enabled,
      app_version: this.appVersion,
      consent_version: this.state.consent.version,
      platform: 'web',
    });
    if (!verified && this.session) {
      void this.upsertSessionNow(this.session).catch((e) => {
        console.warn('[telemetry] game_sessions 会话创建 upsert 失败（结束时仍会再次尝试）', e);
      });
    }
    return true;
  }

  /** 统一持久化当前活跃会话状态，保证所有写回路径字段完整且不丢失 sessionRevision。 */
  private persistCurrentSession(): void {
    if (!this.session || this.session.ended) {
      writeActiveSession(this.storage, null);
      return;
    }
    if (this.session.verified) {
      writeActiveSession(this.storage, {
        session_id: this.session.session_id,
        client_session_id: this.session.client_session_id,
        started_at: this.session.started_at,
        meta: this.session.meta,
        verified: this.session.verified,
        replayActions: [...this.session.replayActions],
        playerId: this.session.playerId,
        progress: { ...this.sessionProgress },
        sessionRevision: this.session.sessionRevision ?? 0,
        lastEventSequence: this.session.lastEventSequence,
      });
    }
  }

  /** 跨设备恢复或续局时重新绑定已有会话并接续动作链。 */
  resumeVerifiedSession(
    meta: ActiveSessionMeta,
    verified: VerifiedSessionStart & { client_session_id?: string; session_revision?: number },
    actions: readonly ReplayAction[],
    progress: SessionProgress,
  ): boolean {
    if (!this.state.consent?.granted || !this.state.identity || !this.state.telemetryEnabled) return false;

    // 获取本地已有动作链（内存中或持久化存储中）
    const persisted = readActiveSession(this.storage);
    const existingLocalActions = (this.session && this.session.session_id === verified.session_id)
      ? this.session.replayActions
      : (persisted && persisted.session_id === verified.session_id)
      ? persisted.replayActions
      : null;

    let effectiveActions = [...actions];
    if (existingLocalActions && existingLocalActions.length > 0) {
      const merge = mergeActionChains(existingLocalActions, actions);
      if (merge.type === 'conflict') {
        console.warn(`[telemetry] 双设备动作链冲突于第 ${merge.divergedAt + 1} 步: 本地动作 vs 云端动作不一致`);
        // 关键冲突处理：阻止分叉继续并提示冲突
        this.setState({
          error: '检测到其他设备操作冲突，请重新载入最新对局',
        });
        return false;
      }
      effectiveActions = merge.actions;
    }

    const revision = typeof verified.session_revision === 'number'
      ? verified.session_revision
      : (persisted?.sessionRevision ?? 0);

    this.session = {
      session_id: verified.session_id,
      client_session_id: verified.client_session_id ?? verified.session_id,
      started_at: verified.started_at,
      ended: false,
      meta,
      verified,
      replayActions: effectiveActions,
      playerId: this.state.identity.player_id,
      sessionRevision: revision,
    };
    this.sessionProgress = { ...progress };
    this.persistCurrentSession();
    return true;
  }

  /** 记录已被核心引擎接受的动作；服务端只重放这些动作，不读取客户端最终分数。 */
  recordReplayAction(action: ReplayAction): void {
    if (!this.session || this.session.ended || !this.session.verified) return;
    this.session.replayActions.push(action);
    this.persistCurrentSession();
  }

  /** 执行动作失败时撤销预先登记的动作。 */
  removeLastReplayAction(): void {
    if (!this.session || this.session.ended || !this.session.verified) return;
    this.session.replayActions.pop();
    this.persistCurrentSession();
  }

  /** 游戏过程中持续刷新当前进度（页面关闭/放弃时带走真实数值）。 */
  updateSessionProgress(progress: SessionProgress): void {
    if (!this.session || this.session.ended) return;
    this.sessionProgress = { ...progress };
    this.persistCurrentSession();
  }

  /** 结束会话：正常结束/技术重置上报 session_end（附带 reason）；主动放弃上报 session_abandon。 */
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
    const isCorruptedRecovery = result.reason === 'corrupted_recovery';
    const abandoned = !isCorruptedRecovery && result.reason !== 'game_over';
    this.track(abandoned ? 'session_abandon' : 'session_end', {
      session_id: session.session_id,
      final_score: result.final_score,
      rounds: result.rounds,
      abandoned,
      margin_call_count: result.margin_call_count,
      reason: result.reason,
    });
    void this.finalizeSession(session, result, abandoned, isCorruptedRecovery ? 'corrupted_recovery' : undefined).catch(() => {});
    this.session = null;
    this.persistCurrentSession();
  }

  /** 放弃当前会话（主动终止、开新局覆盖等；由队列与待同步记录保证送达）。 */
  abandonSession(reason: 'voluntary_termination' | 'new_game_override' | 'reset' | 'pagehide' = 'voluntary_termination'): void {
    const identity = this.state.identity;
    const sessId = this.session?.session_id ?? this.state.activeCloudSession?.session_id;
    const clientSessId = this.session?.client_session_id ?? this.state.activeCloudSession?.client_session_id ?? sessId;

    const hasLocalActiveSession = Boolean(this.session && !this.session.ended);
    const rounds = hasLocalActiveSession
      ? (this.sessionProgress.rounds ?? 0)
      : (this.state.activeCloudSession?.rounds_completed ?? 0);
    const finalScore = hasLocalActiveSession
      ? (this.sessionProgress.final_score ?? 0)
      : (this.state.activeCloudSession?.final_score ?? 0);
    const clientActionCount = hasLocalActiveSession
      ? (this.session?.replayActions.length ?? 0)
      : (this.state.activeCloudSession?.actions?.length ?? 0);
    const expectedSessionRevision = hasLocalActiveSession
      ? (this.session?.sessionRevision ?? 0)
      : (this.state.activeCloudSession?.session_revision ?? this.state.activeCloudSession?.last_event_sequence ?? this.state.activeCloudSession?.actions?.length ?? 0);

    // 1. 已立档玩家且有关联云端会话时，先将 session_abandon 事件入队
    const session = this.session;
    if (session && !session.ended) {
      session.ended = true;
      this.track('session_abandon', {
        session_id: session.session_id,
        final_score: finalScore,
        rounds,
        abandoned: true,
        margin_call_count: this.sessionProgress.margin_call_count,
        reason,
      });
    }

    // 2. 写入终止待同步意图（防断网丢失，使用最后已确认的服务端 revision）
    if (identity && sessId) {
      writePendingTermination(this.storage, {
        sessionId: sessId,
        playerId: identity.player_id,
        clientSessionId: clientSessId,
        reason,
        roundsCompleted: rounds,
        finalScore,
        occurredAt: new Date().toISOString(),
        status: 'pending',
        clientActionCount,
        kind: 'voluntary_termination',
        expectedSessionRevision,
        expectedLastEventSequence: expectedSessionRevision,
      });
    }

    // 3. 清除活跃会话
    this.session = null;
    this.setState({ activeCloudSession: null });
    this.persistCurrentSession();

    // 4. 串行执行：先上传队列已积压事件，再同步终止记录至云端
    void this.flushAndSyncTerminations();
  }

  private async flushAndSyncTerminations(): Promise<void> {
    try {
      await this.queue.flush();
    } catch (e) {
      console.warn('[telemetry] queue.flush 失败 (可能离线):', e);
    }
    await this.syncPendingTerminations();
  }

  /** 同步暂存的离线主动终止记录至云端。识别并挂起跨设备较新行动冲突。 */
  async syncPendingTerminations(): Promise<void> {
    const identity = this.state.identity;
    if (!identity || !this.state.telemetryEnabled || !this.state.consent?.granted) return;
    const list = readPendingTerminations(this.storage, identity.player_id);
    if (list.length === 0) return;

    let syncedAny = false;
    for (const record of list) {
      try {
        const activeCloud = await this.backend.fetchActiveGameSession(identity.player_id);
        const baseRevision = record.expectedSessionRevision ?? record.expectedLastEventSequence ?? 0;
        const uploadedByMe = record.localEventsUploaded ?? 0;
        const maxAllowedRevision = baseRevision + uploadedByMe;
        if (activeCloud && activeCloud.session_id === record.sessionId) {
          const cloudRounds = activeCloud.rounds_completed;
          const cloudActionsCount = activeCloud.actions?.length ?? 0;
          const localActionsCount = record.clientActionCount ?? 0;
          const cloudRevision = activeCloud.session_revision ?? 0;

          if (cloudRevision > maxAllowedRevision || cloudRounds > record.roundsCompleted || cloudActionsCount > localActionsCount) {
            // 发现跨设备终止冲突：云端已有更新 revision、轮次或动作，阻止静默覆盖并提示玩家选择
            console.warn(`[telemetry] 检测到跨设备终止冲突 [session: ${record.sessionId}]: 云端 revision=${cloudRevision}, round=${cloudRounds}, actions=${cloudActionsCount} > 允许最大 revision=${maxAllowedRevision}(base=${baseRevision}+uploaded=${uploadedByMe}), round=${record.roundsCompleted}, actions=${localActionsCount}`);
            this.setState({
              terminationConflict: {
                sessionId: record.sessionId,
                kind: record.kind ?? 'voluntary_termination',
                localTermination: record,
                cloudSession: activeCloud,
              },
            });
            continue;
          }
        }

        await this.backend.upsertSession(identity.player_id, {
          session_id: record.sessionId,
          client_session_id: record.clientSessionId,
          started_at: record.occurredAt,
          status: 'abandoned',
          rounds_completed: record.roundsCompleted,
          final_score: record.finalScore,
          rules_version: String(CURRENT_RULES_VERSION),
          game_mode: 'volatility_trade',
          app_version: this.appVersion,
          consent_version: String(this.state.consent?.version ?? 1),
          ended_at: record.occurredAt,
          expected_session_revision: maxAllowedRevision,
        });
        removePendingTermination(this.storage, identity.player_id, record.sessionId);
        syncedAny = true;
      } catch (e: any) {
        if (e?.isConflict || e?.message?.includes('conflict')) {
          console.warn(`[telemetry] syncPendingTerminations 服务端并发冲突 [session: ${record.sessionId}]`, e);
          const latestCloud = await this.backend.fetchActiveGameSession(identity.player_id);
          if (latestCloud) {
            this.setState({
              terminationConflict: {
                sessionId: record.sessionId,
                kind: record.kind ?? 'voluntary_termination',
                localTermination: record,
                cloudSession: latestCloud,
              },
            });
          }
        } else {
          console.warn(`[telemetry] syncPendingTerminations 失败 [session: ${record.sessionId}]`, e);
        }
      }
    }

    if (syncedAny) {
      await this.refreshCultivationLedger();
    }
  }

  /**
   * 解决跨设备终止/受损冲突：
   * - resume_cloud: 撤销本机离线意图，保留并恢复云端最新对局
   * - terminate_latest: 确认终止该局最新状态，按云端最新回合与分数落库 abandoned
   * - reset_corrupted: 确认免惩罚技术重置，走服务端重放验证后写入 corrupted_recovery（绝不转为 abandoned）
   */
  async resolveTerminationConflict(
    sessionId: string,
    choice: 'resume_cloud' | 'terminate_latest' | 'reset_corrupted',
  ): Promise<boolean> {
    const identity = this.state.identity;
    const conflict = this.state.terminationConflict;
    if (!identity || !conflict || conflict.sessionId !== sessionId) return false;

    if (choice === 'resume_cloud') {
      removePendingTermination(this.storage, identity.player_id, sessionId);
      this.setState({
        terminationConflict: null,
        activeCloudSession: conflict.cloudSession,
      });
      return true;
    }

    if (choice === 'reset_corrupted') {
      const expectedRevision = conflict.cloudSession.session_revision ?? conflict.cloudSession.last_event_sequence ?? conflict.cloudSession.actions?.length ?? 0;
      const res = await this.backend.recoverCorruptedSession(sessionId, expectedRevision);
      if (res.success) {
        removePendingTermination(this.storage, identity.player_id, sessionId);
        this.setState({
          terminationConflict: null,
          activeCloudSession: null,
        });
        await this.refreshCultivationLedger();
        return true;
      } else {
        if (res.isConflict) {
          const latestCloud = await this.backend.fetchActiveGameSession(identity.player_id);
          if (latestCloud) {
            this.setState({
              terminationConflict: {
                ...conflict,
                cloudSession: latestCloud,
              },
            });
          }
        }
        console.warn('[telemetry] resolveTerminationConflict reset_corrupted 服务端验证失败', res.error);
        return false;
      }
    }

    if (choice === 'terminate_latest') {
      try {
        await this.backend.upsertSession(identity.player_id, {
          session_id: sessionId,
          client_session_id: conflict.cloudSession.client_session_id ?? sessionId,
          started_at: conflict.cloudSession.started_at,
          status: 'abandoned',
          rounds_completed: conflict.cloudSession.rounds_completed,
          final_score: conflict.cloudSession.final_score,
          rules_version: String(conflict.cloudSession.rules_snapshot?.rulesVersion ?? CURRENT_RULES_VERSION),
          game_mode: 'volatility_trade',
          app_version: this.appVersion,
          consent_version: String(this.state.consent?.version ?? 1),
          ended_at: new Date().toISOString(),
          expected_session_revision: conflict.cloudSession.session_revision ?? conflict.cloudSession.last_event_sequence ?? conflict.cloudSession.actions?.length ?? 0,
        });
        removePendingTermination(this.storage, identity.player_id, sessionId);
        this.setState({
          terminationConflict: null,
          activeCloudSession: null,
        });
        await this.refreshCultivationLedger();
        return true;
      } catch (e: any) {
        if (e?.isConflict || e?.message?.includes('conflict')) {
          const latestCloud = await this.backend.fetchActiveGameSession(identity.player_id);
          if (latestCloud) {
            this.setState({
              terminationConflict: {
                ...conflict,
                cloudSession: latestCloud,
              },
            });
          }
        }
        console.warn('[telemetry] resolveTerminationConflict terminate_latest 失败', e);
        return false;
      }
    }

    return false;
  }

  /** 免惩罚技术放弃当前受损会话（经服务端重放验证后写入 corrupted_recovery，不写入 abandoned，不计入坚持度未完成惩罚）。返回是否成功确认落库。 */
  async discardSessionWithoutPenalty(
    reason: 'corrupted_recovery' = 'corrupted_recovery',
    targetSessionId?: string,
  ): Promise<boolean> {
    const sessId = targetSessionId ?? this.session?.session_id ?? this.state.activeCloudSession?.session_id;
    const identity = this.state.identity;

    // 若本地纯离线试玩且无任何在线会话关联，视为成功
    if (!sessId && !this.session) {
      return true;
    }

    // 若有关联在线会话但玩家身份未就绪（如离线/未初始化），严禁假装成功
    if (!identity) {
      console.warn('[telemetry] discardSessionWithoutPenalty 失败：玩家身份尚未就绪');
      return false;
    }

    // 跨设备冲突检查：若本地正在进行活跃会话，且云端存在比本地受损上下文更晚的有效对局，识别为冲突并交由玩家决策
    if (this.session) {
      try {
        const activeCloud = await this.backend.fetchActiveGameSession(identity.player_id);
        if (activeCloud && activeCloud.session_id === sessId) {
          const cloudRounds = activeCloud.rounds_completed;
          const cloudActions = activeCloud.actions?.length ?? 0;
          const localRounds = this.sessionProgress.rounds ?? 0;
          const localActions = this.session?.replayActions?.length ?? 0;

          if (cloudRounds > localRounds || cloudActions > localActions) {
            console.warn(`[telemetry] discardSessionWithoutPenalty 检测到跨设备冲突: 云端第 ${cloudRounds} 轮 > 本地受损第 ${localRounds} 轮`);
            this.setState({
              terminationConflict: {
                sessionId: sessId,
                kind: 'corrupted_recovery',
                localTermination: {
                  sessionId: sessId,
                  playerId: identity.player_id,
                  reason: 'corrupted_recovery' as any,
                  roundsCompleted: localRounds,
                  finalScore: this.sessionProgress.final_score ?? 0,
                  occurredAt: new Date().toISOString(),
                  status: 'pending',
                  clientActionCount: localActions,
                  kind: 'corrupted_recovery',
                  expectedSessionRevision: this.session?.sessionRevision ?? this.session?.lastEventSequence ?? localActions,
                  expectedLastEventSequence: this.session?.sessionRevision ?? this.session?.lastEventSequence ?? localActions,
                },
                cloudSession: activeCloud,
              },
            });
            return false;
          }
        }
      } catch (e) {
        // 忽略检查异常，继续执行
      }
    }

    // 服务端受控验证并原子写入 corrupted_recovery
    let ok = false;
    if (sessId) {
      const expectedRevision = this.session?.sessionRevision ?? this.state.activeCloudSession?.session_revision ?? this.session?.lastEventSequence ?? this.state.activeCloudSession?.last_event_sequence ?? 0;
      const res = await this.backend.recoverCorruptedSession(sessId, expectedRevision);
      ok = res.success;
      if (!ok) {
        if (res.isConflict) {
          const latestCloud = await this.backend.fetchActiveGameSession(identity.player_id);
          if (latestCloud) {
            this.setState({
              terminationConflict: {
                sessionId: sessId,
                kind: 'corrupted_recovery',
                localTermination: {
                  sessionId: sessId,
                  playerId: identity.player_id,
                  reason: 'corrupted_recovery' as any,
                  roundsCompleted: this.sessionProgress.rounds ?? 0,
                  finalScore: this.sessionProgress.final_score ?? 0,
                  occurredAt: new Date().toISOString(),
                  status: 'pending',
                  clientActionCount: this.session?.replayActions?.length ?? 0,
                  kind: 'corrupted_recovery',
                  expectedSessionRevision: expectedRevision,
                  expectedLastEventSequence: expectedRevision,
                },
                cloudSession: latestCloud,
              },
            });
          }
        }
        console.warn('[telemetry] discardSessionWithoutPenalty recoverCorruptedSession 失败', res.error);
      }
    }

    if (ok) {
      if (this.session) {
        this.session.ended = true;
        this.track('session_end', {
          session_id: this.session.session_id,
          final_score: this.sessionProgress.final_score ?? 0,
          rounds: this.sessionProgress.rounds ?? 0,
          abandoned: false,
          margin_call_count: this.sessionProgress.margin_call_count ?? 0,
          reason,
        });
        writeActiveSession(this.storage, null);
        this.session = null;
      }
      this.storage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      this.setState({ activeCloudSession: null });
      await this.queue.flush();
      await this.refreshCultivationLedger();
    }
    return ok;
  }

  // ── 事件上报 ──────────────────────────────────────────────

  /** 入队一条白名单遥测事件；未启用/非法载荷时返回 false（不影响调用方）。 */
  track(type: TelemetryEventType, payload: Record<string, unknown>): boolean {
    if (!this.state.identity) return false;
    const event = this.queue.track({ type, payload });
    if (event && this.session && !this.session.ended && payload.session_id === this.session.session_id) {
      this.session.lastEventSequence = event.sequence;
      this.persistCurrentSession();
    }
    return Boolean(event);
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

  async refreshActiveSession(): Promise<CloudActiveGameSession | null> {
    const identity = this.state.identity;
    if (!identity || !this.state.consent?.granted) return null;
    this.setState({ activeCloudSessionBusy: true });
    try {
      const session = await this.backend.fetchActiveGameSession(identity.player_id);
      const pendingTerminations = readPendingTerminations(this.storage, identity.player_id);
      if (session && pendingTerminations.some((p) => p.sessionId === session.session_id)) {
        // 本地已主动终止该局，防止同一设备展示已终止局为可继续
        this.setState({
          activeCloudSession: null,
          activeCloudSessionBusy: false,
        });
        void this.syncPendingTerminations();
        return null;
      }
      this.setState({
        activeCloudSession: session,
        activeCloudSessionBusy: false,
      });
      return session;
    } catch (e) {
      console.warn('[telemetry] fetchActiveGameSession failed', e);
      this.setState({ activeCloudSessionBusy: false });
      return null;
    }
  }

  async refreshCultivationLedger(): Promise<CultivationLedgerSnapshot | null> {
    const identity = this.state.identity;
    if (!identity || !this.state.consent?.granted) return null;
    this.setState({ cultivationLedgerBusy: true, cultivationLedgerError: null });
    try {
      const snapshot = await this.backend.fetchCultivationLedger(identity.player_id);
      this.setState({
        cultivationLedger: snapshot,
        cultivationLedgerBusy: false,
        cultivationLedgerError: null,
      });
      return snapshot;
    } catch (e) {
      console.warn('[telemetry] fetchCultivationLedger 失败', e);
      this.setState({
        cultivationLedgerBusy: false,
        cultivationLedgerError: '云端修行账本暂时不可用',
      });
      return null;
    }
  }

  /** 队列内积压事件数（诊断用）。 */
  pendingCount(): number {
    return this.queue.pendingCount();
  }

  /** 读取某会话的云端校验状态；无记录时返回 null。 */
  getVerification(sessionId: string): VerificationRecord | null {
    return this.verification.get(sessionId);
  }

  /** 对 failed / rejected 的会话重新提交校验；状态不合法时返回 null。 */
  retryVerification(sessionId: string): VerificationRecord | null {
    return this.verification.retry(sessionId);
  }

  private defaultDisplayName(): string {
    return '';
  }

  private async upsertSessionNow(
    session: { session_id: string; client_session_id?: string; started_at: string; meta: ActiveSessionMeta; playerId: string; sessionRevision?: number; lastEventSequence?: number },
    end?: { ended: boolean; abandoned: boolean; status?: 'corrupted_recovery'; rounds: number; final_score: number },
  ): Promise<void> {
    const playerId = session.playerId;
    if (!playerId) return;
    const status = !end?.ended
      ? 'started'
      : end.status === 'corrupted_recovery'
        ? 'corrupted_recovery'
        : end.abandoned
          ? 'abandoned'
          : 'completed';
    const expectedRevision = (status === 'abandoned')
      ? (session.sessionRevision ?? session.lastEventSequence ?? 0)
      : undefined;

    await this.backend.upsertSession(playerId, {
      session_id: session.session_id,
      client_session_id: session.client_session_id,
      // 携带客户端原始 started_at：约束 ended_at >= started_at 依赖同一时钟
      // 来源，避免数据库默认 now() 晚于客户端 ended_at 导致 check 失败。
      started_at: session.started_at,
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
      expected_session_revision: expectedRevision,
    });
  }

  private async finalizeSession(
    session: {
      session_id: string;
      client_session_id?: string;
      started_at: string;
      meta: ActiveSessionMeta;
      verified: VerifiedSessionStart | null;
      replayActions: ReplayAction[];
      playerId: string;
    },
    result: SessionEndResult,
    abandoned: boolean,
    explicitStatus?: 'corrupted_recovery',
  ): Promise<void> {
    if (session.verified && !abandoned && !explicitStatus) {
      // 云端服务端重放校验后台执行：登记为 pending 并异步提交。
      // 记录按 session_id 隔离、playerId 为该局开始时的固定值，不阻塞开始下一局。
      this.verification.submit({
        sessionId: session.session_id,
        playerId: session.playerId,
        actions: session.replayActions,
      });
      return;
    }

    await this.upsertSessionNow(session, {
      ended: true,
      abandoned,
      status: explicitStatus,
      rounds: result.rounds,
      final_score: result.final_score,
    });
  }


  private bindPagehide(): void {
    if (this.pagehideBound) return;
    this.pagehideBound = true;
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => {
        void this.verification.resumePending();
        void this.syncPendingTerminations();
      });
    }
  }
}
