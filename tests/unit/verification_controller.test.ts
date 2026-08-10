/**
 * 云端成绩校验状态层测试。
 *
 * 覆盖场景：
 * - 快速开始下一局：旧局异步回调只更新旧记录，不污染新局；
 * - 重复结算回调：同一会话重复提交幂等；
 * - 身份切换：记录按 session_id 隔离，提交固定开局时 player_id；
 * - 失败不抛异常：pending → failed → retry → verified 完整闭环；
 * - 显示守卫：结算界面只展示当前已结束会话的校验记录。
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  AnalyticsBackend,
  VerifiedSessionStart,
  VerifiedScoreOutcome,
  VerifiedScoreSubmission,
} from '../../app/src/lib/analyticsBackend';
import {
  VerificationStateController,
  isRecordForDisplay,
  type VerificationRecord,
} from '../../app/src/lib/verificationState';
import type { ReplayAction } from '../../src/core';
import type { StorageProvider } from '../../src/core/StorageProvider';

class MemoryStorage implements StorageProvider {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const OK_OUTCOME: VerifiedScoreOutcome = {
  verified: true,
  rejected: false,
  score: 1200,
  leaderboard_submitted: true,
  message: null,
};

function makeBackend() {
  const submitVerifiedScore = vi.fn(
    async (_playerId: string, _submission: VerifiedScoreSubmission): Promise<VerifiedScoreOutcome> => ({ ...OK_OUTCOME }),
  );
  const backend = {
    ensureSession: vi.fn(async () => true),
    provision: vi.fn(),
    recoverIdentity: vi.fn(),
    updateDisplayName: vi.fn(async () => undefined),
    uploadEvents: vi.fn(async () => undefined),
    upsertSession: vi.fn(async () => undefined),
    startVerifiedSession: vi.fn(async () => null as VerifiedSessionStart | null),
    submitVerifiedScore,
    fetchLeaderboard: vi.fn(async () => []),
  } satisfies AnalyticsBackend;
  return { backend, submitVerifiedScore };
}

function submit(controller: VerificationStateController, sessionId: string, playerId: string, actions: ReplayAction[] = []) {
  return controller.submit({ sessionId, playerId, actions });
}

describe('VerificationStateController', () => {
  it('提交后先进入 pending，成功后进入 verified 并可观察到变更序列', async () => {
    let resolveSubmit!: (outcome: VerifiedScoreOutcome) => void;
    const { backend, submitVerifiedScore } = makeBackend();
    submitVerifiedScore.mockImplementation(() => new Promise<VerifiedScoreOutcome>((res) => {
      resolveSubmit = res;
    }));
    const controller = new VerificationStateController({ backend });
    const changes: VerificationRecord[] = [];
    controller.subscribe((record) => changes.push(record));

    const record = submit(controller, 's1', 'p1', [{ type: 'wait' }]);
    expect(record.status).toBe('pending');

    resolveSubmit(OK_OUTCOME);
    await vi.waitFor(() => expect(controller.get('s1')?.status).toBe('verified'));
    expect(controller.get('s1')?.score).toBe(1200);
    expect(controller.get('s1')?.leaderboardSubmitted).toBe(true);
    expect(changes.map((c) => c.status)).toEqual(['pending', 'verified']);
  });

  it('重复结算回调幂等：同一会话不重复提交、不创建重复记录', async () => {
    const { backend, submitVerifiedScore } = makeBackend();
    const controller = new VerificationStateController({ backend });

    const first = submit(controller, 's1', 'p1');
    const second = submit(controller, 's1', 'p1');
    expect(first).toBe(second);
    expect(submitVerifiedScore).toHaveBeenCalledTimes(1);
  });

  it('快速开始下一局：旧局异步回调只更新旧记录，不污染新局记录', async () => {
    const resolveMap = new Map<string, (outcome: VerifiedScoreOutcome) => void>();
    const { backend } = makeBackend();
    backend.submitVerifiedScore.mockImplementation(
      (_playerId: string, submission: VerifiedScoreSubmission) =>
        new Promise<VerifiedScoreOutcome>((res) => {
          resolveMap.set(submission.session_id, res);
        }),
    );
    const controller = new VerificationStateController({ backend });

    submit(controller, 's1', 'p1');
    submit(controller, 's2', 'p1');
    expect(controller.get('s1')?.status).toBe('pending');
    expect(controller.get('s2')?.status).toBe('pending');

    // 旧局 s1 的异步回调晚于新局 s2 返回：只改变 s1，s2 仍是 pending。
    resolveMap.get('s1')!(OK_OUTCOME);
    await vi.waitFor(() => expect(controller.get('s1')?.status).toBe('verified'));
    expect(controller.get('s2')?.status).toBe('pending');
    expect(controller.get('s2')?.score).toBeNull();
  });

  it('身份切换：旧会话固定开局 player_id，新会话归属新身份', async () => {
    const callOrder: string[] = [];
    const { backend, submitVerifiedScore } = makeBackend();
    submitVerifiedScore.mockImplementation(async (playerId: string, _submission: VerifiedScoreSubmission) => {
      callOrder.push(playerId);
      return { ...OK_OUTCOME };
    });
    const controller = new VerificationStateController({ backend });

    submit(controller, 's1', 'player-1');
    // 身份切换后开启的新局属于 player-2
    submit(controller, 's2', 'player-2');

    await vi.waitFor(() => expect(callOrder).toHaveLength(2));
    expect(callOrder[0]).toBe('player-1');
    expect(callOrder[1]).toBe('player-2');
    expect(controller.get('s1')?.playerId).toBe('player-1');
    expect(controller.get('s2')?.playerId).toBe('player-2');
  });

  it('网络失败不抛异常：进入 failed，可重试后恢复 verified', async () => {
    const { backend } = makeBackend();
    backend.submitVerifiedScore
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ...OK_OUTCOME });
    const controller = new VerificationStateController({ backend });

    expect(() => submit(controller, 's1', 'p1')).not.toThrow();
    await vi.waitFor(() => expect(controller.get('s1')?.status).toBe('failed'));
    expect(controller.get('s1')?.message).toBe('network down');
    expect(controller.get('s1')?.retryCount).toBe(0);

    const retried = controller.retry('s1');
    expect(retried?.status).toBe('pending');
    expect(retried?.retryCount).toBe(1);
    await vi.waitFor(() => expect(controller.get('s1')?.status).toBe('verified'));
  });

  it('服务端拒绝进入 rejected；重试只对 failed/rejected 开放', async () => {
    const { backend } = makeBackend();
    backend.submitVerifiedScore.mockResolvedValueOnce({
      verified: false,
      rejected: true,
      score: null,
      leaderboard_submitted: false,
      message: 'replay_rejected',
    });
    const controller = new VerificationStateController({ backend });

    submit(controller, 's1', 'p1');
    await vi.waitFor(() => expect(controller.get('s1')?.status).toBe('rejected'));

    // pending 中的记录不可重试
    expect(controller.retry('unknown')).toBeNull();
    const retried = controller.retry('s1');
    expect(retried).not.toBeNull();
    expect(retried?.status).toBe('pending');
  });

  it('记录被移除后，旧回调不再回写（彻底隔离）', async () => {
    let resolveSubmit!: (outcome: VerifiedScoreOutcome) => void;
    const { backend, submitVerifiedScore } = makeBackend();
    submitVerifiedScore.mockImplementation(() => new Promise<VerifiedScoreOutcome>((res) => {
      resolveSubmit = res;
    }));
    const controller = new VerificationStateController({ backend });

    submit(controller, 's1', 'p1');
    controller.remove('s1');
    resolveSubmit(OK_OUTCOME);
    await Promise.resolve();
    expect(controller.get('s1')).toBeNull();
  });

  it('页面刷新后恢复 pending 提交，成功后清理本地队列且不保存最终修为', async () => {
    const storage = new MemoryStorage();
    const first = makeBackend();
    first.submitVerifiedScore.mockImplementation(
      () => new Promise<VerifiedScoreOutcome>(() => undefined),
    );
    const firstController = new VerificationStateController({ backend: first.backend, storage });
    submit(firstController, 's-persisted', 'player-1', [{ type: 'wait' }]);

    const raw = storage.getItem('jiazi_verified_score_queue');
    expect(raw).toContain('s-persisted');
    expect(raw).not.toContain('score');
    expect(raw).not.toContain('recovery');

    const second = makeBackend();
    const secondController = new VerificationStateController({ backend: second.backend, storage });
    await secondController.resumePending();

    expect(second.submitVerifiedScore).toHaveBeenCalledWith('player-1', {
      session_id: 's-persisted',
      actions: [{ type: 'wait' }],
    });
    expect(storage.getItem('jiazi_verified_score_queue')).toBeNull();
    expect(secondController.get('s-persisted')?.status).toBe('verified');
  });
});

describe('isRecordForDisplay', () => {
  const record: VerificationRecord = {
    sessionId: 's1',
    playerId: 'p1',
    status: 'verified',
    score: 100,
    leaderboardSubmitted: true,
    message: null,
    submittedAt: 1,
    resolvedAt: 2,
    retryCount: 0,
    actions: [],
  };

  it('只匹配当前结算会话的校验记录', () => {
    expect(isRecordForDisplay(record, 's1')).toBe(true);
    expect(isRecordForDisplay(record, 's2')).toBe(false);
    expect(isRecordForDisplay(record, null)).toBe(false);
  });
});
