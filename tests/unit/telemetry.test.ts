import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TelemetryQueue,
  sanitizeEvent,
  type TelemetryTransport,
  type TelemetryEvent,
} from '../../src/core/telemetry';
import type { StorageProvider } from '../../src/core/StorageProvider';

const QUEUE_KEY = 'jiazi_telemetry_queue';

/** 内存 StorageProvider：遥测队列与 sanitize 均不依赖真实浏览器/网络 */
class MemoryStorage implements StorageProvider {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const validActionBuy = {
  session_id: 'sess-1',
  round: 1,
  season: '甲子',
  qi_before: 100,
  qi_after: 80,
  score_before: 10,
  score_after: 12,
  leverage_multiplier: 2,
  public_context: [{ id: 1, name: 'A', score: 5 }],
  hand_context: [{ id: 2, name: 'B', score: 6, use_leverage: false }],
  card_id: 2,
  card_name: 'B',
  card_main_element: '木',
  card_yin_yang: '阳',
  card_score: 6,
  base_score: 6,
  volatility_delta: null,
  buy_cost: 20,
  use_leverage: false,
};

const validRoundSettled = {
  session_id: 'sess-1',
  round: 3,
  season: '乙丑',
  hold_earnings: 10,
  hold_qi_cost: 5,
  base_qi_recover: 4,
  wait_qi_recover: 2,
  margin_call_triggered: false,
  margin_call_count: 0,
  qi_after: 70,
  score_after: 30,
};

describe('telemetry sanitizeEvent / validate', () => {
  it('合法 action_buy 能通过并移除未知字段', () => {
    const event = sanitizeEvent({
      type: 'action_buy',
      payload: { ...validActionBuy, hacker_field: 'x', nested: { a: 1 } },
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('action_buy');
    expect(typeof event!.id).toBe('string');
    expect(typeof event!.ts).toBe('string');
    expect(event!.version).toBe(1);
    expect(event!.payload).not.toHaveProperty('hacker_field');
    expect(event!.payload).not.toHaveProperty('nested');
    expect(event!.payload.session_id).toBe('sess-1');
    expect(event!.payload.card_id).toBe(2);
  });

  it('缺 session_id 时返回 null', () => {
    const { session_id: _drop, ...noSession } = validActionBuy;
    expect(sanitizeEvent({ type: 'action_buy', payload: noSession })).toBeNull();
  });

  it('上下文结构不合法时返回 null', () => {
    expect(
      sanitizeEvent({
        type: 'action_buy',
        payload: { ...validActionBuy, hand_context: [{ id: 2, name: 'B', score: 6 }] },
      }),
    ).toBeNull();
    expect(
      sanitizeEvent({
        type: 'action_buy',
        payload: { ...validActionBuy, public_context: 'not-an-array' },
      }),
    ).toBeNull();
    expect(
      sanitizeEvent({
        type: 'action_buy',
        payload: { ...validActionBuy, public_context: [{ id: 'x', name: 'A', score: 5 }] },
      }),
    ).toBeNull();
  });

  it('合法 round_settled 能通过', () => {
    const event = sanitizeEvent({ type: 'round_settled', payload: validRoundSettled });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('round_settled');
    expect(event!.payload.session_id).toBe('sess-1');
    expect(event!.payload.qi_after).toBe(70);
  });
});

describe('TelemetryQueue', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('未启用时 track 返回 false 且不写队列', () => {
    const upload = vi.fn();
    const queue = new TelemetryQueue({
      storage,
      transport: { upload },
      now: () => 1000,
    });

    expect(queue.isEnabled()).toBe(false);
    expect(queue.track({ type: 'action_buy', payload: validActionBuy })).toBe(false);
    expect(queue.pendingCount()).toBe(0);
    expect(storage.getItem(QUEUE_KEY)).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it('启用后合法事件入队，fake transport 上传后清空', async () => {
    let resolveUpload!: (value: void) => void;
    const upload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const queue = new TelemetryQueue({
      storage,
      transport: { upload },
      now: () => 1000,
    });

    queue.setEnabled(true);
    expect(queue.isEnabled()).toBe(true);
    expect(queue.track({ type: 'action_buy', payload: validActionBuy })).toBe(true);
    expect(queue.pendingCount()).toBe(1);

    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const batch = upload.mock.calls[0][0] as TelemetryEvent[];
    expect(batch).toHaveLength(1);
    expect(batch[0].type).toBe('action_buy');
    expect(batch[0].payload).not.toHaveProperty('hacker_field');

    resolveUpload();
    await vi.waitFor(() => expect(queue.pendingCount()).toBe(0));
    expect(storage.getItem(QUEUE_KEY)).toBe('[]');
  });

  it('上传失败保留队列并进入退避', async () => {
    const upload = vi.fn(async () => {
      throw new Error('network-down');
    });
    const queue = new TelemetryQueue({
      storage,
      transport: { upload },
      now: () => 1000,
      initialRetryMs: 2000,
    });

    queue.setEnabled(true);
    expect(queue.track({ type: 'round_settled', payload: validRoundSettled })).toBe(true);

    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(queue.getRetryCount()).toBe(1));

    expect(queue.pendingCount()).toBe(1);
    expect(queue.getNextAttemptAt()).toBeGreaterThan(1000);

    const persisted = JSON.parse(storage.getItem(QUEUE_KEY) ?? '[]') as TelemetryEvent[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0].type).toBe('round_settled');

    const callCountBefore = upload.mock.calls.length;
    await queue.flush();
    expect(upload.mock.calls.length).toBe(callCountBefore);
    expect(queue.pendingCount()).toBe(1);

    queue.clear();
  });
});
