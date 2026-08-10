/**
 * 云端成绩校验状态层（浏览器端）。
 *
 * 职责：
 * - 一甲子对局结束时立即在本地落榜，云端服务端重放校验在后台异步执行，不阻塞开始下一局；
 * - 校验记录按 session_id 隔离，并固定该局开始时的 player_id：旧局的异步回调只更新
 *   属于自己的记录，身份切换或开启新局都不会被误归属；
 * - 成功/拒绝/网络失败都进入可观察的 pending / verified / rejected / failed 状态；
 * - 任何失败都不向调用方抛错，不影响下一局、存档或本地榜。
 *
 * 提交（submit/retry）都是幂等的：同一 session 的 pending 记录不会重复提交；
 * 重复结算回调只会命中已有记录。
 */

import type { ReplayAction, StorageProvider } from '@core/index';
import type { AnalyticsBackend } from './analyticsBackend';

export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'failed';

const VERIFICATION_QUEUE_KEY = 'jiazi_verified_score_queue';

export interface VerificationRecord {
  /** 服务端校验会话 id（隔离键）。 */
  sessionId: string;
  /** 该局开始时的 player_id（固定；身份切换不影响旧记录归属）。 */
  playerId: string;
  status: VerificationStatus;
  /** 服务端重放校验后的最终修为（仅 verified 后有值）。 */
  score: number | null;
  /** 校验通过后是否已写入云端榜（未设置昵称等资格限制时为 false）。 */
  leaderboardSubmitted: boolean;
  /** 拒绝/失败的原因说明。 */
  message: string | null;
  /** 最近一次提交/重试的时间（epoch ms）。 */
  submittedAt: number;
  resolvedAt: number | null;
  retryCount: number;
  /** 重试所需的最小动作序列；仅供控制器内部重放使用，不参与 UI 渲染。 */
  actions: readonly ReplayAction[];
}

export interface VerificationSubmitInput {
  sessionId: string;
  playerId: string;
  actions: readonly ReplayAction[];
}

export type VerificationChangeListener = (record: VerificationRecord) => void;

type PersistedVerificationRecord = Pick<
  VerificationRecord,
  'sessionId' | 'playerId' | 'status' | 'message' | 'submittedAt' | 'retryCount' | 'actions'
>;

/**
 * 显示守卫：结算界面只展示"当前已结束会话"对应的校验记录。
 * 旧局的异步回调携带旧 sessionId，在 `displaySessionId` 变更后会被丢弃，
 * 避免旧局回调污染新局或身份切换后的结算展示。
 */
export function isRecordForDisplay(
  record: VerificationRecord,
  displaySessionId: string | null,
): boolean {
  return displaySessionId !== null && record.sessionId === displaySessionId;
}

export class VerificationStateController {
  private readonly records = new Map<string, VerificationRecord>();
  private readonly listeners = new Set<VerificationChangeListener>();
  private readonly storage?: StorageProvider;

  constructor(private readonly deps: {
    backend: AnalyticsBackend;
    storage?: StorageProvider;
    /** 可注入时钟（epoch ms），测试用 */
    now?: () => number;
  }) {
    this.storage = deps.storage;
    this.restorePending();
  }

  subscribe(listener: VerificationChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get(sessionId: string): VerificationRecord | null {
    return this.records.get(sessionId) ?? null;
  }

  /** 最近一次提交的校验记录（无论状态），供 UI 展示最近校验进度。 */
  getLatest(): VerificationRecord | null {
    let latest: VerificationRecord | null = null;
    for (const record of this.records.values()) {
      if (!latest || record.submittedAt > latest.submittedAt) latest = record;
    }
    return latest;
  }

  getRecords(): readonly VerificationRecord[] {
    return [...this.records.values()];
  }

  /** 清除某会话的校验记录（供身份切换等需要彻底隔离的场景）。 */
  remove(sessionId: string): void {
    this.records.delete(sessionId);
    this.persistPending();
  }

  /** 用户撤回同意时清除尚未提交的遥测成绩，避免之后继续发送。 */
  clear(): void {
    this.records.clear();
    this.persistPending();
  }

  /** 应用启动、身份会话恢复后重试页面离开前尚未完成的提交。 */
  async resumePending(): Promise<void> {
    const pending = [...this.records.values()].filter((record) => record.status === 'pending');
    await Promise.all(pending.map((record) => this.runSubmit(record)));
  }

  /**
   * 会话结束时登记一次校验并异步提交。永不抛错。
   * 幂等：同一 session 已有 pending 记录时直接返回，不重复提交。
   */
  submit(input: VerificationSubmitInput): VerificationRecord {
    const existing = this.records.get(input.sessionId);
    if (existing && existing.status === 'pending') return existing;

    const now = this.deps.now?.() ?? Date.now();
    const record: VerificationRecord = {
      sessionId: input.sessionId,
      playerId: input.playerId,
      status: 'pending',
      score: null,
      leaderboardSubmitted: false,
      message: null,
      submittedAt: now,
      resolvedAt: null,
      retryCount: existing?.retryCount ?? 0,
      actions: [...input.actions],
    };
    this.records.set(input.sessionId, record);
    this.persistPending();
    this.emit(record);
    void this.runSubmit(record);
    return record;
  }

  /** 对 failed / rejected 的会话重新提交校验；状态不合法或会话不存在时返回 null。 */
  retry(sessionId: string): VerificationRecord | null {
    const record = this.records.get(sessionId);
    if (!record || (record.status !== 'failed' && record.status !== 'rejected')) return null;
    const now = this.deps.now?.() ?? Date.now();
    const next: VerificationRecord = {
      ...record,
      status: 'pending',
      message: null,
      submittedAt: now,
      resolvedAt: null,
      retryCount: record.retryCount + 1,
    };
    this.records.set(sessionId, next);
    this.persistPending();
    this.emit(next);
    void this.runSubmit(next);
    return next;
  }

  private async runSubmit(record: VerificationRecord): Promise<void> {
    try {
      const outcome = await this.deps.backend.submitVerifiedScore(record.playerId, {
        session_id: record.sessionId,
        actions: record.actions,
      });
      this.apply(record.sessionId, {
        status: outcome.verified ? 'verified' : outcome.rejected ? 'rejected' : 'failed',
        score: outcome.score,
        leaderboardSubmitted: outcome.leaderboard_submitted,
        message: outcome.message,
      });
    } catch (error) {
      // 后端实现抛出的意外错误同样收敛为 failed，绝不向游戏主流程传播。
      this.apply(record.sessionId, {
        status: 'failed',
        score: null,
        leaderboardSubmitted: false,
        message: error instanceof Error ? error.message : 'verification_error',
      });
    }
  }

  /** 仅更新"仍存在"的会话记录；记录被移除的旧回调直接忽略。 */
  private apply(
    sessionId: string,
    patch: {
      status: VerificationStatus;
      score: number | null;
      leaderboardSubmitted: boolean;
      message: string | null;
    },
  ): void {
    const record = this.records.get(sessionId);
    if (!record) return;
    const next: VerificationRecord = {
      ...record,
      ...patch,
      resolvedAt: this.deps.now?.() ?? Date.now(),
    };
    this.records.set(sessionId, next);
    this.persistPending();
    this.emit(next);
  }

  private restorePending(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(VERIFICATION_QUEUE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const value of parsed) {
        if (!this.isPersistedRecord(value)) continue;
        this.records.set(value.sessionId, {
          sessionId: value.sessionId,
          playerId: value.playerId,
          status: value.status,
          score: null,
          leaderboardSubmitted: false,
          message: value.message,
          submittedAt: value.submittedAt,
          resolvedAt: null,
          retryCount: value.retryCount,
          actions: value.actions,
        });
      }
    } catch {
      // 损坏的待提交队列不应阻塞游戏；服务端不会收到未经重放的结果。
    }
  }

  private isPersistedRecord(value: unknown): value is PersistedVerificationRecord {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const record = value as Partial<PersistedVerificationRecord>;
    return (
      typeof record.sessionId === 'string' &&
      typeof record.playerId === 'string' &&
      (record.status === 'pending' || record.status === 'rejected' || record.status === 'failed') &&
      (record.message === null || typeof record.message === 'string') &&
      typeof record.submittedAt === 'number' &&
      Number.isFinite(record.submittedAt) &&
      typeof record.retryCount === 'number' &&
      Number.isInteger(record.retryCount) &&
      Array.isArray(record.actions)
    );
  }

  private persistPending(): void {
    if (!this.storage) return;
    try {
      const pending: PersistedVerificationRecord[] = [...this.records.values()]
        .filter((record) => record.status !== 'verified')
        .map(({ sessionId, playerId, status, message, submittedAt, retryCount, actions }) => ({
          sessionId,
          playerId,
          status,
          message,
          submittedAt,
          retryCount,
          actions,
        }));
      if (pending.length === 0) this.storage.removeItem(VERIFICATION_QUEUE_KEY);
      else this.storage.setItem(VERIFICATION_QUEUE_KEY, JSON.stringify(pending));
    } catch {
      // 本地存储不可用时继续以内存状态运行，不影响本局。
    }
  }

  private emit(record: VerificationRecord): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(record);
      } catch {
        // 订阅者异常不得影响校验状态机的继续执行。
      }
    }
  }
}
