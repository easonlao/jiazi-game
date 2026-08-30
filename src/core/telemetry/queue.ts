/**
 * 遥测本地队列（平台无关）。
 *
 * 职责：
 * - 在获得同意前不落盘、不发送（enabled=false 时 track 直接丢弃）；
 * - 事件先入 localStorage 队列，再批量上传（transport.upload）；
 * - 上传失败/离线时保留队列并指数退避重试（retry/backoff）；
 * - 每条事件携带客户端生成的幂等 ID（client_event_id），服务端按唯一约束去重；
 * - 队列有界（超限丢弃最旧事件），永不因遥测阻塞或抛错影响游戏。
 *
 * transport 由平台层注入（浏览器为 Supabase PostgREST；测试注入 fake sink）。
 */

import { sanitizePayload } from './validate';
import {
  TELEMETRY_MAX_QUEUE,
  makeEvent,
  type TelemetryEvent,
  type TrackedEventInput,
} from './types';
import type { StorageProvider } from '../StorageProvider';

const QUEUE_KEY = 'jiazi_telemetry_queue';
const SEQUENCE_KEY = 'jiazi_telemetry_sequence';

/** 上传传输层：成功必须 resolve；失败 reject（网络错误/HTTP 错误都会保留队列重试）。 */
export interface TelemetryTransport {
  upload(batch: TelemetryEvent[]): Promise<void>;
}

export interface TelemetryQueueOptions {
  storage: StorageProvider;
  transport: TelemetryTransport | null;
  /** 可注入时钟（毫秒），测试用 */
  now?: () => number;
  maxQueueSize?: number;
  batchSize?: number;
  initialRetryMs?: number;
  maxRetryMs?: number;
}

export class TelemetryQueue {
  private readonly storage: StorageProvider;
  private readonly transport: TelemetryTransport | null;
  private readonly now: () => number;
  private readonly maxQueueSize: number;
  private readonly batchSize: number;
  private readonly initialRetryMs: number;
  private readonly maxRetryMs: number;

  private enabled: boolean;
  private queue: TelemetryEvent[];
  private retryCount: number;
  private nextAttemptAt: number;
  private flushing: boolean;
  private currentFlushPromise: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null;
  private nextSequence: number;

  constructor(options: TelemetryQueueOptions) {
    this.storage = options.storage;
    this.transport = options.transport;
    this.now = options.now ?? (() => Date.now());
    this.maxQueueSize = options.maxQueueSize ?? TELEMETRY_MAX_QUEUE;
    this.batchSize = options.batchSize ?? 50;
    this.initialRetryMs = options.initialRetryMs ?? 2_000;
    this.maxRetryMs = options.maxRetryMs ?? 300_000;

    this.enabled = false;
    this.retryCount = 0;
    this.nextAttemptAt = 0;
    this.flushing = false;
    this.timer = null;
    this.queue = this.load();
    this.nextSequence = this.loadNextSequence();
  }

  private loadNextSequence(): number {
    try {
      const stored = Number(this.storage.getItem(SEQUENCE_KEY));
      const queuedMax = this.queue.reduce((max, event) => Math.max(max, event.sequence ?? 0), 0);
      return Number.isSafeInteger(stored) && stored >= queuedMax ? stored : queuedMax;
    } catch {
      return this.queue.reduce((max, event) => Math.max(max, event.sequence ?? 0), 0);
    }
  }

  private persistNextSequence(): void {
    try {
      this.storage.setItem(SEQUENCE_KEY, String(this.nextSequence));
    } catch {
      // 序号持久化失败不应阻塞遥测或游戏。
    }
  }

  private load(): TelemetryEvent[] {
    try {
      const raw = this.storage.getItem(QUEUE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (e): e is TelemetryEvent =>
          typeof e === 'object' && e !== null &&
          typeof (e as TelemetryEvent).id === 'string' &&
          typeof (e as TelemetryEvent).type === 'string',
      ).map((event, index) => ({
        ...event,
        sequence: typeof event.sequence === 'number' ? event.sequence : index,
      })).slice(-this.maxQueueSize);
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      this.storage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
    } catch (e) {
      // localStorage 满/不可用：静默降级（遥测永不阻塞游戏）
      console.warn('[TelemetryQueue] 队列持久化失败', e);
    }
  }

  /**
   * 开关遥测。仅在获得同意后由外部打开；关闭时清空队列。
   * @param enabled true 后立即尝试 flush 已有历史队列。
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.queue = [];
      this.persist();
      this.retryCount = 0;
      this.scheduleTimer(null);
      return;
    }
    void this.flush();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  getRetryCount(): number {
    return this.retryCount;
  }

  getLastSequence(): number {
    return Math.max(0, this.nextSequence - 1);
  }

  /**
   * 入队一条事件。未启用/载荷非法时丢弃并返回 null（不影响调用方）。
   * 成功返回分配有单调 sequence 序号的 TelemetryEvent。
   */
  track(input: TrackedEventInput): TelemetryEvent | null {
    if (!this.enabled) return null;
    if (!this.transport) return null;
    const payload = sanitizePayload(input.type, input.payload);
    if (!payload) return null;
    const event = makeEvent({ type: input.type, payload }, () => new Date(this.now()).toISOString(), this.nextSequence++);
    this.persistNextSequence();
    // 幂等：同 id 不重复入队
    const existing = this.queue.find((e) => e.id === event.id);
    if (existing) return existing;
    this.queue.push(event);
    if (this.queue.length > this.maxQueueSize) {
      this.queue = this.queue.slice(-this.maxQueueSize);
    }
    this.persist();
    void this.flush();
    return event;
  }

  /** 立即尝试上传一批（供调用方主动调用；失败静默保留队列）。 */
  async flush(): Promise<void> {
    if (!this.enabled || !this.transport) return;
    if (this.currentFlushPromise) {
      await this.currentFlushPromise;
      if (this.queue.length === 0) return;
    }
    if (this.now() < this.nextAttemptAt) return;
    if (this.queue.length === 0) return;

    this.flushing = true;
    this.currentFlushPromise = (async () => {
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, this.batchSize);
        try {
          await this.transport!.upload(batch);
          // 成功后按 id 从队列移除（按引用删除，顺序无关）
          const ids = new Set(batch.map((e) => e.id));
          this.queue = this.queue.filter((e) => !ids.has(e.id));
          this.persist();
          this.retryCount = 0;
          this.nextAttemptAt = 0;
        } catch (e) {
          console.warn('[TelemetryQueue] 上传失败，稍后重试', e);
          this.retryCount++;
          const delay = Math.min(
            this.maxRetryMs,
            this.initialRetryMs * 2 ** Math.min(this.retryCount - 1, 8),
          );
          this.nextAttemptAt = this.now() + delay;
          this.scheduleTimer(delay);
          break;
        }
      }
    })().finally(() => {
      this.flushing = false;
      this.currentFlushPromise = null;
    });

    await this.currentFlushPromise;
  }

  private scheduleTimer(delay: number | null): void {
    this.clearTimer();
    if (delay === null) return;
    this.timer = setTimeout(() => {
      void this.flush();
    }, Math.max(delay, 0));
    // 浏览器后台标签页长延时被节流，极端延迟下也不阻塞（Timer 异步，无同步等待）。
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 测试/调试：同步读取当前队列副本。 */
  peek(): TelemetryEvent[] {
    return [...this.queue];
  }

  /** 测试/调试：清空本地队列（不发送）。 */
  clear(): void {
    this.queue = [];
    this.persist();
    this.clearTimer();
    this.retryCount = 0;
  }

  /** 下一次允许重试的时刻（now 为注入时钟时的可测值）。 */
  getNextAttemptAt(): number {
    return this.nextAttemptAt;
  }
}
