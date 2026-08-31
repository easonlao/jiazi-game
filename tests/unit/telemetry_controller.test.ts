import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TelemetryController,
  isSameAction,
  mergeActionChains,
} from '../../app/src/lib/telemetryController';
import type {
  AnalyticsBackend,
  CultivationLedgerSnapshot,
  PlayerIdentity,
  SessionUpsert,
  VerifiedSessionStart,
} from '../../app/src/lib/analyticsBackend';
import { summarizeCultivationLedger, type CultivationLedgerRecord } from '../../app/src/lib/cultivationLedger';
import type { StorageProvider } from '../../src/core/StorageProvider';
import { cloneReplayRulesSnapshot, CURRENT_REPLAY_RULES, CURRENT_RULES_VERSION } from '../../src/core';

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
    updateDisplayName: vi.fn(
      async (_playerId: string, _name: string): Promise<PlayerIdentity> => ({
        player_id: 'player-1',
        public_player_id: 'public-1',
        public_code: 'PUBLIC001',
        display_name: '测试玩家',
        leaderboard_eligible: true,
      }),
    ),
    uploadEvents: vi.fn(async () => undefined),
    upsertSession: vi.fn(async (_playerId: string, _session: SessionUpsert) => undefined),
    startVerifiedSession: vi.fn(async () => ({
      success: false,
      error: {
        code: 'cloud_not_configured' as const,
        message: 'not configured',
        userMessage: '云端未配置',
      },
    })),
    submitVerifiedScore: vi.fn(async () => ({
      verified: true,
      rejected: false,
      score: 0,
      leaderboard_submitted: false,
      message: null,
    })),
    fetchLeaderboard: vi.fn(async () => []),
    fetchCultivationLedger: vi.fn(async (): Promise<CultivationLedgerSnapshot> => ({
      records: [],
      summary: summarizeCultivationLedger([]),
    })),
    fetchActiveGameSession: vi.fn(async () => null),
    fetchAssignedBalanceProfile: vi.fn(async () => 'v9_standard'),
    recoverCorruptedSession: vi.fn(async () => ({ success: true })),
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
      success: true,
      session: {
        session_id: 'verified-session',
        started_at: '2026-08-10T00:00:00.000Z',
        seed: 42,
        rules_snapshot: cloneReplayRulesSnapshot(CURRENT_REPLAY_RULES),
      },
    });
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    const startRes = await controller.prepareVerifiedSession(verifiedMeta);
    expect(startRes.success).toBe(true);
    if (!startRes.success) return;
    expect(startRes.session.session_id).toBe('verified-session');
    expect(controller.startSession(verifiedMeta, startRes.session)).toBe(true);
    controller.recordReplayAction({ type: 'wait' });
    controller.endSession({ reason: 'game_over', rounds: 60, final_score: 999999, margin_call_count: 0 });

    await vi.waitFor(() => expect(backend.submitVerifiedScore).toHaveBeenCalledTimes(1));
    expect(backend.submitVerifiedScore).toHaveBeenCalledWith('player-1', {
      session_id: 'verified-session',
      actions: [{ type: 'wait' }],
    });
    expect(JSON.stringify(backend.submitVerifiedScore.mock.calls[0])).not.toContain('999999');
  });

  it('身份就绪后会同步云端修行账本摘要，认领时只上传终态记录', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    backend.fetchCultivationLedger.mockResolvedValue({
      records: [
        {
          player_id: 'player-1',
          local_game_id: 'session-1',
          game_session_id: 'session-1',
          rules_version: 7,
          started_at: '2026-08-10T00:00:00.000Z',
          ended_at: '2026-08-10T00:45:00.000Z',
          outcome: 'completed',
          final_score: 128.5,
          record_source: 'verified_session',
          created_at: '2026-08-10T00:45:00.000Z',
          updated_at: '2026-08-10T00:45:00.000Z',
        },
      ],
      summary: summarizeCultivationLedger([
        {
          rulesVersion: 7,
          outcome: 'completed',
          finalScore: 128.5,
        },
      ]),
    });
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    expect(backend.fetchCultivationLedger).toHaveBeenCalledWith('player-1');
    expect(controller.getState().cultivationLedger?.records).toHaveLength(1);
    expect(controller.getState().cultivationLedgerBusy).toBe(false);

    expect(backend.fetchActiveGameSession).toHaveBeenCalledWith('player-1');

    // Test resumeVerifiedSession
    const resumed = controller.resumeVerifiedSession(
      { rules_version: '7', game_mode: 'standard', volatility_enabled: true },
      { session_id: 'session-resumed', started_at: '2026-08-27T10:00:00.000Z', seed: 42, rules_snapshot: {} as any },
      [{ type: 'buy', cardIndex: 0, leverage: false }],
      { rounds: 1, final_score: 10, margin_call_count: 0 }
    );
    expect(resumed).toBe(true);
    expect(controller.getActiveSessionId()).toBe('session-resumed');
  });

  it('终局云端校验成功后重新读取账本，让首页无需刷新即可看到本局', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    backend.startVerifiedSession.mockResolvedValue({
      success: true,
      session: {
        session_id: 'verified-session',
        started_at: '2026-08-31T09:00:00.000Z',
        seed: 42,
        rules_snapshot: cloneReplayRulesSnapshot(CURRENT_REPLAY_RULES),
      },
    });
    backend.fetchCultivationLedger
      .mockResolvedValueOnce({ records: [], summary: summarizeCultivationLedger([]) })
      .mockResolvedValueOnce({
        records: [{
          player_id: 'player-1',
          local_game_id: 'verified-session',
          game_session_id: 'verified-session',
          rules_version: CURRENT_RULES_VERSION,
          started_at: '2026-08-31T09:00:00.000Z',
          ended_at: '2026-08-31T10:00:00.000Z',
          outcome: 'completed',
          final_score: 321,
          record_source: 'verified_session',
          created_at: '2026-08-31T10:00:00.000Z',
          updated_at: '2026-08-31T10:00:00.000Z',
        }],
        summary: summarizeCultivationLedger([{ rulesVersion: CURRENT_RULES_VERSION, outcome: 'completed', finalScore: 321 }]),
      });
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    const prepared = await controller.prepareVerifiedSession(verifiedMeta);
    expect(prepared.success).toBe(true);
    if (!prepared.success) return;
    expect(controller.startSession(verifiedMeta, prepared.session)).toBe(true);
    controller.endSession({ reason: 'game_over', rounds: 60, final_score: 321, margin_call_count: 0 });

    await vi.waitFor(() => expect(controller.getState().cultivationLedger?.records).toHaveLength(1));
    expect(controller.getState().cultivationLedger?.records[0]).toMatchObject({
      local_game_id: 'verified-session',
      outcome: 'completed',
      final_score: 321,
    });
    expect(backend.fetchCultivationLedger).toHaveBeenCalledTimes(2);
  });

  it('当前版本（生产默认 V8）未拿到服务端 seed 时不允许创建普通交易会话', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    const controller = new TelemetryController({ storage, backend });
    const currentMeta = { rules_version: String(CURRENT_REPLAY_RULES.rulesVersion), game_mode: 'volatility_trade', volatility_enabled: true };

    await controller.init();
    const res = await controller.prepareVerifiedSession(currentMeta);
    expect(res.success).toBe(false);
    expect(backend.startVerifiedSession).toHaveBeenCalledTimes(1);
    expect(controller.startSession(currentMeta)).toBe(false);
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
    const res = await controller.prepareVerifiedSession({
      rules_version: '3', game_mode: 'volatility_trade', volatility_enabled: true,
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe('rules_version_mismatch');
    }
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
      success: true,
      session: {
        session_id: 'verified-session',
        started_at: '2026-08-10T00:00:00.000Z',
        seed: 42,
        rules_snapshot: cloneReplayRulesSnapshot(CURRENT_REPLAY_RULES),
      },
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
    const startRes = await controller.prepareVerifiedSession(verifiedMeta);
    expect(startRes.success).toBe(true);
    if (!startRes.success) return;
    controller.startSession(verifiedMeta, startRes.session);
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
      success: true,
      session: {
        session_id: 'verified-session',
        started_at: '2026-08-10T00:00:00.000Z',
        seed: 42,
        rules_snapshot: cloneReplayRulesSnapshot(CURRENT_REPLAY_RULES),
      },
    });
    backend.submitVerifiedScore.mockRejectedValueOnce(new Error('network down'));
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    const startRes = await controller.prepareVerifiedSession(verifiedMeta);
    expect(startRes.success).toBe(true);
    if (!startRes.success) return;
    controller.startSession(verifiedMeta, startRes.session);
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

describe('TelemetryController.updateDisplayName', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('采用服务端返回的身份（含 DB 重算的资格），不乐观宣称有资格', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, false);
    const backend = createBackend();
    const serverIdentity: PlayerIdentity = {
      player_id: 'player-1',
      public_player_id: 'public-1',
      public_code: 'PUBLIC001',
      display_name: '服务端名',
      leaderboard_eligible: true,
    };
    backend.updateDisplayName.mockResolvedValue(serverIdentity);
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    expect(controller.getState().identity?.leaderboard_eligible).toBe(false);
    expect(await controller.updateDisplayName('服务端名')).toBe(true);

    expect(backend.updateDisplayName).toHaveBeenCalledWith('player-1', '服务端名');
    const state = controller.getState();
    expect(state.identity?.display_name).toBe('服务端名');
    // 资格完全来自服务端返回，而非本地乐观写 true。
    expect(state.identity?.leaderboard_eligible).toBe(true);
    expect(JSON.parse(storage.getItem('jiazi_player_identity')!)).toEqual(serverIdentity);
  });

  it('服务端返回仍未达标时，不宣称有资格', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, false);
    const backend = createBackend();
    backend.updateDisplayName.mockResolvedValue({
      player_id: 'player-1',
      public_player_id: 'public-1',
      public_code: 'PUBLIC001',
      display_name: '玩家',
      leaderboard_eligible: false,
    });
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    await controller.updateDisplayName('玩家');

    expect(controller.getState().identity?.leaderboard_eligible).toBe(false);
    expect(controller.getState().error).toBeNull();
  });

  it('未命中/服务端拒绝时返回 false，保持原身份并提示错误', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, false);
    const backend = createBackend();
    backend.updateDisplayName.mockRejectedValue(new Error('updateDisplayName 未命中档案或返回异常'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const controller = new TelemetryController({ storage, backend });

    await controller.init();
    const before = controller.getState().identity;
    expect(await controller.updateDisplayName('新名字')).toBe(false);

    expect(controller.getState().identity).toEqual(before);
    expect(controller.getState().identity?.display_name).toBe('玩家');
    expect(controller.getState().identity?.leaderboard_eligible).toBe(false);
    expect(controller.getState().error).toBe('昵称更新失败，请稍后重试');
    expect(JSON.parse(storage.getItem('jiazi_player_identity')!)).toEqual(before);
    warn.mockRestore();
  });
});

describe('TelemetryController 会话持久化与刷新恢复 (Session Persistence)', () => {
  const verifiedMeta: ActiveSessionMeta = {
    rules_version: String(CURRENT_RULES_VERSION),
    game_mode: 'volatility_trade',
    volatility_enabled: true,
  };

  const verifiedStart: VerifiedSessionStart = {
    session_id: 'sess-persist-1',
    client_session_id: 'client-sess-1',
    started_at: '2026-08-28T00:00:00.000Z',
    seed: 12345,
    rules_snapshot: cloneReplayRulesSnapshot(CURRENT_REPLAY_RULES),
  };

  it('startSession 登记并持久化活跃会话，recordReplayAction 增量写入存储', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    const controller = new TelemetryController({ storage, backend });
    await controller.init();

    expect(controller.startSession(verifiedMeta, verifiedStart)).toBe(true);
    expect(controller.getActiveSessionId()).toBe('sess-persist-1');

    // 写入动作
    controller.recordReplayAction({ type: 'buy', cardIndex: 0, leverage: false });
    controller.recordReplayAction({ type: 'wait' });

    const raw = storage.getItem('jiazi_active_verified_session');
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!);
    expect(persisted.session_id).toBe('sess-persist-1');
    expect(persisted.replayActions).toHaveLength(2);
    expect(persisted.replayActions[0]).toEqual({ type: 'buy', cardIndex: 0, leverage: false });
    expect(persisted.replayActions[1]).toEqual({ type: 'wait' });
  });

  it('页面刷新后新实例自动复原会话与完整动作链', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    const c1 = new TelemetryController({ storage, backend });
    await c1.init();
    c1.startSession(verifiedMeta, verifiedStart);
    c1.recordReplayAction({ type: 'buy', cardIndex: 0, leverage: false });
    c1.recordReplayAction({ type: 'wait' });
    c1.recordReplayAction({ type: 'sell', slotIndex: 0 });

    // 模拟页面刷新：创建全新 controller 实例（共享同一 storage）
    const c2 = new TelemetryController({ storage, backend });
    await c2.init();
    expect(c2.getActiveSessionId()).toBe('sess-persist-1');

    // 即使云端重播列表落后（仅 1 步），resumeVerifiedSession 也优先保留本地完整的 3 步动作
    c2.resumeVerifiedSession(verifiedMeta, verifiedStart, [{ type: 'buy', cardIndex: 0, leverage: false }], {
      rounds: 3,
      final_score: 100,
      margin_call_count: 0,
    });

    // 增量记录第 4 步动作
    c2.recordReplayAction({ type: 'wait' });

    const persisted = JSON.parse(storage.getItem('jiazi_active_verified_session')!);
    expect(persisted.replayActions).toHaveLength(4);
    expect(persisted.replayActions[2]).toEqual({ type: 'sell', slotIndex: 0 });
    expect(persisted.replayActions[3]).toEqual({ type: 'wait' });
  });

  it('endSession 正常终局或放弃时清理本地持久化会话', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    const controller = new TelemetryController({ storage, backend });
    await controller.init();
    controller.startSession(verifiedMeta, verifiedStart);
    expect(storage.getItem('jiazi_active_verified_session')).toBeTruthy();

    controller.endSession({
      reason: 'game_over',
      rounds: 60,
      final_score: 500,
      margin_call_count: 0,
    });

    expect(controller.getActiveSessionId()).toBeNull();
    expect(storage.getItem('jiazi_active_verified_session')).toBeNull();
  });
});

describe('双设备动作链冲突检测与合并机制 (Dual-Device Conflict Detection)', () => {
  const verifiedMeta: ActiveSessionMeta = {
    rules_version: '7',
    game_mode: 'volatility_trade',
    volatility_enabled: true,
  };

  const verifiedStart: VerifiedSessionStart = {
    session_id: 'sess-conflict-1',
    client_session_id: 'client-sess-conflict-1',
    started_at: '2026-08-28T00:00:00.000Z',
    seed: 12345,
    rules_snapshot: cloneReplayRulesSnapshot(CURRENT_REPLAY_RULES),
  };

  it('mergeActionChains: 相同前缀且本地更全时合并为 local', () => {
    const local = [
      { type: 'buy', cardIndex: 0, leverage: false },
      { type: 'wait' },
    ] as const;
    const cloud = [{ type: 'buy', cardIndex: 0, leverage: false }] as const;

    const res = mergeActionChains(local, cloud);
    expect(res.type).toBe('match');
    if (res.type === 'match') {
      expect(res.source).toBe('local');
      expect(res.actions).toHaveLength(2);
    }
  });

  it('mergeActionChains: 相同前缀且云端更全时合并为 cloud', () => {
    const local = [{ type: 'buy', cardIndex: 0, leverage: false }] as const;
    const cloud = [
      { type: 'buy', cardIndex: 0, leverage: false },
      { type: 'sell', slotIndex: 0 },
    ] as const;

    const res = mergeActionChains(local, cloud);
    expect(res.type).toBe('match');
    if (res.type === 'match') {
      expect(res.source).toBe('cloud');
      expect(res.actions).toHaveLength(2);
    }
  });

  it('mergeActionChains: 动作在同位置分叉时精准检测 conflict', () => {
    const local = [
      { type: 'buy', cardIndex: 0, leverage: false },
      { type: 'wait' },
    ] as const;
    const cloud = [
      { type: 'buy', cardIndex: 0, leverage: false },
      { type: 'sell', slotIndex: 0 },
    ] as const;

    const res = mergeActionChains(local, cloud);
    expect(res.type).toBe('conflict');
    if (res.type === 'conflict') {
      expect(res.divergedAt).toBe(1);
      expect(res.localAction).toEqual({ type: 'wait' });
      expect(res.cloudAction).toEqual({ type: 'sell', slotIndex: 0 });
    }
  });

  it('resumeVerifiedSession: 遭遇双设备分叉时返回 false 并设置明确冲突错误', async () => {
    const storage = new MemoryStorage();
    seedIdentity(storage, true);
    const backend = createBackend();
    const controller = new TelemetryController({ storage, backend });
    await controller.init();

    // 假设本地先前执行了 [Buy(0), Wait]
    storage.setItem(
      'jiazi_active_verified_session',
      JSON.stringify({
        session_id: 'sess-conflict-1',
        started_at: '2026-08-28T00:00:00.000Z',
        meta: verifiedMeta,
        verified: verifiedStart,
        replayActions: [
          { type: 'buy', cardIndex: 0, leverage: false },
          { type: 'wait' },
        ],
        playerId: 'player-1',
        progress: { rounds: 2, final_score: 50, margin_call_count: 0 },
      }),
    );

    // 重新初始化读取本地持久化
    const c2 = new TelemetryController({ storage, backend });
    await c2.init();

    // 云端传入了分叉的动作链 [Buy(0), Sell(0)]
    const cloudDivergedActions = [
      { type: 'buy', cardIndex: 0, leverage: false },
      { type: 'sell', slotIndex: 0 },
    ];

    const result = c2.resumeVerifiedSession(verifiedMeta, verifiedStart, cloudDivergedActions, {
      rounds: 2,
      final_score: 60,
      margin_call_count: 0,
    });

    // 断言拒绝继续并标明冲突
    expect(result).toBe(false);
    expect(c2.getState().error).toContain('冲突');
  });
});
