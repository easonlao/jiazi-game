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
import type {
  AnalyticsBackend,
  CultivationLedgerSnapshot,
  CloudLeaderboardEntry,
  PlayerIdentity,
  VerifiedSessionStart,
  CloudActiveGameSession,
} from './analyticsBackend';
import {
  VerificationStateController,
  type VerificationRecord,
} from './verificationState';

const CONSENT_KEY = 'jiazi_consent';
const IDENTITY_KEY = 'jiazi_player_identity';
const RECOVERY_SESSION_KEY = 'jiazi_recovery_code_session';
const ACTIVE_SESSION_STORAGE_KEY = 'jiazi_active_verified_session';

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
  reason: 'game_over' | 'voluntary_termination' | 'new_game_override' | 'reset' | 'pagehide';
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
    };
    this.queue = new TelemetryQueue({
      storage: deps.storage,
      transport: createTransport(this.backend, () => this.state.identity?.player_id ?? null),
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
      };
      this.sessionProgress = { ...savedSession.progress };
    }
  }

  getState(): TelemetryControllerState {
    return { ...this.state };
  }

  /** 当前活跃会话 id；无会话时返回 null。 */
  getActiveSessionId(): string | null {
    return this.session?.session_id ?? null;
  }

  /** 在当前版本游戏真正开始前向服务端申请 seed；失败时返回 null。 */
  async prepareVerifiedSession(meta: ActiveSessionMeta): Promise<VerifiedSessionStart | null> {
    const requestedRulesVersion = Number(meta.rules_version);
    if (
      requestedRulesVersion !== CURRENT_RULES_VERSION ||
      meta.game_mode !== 'volatility_trade' ||
      !this.state.consent?.granted ||
      !this.state.identity ||
      !this.state.telemetryEnabled
    ) return null;
    const identity = this.state.identity;
    try {
      const prepared = await this.backend.startVerifiedSession(identity.player_id, {
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
      if (prepared?.rules_snapshot.rulesVersion !== requestedRulesVersion) {
        console.warn('[telemetry] 服务端规则版本与客户端不一致，交由玩家决定是否本地开局');
        return null;
      }
      return prepared;
    } catch (e) {
      console.warn('[telemetry] verified session 准备失败，交由玩家决定是否本地开局', e);
      return null;
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

  /** 开始一次游戏会话（仅同意后生效；返回是否启用）。 */
  startSession(meta: ActiveSessionMeta, verified: VerifiedSessionStart | null = null): boolean {
    // 活动交易局只允许当前规则版本，并且必须绑定服务端 seed 会话。
    // 旧版本只保留存档/历史重放兼容，不再创建新的云端会话或事件。
    if (meta.game_mode === 'volatility_trade') {
      if (
        Number(meta.rules_version) !== CURRENT_RULES_VERSION ||
        !verified ||
        verified.rules_snapshot.rulesVersion !== CURRENT_RULES_VERSION
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
    };
    this.sessionProgress = { rounds: 0, final_score: 0, margin_call_count: 0 };
    if (verified) {
      writeActiveSession(this.storage, {
        session_id: this.session.session_id,
        client_session_id: this.session.client_session_id,
        started_at: this.session.started_at,
        meta: this.session.meta,
        verified: this.session.verified,
        replayActions: this.session.replayActions,
        playerId: this.session.playerId,
        progress: this.sessionProgress,
      });
    } else {
      writeActiveSession(this.storage, null);
    }
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

  /** 跨设备恢复或续局时重新绑定已有会话并接续动作链。 */
  resumeVerifiedSession(
    meta: ActiveSessionMeta,
    verified: VerifiedSessionStart & { client_session_id?: string },
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

    this.session = {
      session_id: verified.session_id,
      client_session_id: verified.client_session_id ?? verified.session_id,
      started_at: verified.started_at,
      ended: false,
      meta,
      verified,
      replayActions: effectiveActions,
      playerId: this.state.identity.player_id,
    };
    this.sessionProgress = { ...progress };
    writeActiveSession(this.storage, {
      session_id: this.session.session_id,
      client_session_id: this.session.client_session_id,
      started_at: this.session.started_at,
      meta: this.session.meta,
      verified: this.session.verified,
      replayActions: effectiveActions,
      playerId: this.session.playerId,
      progress: this.sessionProgress,
    });
    return true;
  }

  /** 记录已被核心引擎接受的动作；服务端只重放这些动作，不读取客户端最终分数。 */
  recordReplayAction(action: ReplayAction): void {
    if (!this.session || this.session.ended || !this.session.verified) return;
    this.session.replayActions.push(action);
    writeActiveSession(this.storage, {
      session_id: this.session.session_id,
      client_session_id: this.session.client_session_id,
      started_at: this.session.started_at,
      meta: this.session.meta,
      verified: this.session.verified,
      replayActions: this.session.replayActions,
      playerId: this.session.playerId,
      progress: this.sessionProgress,
    });
  }

  /** 执行动作失败时撤销预先登记的动作。 */
  removeLastReplayAction(): void {
    if (!this.session || this.session.ended || !this.session.verified) return;
    this.session.replayActions.pop();
    writeActiveSession(this.storage, {
      session_id: this.session.session_id,
      client_session_id: this.session.client_session_id,
      started_at: this.session.started_at,
      meta: this.session.meta,
      verified: this.session.verified,
      replayActions: this.session.replayActions,
      playerId: this.session.playerId,
      progress: this.sessionProgress,
    });
  }

  /** 游戏过程中持续刷新当前进度（页面关闭/放弃时带走真实数值）。 */
  updateSessionProgress(progress: SessionProgress): void {
    if (!this.session || this.session.ended) return;
    this.sessionProgress = { ...progress };
    if (this.session.verified) {
      writeActiveSession(this.storage, {
        session_id: this.session.session_id,
        client_session_id: this.session.client_session_id,
        started_at: this.session.started_at,
        meta: this.session.meta,
        verified: this.session.verified,
        replayActions: this.session.replayActions,
        playerId: this.session.playerId,
        progress: this.sessionProgress,
      });
    }
  }

  /** 结束会话：正常结束上报 session_end；放弃上报 session_abandon。 */
  endSession(result: SessionEndResult): void {
    const session = this.session;
    if (!session || session.ended) return;
    session.ended = true;
    writeActiveSession(this.storage, null);
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

  /** 放弃当前会话（主动终止、开新局覆盖等；由队列重试保证送达）。 */
  abandonSession(reason: 'voluntary_termination' | 'new_game_override' | 'reset' | 'pagehide' = 'voluntary_termination'): void {
    this.endSession({
      reason,
      ...this.sessionProgress,
    });
    this.setState({ activeCloudSession: null });
    void this.queue.flush();
    void this.refreshCultivationLedger();
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

  async refreshActiveSession(): Promise<CloudActiveGameSession | null> {
    const identity = this.state.identity;
    if (!identity || !this.state.consent?.granted) return null;
    this.setState({ activeCloudSessionBusy: true });
    try {
      const session = await this.backend.fetchActiveGameSession(identity.player_id);
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
    session: { session_id: string; client_session_id?: string; started_at: string; meta: ActiveSessionMeta; playerId: string },
    end?: { ended: boolean; abandoned: boolean; rounds: number; final_score: number },
  ): Promise<void> {
    const playerId = session.playerId;
    if (!playerId) return;
    const status = !end?.ended ? 'started' : end.abandoned ? 'abandoned' : 'completed';
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
  ): Promise<void> {
    if (session.verified && !abandoned) {
      // 云端服务端重放校验后台执行：登记为 pending 并异步提交。
      // 记录按 session_id 隔离、playerId 为该局开始时的固定值，不阻塞开始下一局。
      this.verification.submit({
        sessionId: session.session_id,
        playerId: session.playerId,
        actions: session.replayActions,
      });
      return;
    }
    try {
      await this.upsertSessionNow(session, {
        ended: true,
        abandoned,
        rounds: result.rounds,
        final_score: result.final_score,
      });
    } catch (e) {
      console.warn('[telemetry] game_sessions upsert 失败，仍尝试提交排行榜', e);
    }
  }


  private bindPagehide(): void {
    if (this.pagehideBound) return;
    this.pagehideBound = true;
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => {
        void this.verification.resumePending();
      });
    }
  }
}
