import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetryController } from '../../app/src/lib/telemetryController';
import type { AnalyticsBackend, SessionUpsert, VerifiedSessionStart } from '../../app/src/lib/analyticsBackend';
import type { StorageProvider } from '../../src/core/StorageProvider';
import { cloneReplayRulesSnapshot, CURRENT_REPLAY_RULES } from '../../src/core';

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

function createBackend() {
  return {
    ensureSession: vi.fn(async () => true),
    provision: vi.fn(),
    recoverIdentity: vi.fn(),
    updateDisplayName: vi.fn(async () => undefined),
    uploadEvents: vi.fn(async () => undefined),
    upsertSession: vi.fn(async (_playerId: string, _session: SessionUpsert) => undefined),
    startVerifiedSession: vi.fn(async (): Promise<VerifiedSessionStart | null> => null),
    submitVerifiedScore: vi.fn(async () => ({
      verified: true,
      rejected: false,
      score: 0,
      leaderboard_submitted: false,
      message: null,
    })),
    fetchLeaderboard: vi.fn(async () => []),
  } satisfies AnalyticsBackend;
}

function seedIdentity(storage: MemoryStorage, eligible: boolean): void {
  storage.setItem(
    'jiazi_consent',
    JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-10T00:00:00.000Z' }),
  );
  storage.setItem(
    'jiazi_player_identity',
    JSON.stringify({
      player_id: 'player-1',
      public_player_id: 'public-1',
      public_code: 'PUBLIC001',
      display_name: eligible ? '测试玩家' : '玩家',
      leaderboard_eligible: eligible,
    }),
  );
}

function seedLegacyIdentity(storage: MemoryStorage): void {
  storage.setItem(
    'jiazi_consent',
    JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-10T00:00:00.000Z' }),
  );
  storage.setItem(
    'jiazi_player_identity',
    JSON.stringify({
      player_id: 'player-legacy',
      public_player_id: 'public-legacy',
      display_name: '旧玩家',
    }),
  );
}

const meta = {
  rules_version: '4',
  game_mode: 'standard',
  volatility_enabled: true,
};

const verifiedMeta = {
  rules_version: String(CURRENT_REPLAY_RULES.rulesVersion),
  game_mode: 'volatility_trade',
  volatility_enabled: true,
};

describe('TelemetryController leaderboard eligibility', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('未设置用户名时只保留本地结果，不提交云端排行榜', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, false);
    const backend = createBackend();
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    expect(controller.startSession(meta)).toBe(true);
    controller.endSession({ reason: 'game_over', rounds: 60, final_score: 1200, margin_call_count: 0 });

    await Promise.resolve();
    await Promise.resolve();
    expect(backend.submitVerifiedScore).not.toHaveBeenCalled();
  });

  it('即使设置用户名，未拿到服务端 seed 的本地对局也不上云端榜', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    expect(controller.startSession(meta)).toBe(true);
    controller.endSession({ reason: 'game_over', rounds: 60, final_score: 1200.4, margin_call_count: 0 });

    await Promise.resolve();
    expect(backend.submitVerifiedScore).not.toHaveBeenCalled();
  });

  it('兼容旧本地身份：没有服务端校验会话时不提交排行榜', async () => {
    const storage = new MemoryStorage();
    seedLegacyIdentity(storage);
    const backend = createBackend();
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    expect(controller.startSession(meta)).toBe(true);
    controller.endSession({ reason: 'game_over', rounds: 60, final_score: 900, margin_call_count: 0 });

    await Promise.resolve();
    expect(backend.submitVerifiedScore).not.toHaveBeenCalled();
  });

  it('服务端 seed 会话只提交动作序列，不提交客户端最终分数', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    backend.startVerifiedSession.mockResolvedValue({
      session_id: 'verified-session',
      started_at: '2026-08-10T00:00:00.000Z',
      seed: 42,
      rules_snapshot: cloneReplayRulesSnapshot(CURRENT_REPLAY_RULES),
    });
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    const prepared = await controller.prepareVerifiedSession(verifiedMeta);
    expect(prepared?.session_id).toBe('verified-session');
    expect(controller.startSession(verifiedMeta, prepared)).toBe(true);
    controller.recordReplayAction({ type: 'wait' });
    controller.endSession({ reason: 'game_over', rounds: 60, final_score: 999999, margin_call_count: 0 });

    await vi.waitFor(() => expect(backend.submitVerifiedScore).toHaveBeenCalledTimes(1));
    expect(backend.submitVerifiedScore).toHaveBeenCalledWith('player-1', {
      session_id: 'verified-session',
      actions: [{ type: 'wait' }],
    });
    expect(JSON.stringify(backend.submitVerifiedScore.mock.calls[0])).not.toContain('999999');
  });

  it('当前 V4 未拿到服务端 seed 时不允许创建普通交易会话', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    const controller = new TelemetryController({ storage, backend });
    const v4Meta = { rules_version: '4', game_mode: 'volatility_trade', volatility_enabled: true };

    await controller.init();
    await expect(controller.prepareVerifiedSession(v4Meta)).resolves.toBeNull();
    expect(backend.startVerifiedSession).toHaveBeenCalledTimes(1);
    expect(controller.startSession(v4Meta)).toBe(false);
    expect(controller.getActiveSessionId()).toBeNull();
    expect(backend.upsertSession).not.toHaveBeenCalled();
    expect(backend.uploadEvents).not.toHaveBeenCalled();
  });

  it('旧 V3 只保留历史兼容，不再创建新的云端交易会话', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    await expect(controller.prepareVerifiedSession({
      rules_version: '3', game_mode: 'volatility_trade', volatility_enabled: true,
    })).resolves.toBeNull();
    expect(controller.startSession({
      rules_version: '3', game_mode: 'volatility_trade', volatility_enabled: true,
    })).toBe(false);
    expect(backend.startVerifiedSession).not.toHaveBeenCalled();
  });

  it('身份切换后，已开始的校验会话仍以开局时的 player_id 提交', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    backend.startVerifiedSession.mockResolvedValue({
      session_id: 'verified-session',
      started_at: '2026-08-10T00:00:00.000Z',
      seed: 42,
      rules_snapshot: cloneReplayRulesSnapshot(CURRENT_REPLAY_RULES),
    });
    backend.recoverIdentity.mockResolvedValue({
      player_id: 'player-2',
      public_player_id: 'public-2',
      public_code: 'PUBLIC002',
      display_name: '新玩家',
      leaderboard_eligible: true,
    });
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    const prepared = await controller.prepareVerifiedSession(verifiedMeta);
    expect(prepared).not.toBeNull();
    controller.startSession(verifiedMeta, prepared);
    // 对局中途身份切换：回收恢复码换绑到 player-2
    await controller.recoverIdentity('SOME-RECOVERY-CODE');
    controller.endSession({ reason: 'game_over', rounds: 60, final_score: 1000, margin_call_count: 0 });

    await vi.waitFor(() => expect(backend.submitVerifiedScore).toHaveBeenCalledTimes(1));
    // 提交仍归属开局时的 player-1，不会被身份切换误归属到 player-2
    expect(backend.submitVerifiedScore).toHaveBeenCalledWith('player-1', expect.objectContaining({
      session_id: 'verified-session',
    }));
  });

  it('校验提交失败不抛到调用方，会话结束可继续', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    backend.startVerifiedSession.mockResolvedValue({
      session_id: 'verified-session',
      started_at: '2026-08-10T00:00:00.000Z',
      seed: 42,
      rules_snapshot: cloneReplayRulesSnapshot(CURRENT_REPLAY_RULES),
    });
    backend.submitVerifiedScore.mockRejectedValueOnce(new Error('network down'));
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    const prepared = await controller.prepareVerifiedSession(verifiedMeta);
    controller.startSession(verifiedMeta, prepared);
    expect(() => controller.endSession({
      reason: 'game_over', rounds: 60, final_score: 100, margin_call_count: 0,
    })).not.toThrow();
    await vi.waitFor(() => expect(controller.getVerification('verified-session')?.status).toBe('failed'));
  });

  it('game_sessions upsert 携带客户端原始 started_at，保证 ended_at >= started_at', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    expect(controller.startSession(meta)).toBe(true);

    await vi.waitFor(() => expect(backend.upsertSession).toHaveBeenCalledTimes(1));
    const startCall = backend.upsertSession.mock.calls[0][1] as SessionUpsert;
    expect(startCall.started_at).toBeTypeOf('string');

    controller.endSession({ reason: 'game_over', rounds: 60, final_score: 1200, margin_call_count: 0 });

    await vi.waitFor(() => expect(backend.upsertSession).toHaveBeenCalledTimes(2));
    const endCall = backend.upsertSession.mock.calls[1][1] as SessionUpsert;
    expect(endCall.started_at).toBe(startCall.started_at);
    expect(endCall.ended_at).toBeTypeOf('string');
    expect(new Date(endCall.ended_at as string).getTime()).toBeGreaterThanOrEqual(
      new Date(endCall.started_at).getTime(),
    );
  });

  it('重新开始对局时，旧客户端会话先被标记为 abandoned', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    expect(controller.startSession(meta)).toBe(true);
    await vi.waitFor(() => expect(backend.upsertSession).toHaveBeenCalledTimes(1));

    controller.endSession({ reason: 'reset', rounds: 0, final_score: 0, margin_call_count: 0 });
    await vi.waitFor(() => expect(backend.upsertSession).toHaveBeenCalledTimes(2));

    expect(controller.startSession(meta)).toBe(true);
    await vi.waitFor(() => expect(backend.upsertSession).toHaveBeenCalledTimes(3));

    expect(backend.upsertSession.mock.calls.map(([, session]) => (session as SessionUpsert).status))
      .toEqual(['started', 'abandoned', 'started']);
  });

  it('game_sessions upsert 失败时，本地对局仍不绕过服务端重放', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    backend.upsertSession.mockRejectedValueOnce(new Error('check constraint game_sessions_check'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    expect(controller.startSession(meta)).toBe(true);
    controller.endSession({ reason: 'game_over', rounds: 60, final_score: 1200, margin_call_count: 0 });

    await Promise.resolve();
    expect(backend.submitVerifiedScore).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
