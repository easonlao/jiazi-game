import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useGameStore, bindTurnManagerCallbacks, setTelemetryControllerForTesting } from '../../app/src/store';
import { TurnManager } from '../../src/core/TurnManager';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import { SeededRandomSource } from '../../src/core/RandomSource';
import { CLEAN_POOL_REPLAY_RULES } from '../../src/core/ReplayRules';
import { TelemetryController } from '../../app/src/lib/telemetryController';
import {
  readPendingTerminations,
  writePendingTermination,
} from '../../app/src/lib/pendingTerminationStorage';
import { buildCultivationProfileSnapshot } from '../../app/src/lib/cultivationProfile';

class LocalStorageMock {
  private store = new Map<string, string>();

  getItem(k: string) {
    return this.store.get(k) ?? null;
  }

  setItem(k: string, v: string) {
    this.store.set(k, v);
  }

  removeItem(k: string) {
    this.store.delete(k);
  }

  clear() {
    this.store.clear();
  }
}

const storage = new LocalStorageMock();
(globalThis as any).localStorage = storage;

describe('Issue 02: 处理跨设备终止冲突 (Cross-Device Termination Conflict)', () => {
  beforeEach(() => {
    storage.clear();
    setTelemetryControllerForTesting(null);
    useGameStore.setState({
      toast: null,
      pauseModalOpen: false,
      hasSave: false,
      gameState: 'init',
      telemetryState: null,
    });
  });

  afterEach(() => {
    setTelemetryControllerForTesting(null);
    useGameStore.setState({
      toast: null,
      pauseModalOpen: false,
      hasSave: false,
      gameState: 'init',
      telemetryState: null,
    });
  });

  it('跨设备冲突识别：设备 A 离线终止 vs 设备 B 在线推进新进度，终止同步识别冲突且不静默覆盖', async () => {
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-cross-1',
      public_player_id: 'pub-cross-1',
      public_code: 'CODE-CROSS-1',
      display_name: '双端修士',
    }));

    // 设备 A 在第 1 轮（1 步行动）时离线终止
    writePendingTermination(storage, {
      sessionId: 'sess-cross-conflict-101',
      playerId: 'player-cross-1',
      reason: 'voluntary_termination',
      roundsCompleted: 1,
      finalScore: 10,
      occurredAt: '2026-08-29T10:05:00.000Z',
      status: 'pending',
      clientActionCount: 1,
    });

    let upsertCalledWithAbandoned = false;
    const mockBackend = {
      ensureSession: async () => true,
      uploadEvents: async () => true,
      upsertSession: async (_playerId: string, payload: any) => {
        if (payload.status === 'abandoned') {
          upsertCalledWithAbandoned = true;
        }
      },
      // 设备 B 已经在线继续推进到第 3 轮（3 步行动）
      fetchActiveGameSession: async () => ({
        session_id: 'sess-cross-conflict-101',
        started_at: '2026-08-29T10:00:00.000Z',
        seed: 42,
        rules_snapshot: CLEAN_POOL_REPLAY_RULES,
        status: 'started' as const,
        rounds_completed: 3,
        final_score: 50,
        actions: [
          { type: 'wait' as const },
          { type: 'wait' as const },
          { type: 'wait' as const },
        ],
      }),
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
    };

    const controller = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(controller);
    await controller.init();

    // 1. 绝不静默覆盖云端已有的更新进度
    expect(upsertCalledWithAbandoned).toBe(false);

    // 2. 状态中记录了明确的冲突信息
    const conflict = controller.getState().terminationConflict;
    expect(conflict).not.toBeNull();
    expect(conflict?.sessionId).toBe('sess-cross-conflict-101');
    expect(conflict?.cloudSession.rounds_completed).toBe(3);
    expect(conflict?.localTermination.roundsCompleted).toBe(1);

    // 3. 本地待同步记录仍然安全保留
    expect(readPendingTerminations(storage, 'player-cross-1').length).toBe(1);
  });

  it('选择「继续最新云端对局」：撤销本机待同步终止，恢复云端最新对局继续游玩', async () => {
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-cross-1',
      public_player_id: 'pub-cross-1',
      public_code: 'CODE-CROSS-1',
      display_name: '双端修士',
    }));

    writePendingTermination(storage, {
      sessionId: 'sess-cross-conflict-101',
      playerId: 'player-cross-1',
      reason: 'voluntary_termination',
      roundsCompleted: 1,
      finalScore: 10,
      occurredAt: '2026-08-29T10:05:00.000Z',
      status: 'pending',
      clientActionCount: 1,
    });

    const mockBackend = {
      ensureSession: async () => true,
      uploadEvents: async () => true,
      upsertSession: async () => {},
      fetchActiveGameSession: async () => ({
        session_id: 'sess-cross-conflict-101',
        started_at: '2026-08-29T10:00:00.000Z',
        seed: 42,
        rules_snapshot: CLEAN_POOL_REPLAY_RULES,
        status: 'started' as const,
        rounds_completed: 3,
        final_score: 50,
        actions: [
          { type: 'wait' as const },
          { type: 'wait' as const },
          { type: 'wait' as const },
        ],
      }),
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
    };

    const controller = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(controller);
    await controller.init();

    // 确认冲突触发
    expect(controller.getState().terminationConflict).not.toBeNull();

    // 绑定 TurnManager
    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(42), {
      rulesVersion: 8,
      scoreRules: CLEAN_POOL_REPLAY_RULES.scoreRules,
      volatility: CLEAN_POOL_REPLAY_RULES.volatility,
      voidConfig: { voidCardCount: 2 },
    });
    await tm.initialize();
    bindTurnManagerCallbacks(tm, useGameStore.setState, () => useGameStore.getState());
    useGameStore.setState({ turnManager: tm });

    // 玩家在冲突弹窗中选择「继续最新云端对局」
    const resolved = await useGameStore.getState().resolveTerminationConflict('resume_cloud');
    expect(resolved).toBe(true);

    // 1. 本地待同步终止记录被撤销清除
    expect(readPendingTerminations(storage, 'player-cross-1').length).toBe(0);

    // 2. 冲突状态清空
    expect(controller.getState().terminationConflict).toBeNull();

    // 3. 游戏成功接续云端最新进度并进入游玩状态
    expect(useGameStore.getState().gameState).toBe('player_action');
    expect(useGameStore.getState().currentRound).toBe(4);
    expect(controller.getActiveSessionId()).toBe('sess-cross-conflict-101');
  });

  it('选择「确认终止最新对局」：以云端最新回合与分数落库 abandoned，账本恰好计入 1 次中断', async () => {
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-cross-1',
      public_player_id: 'pub-cross-1',
      public_code: 'CODE-CROSS-1',
      display_name: '双端修士',
    }));

    writePendingTermination(storage, {
      sessionId: 'sess-cross-conflict-101',
      playerId: 'player-cross-1',
      reason: 'voluntary_termination',
      roundsCompleted: 1,
      finalScore: 10,
      occurredAt: '2026-08-29T10:05:00.000Z',
      status: 'pending',
      clientActionCount: 1,
    });

    let finalizedPayload: any = null;
    let ledgerRecords: any[] = [];
    const mockBackend = {
      ensureSession: async () => true,
      uploadEvents: async () => true,
      upsertSession: async (playerId: string, payload: any) => {
        finalizedPayload = payload;
        if (payload.status === 'abandoned') {
          ledgerRecords = [{
            player_id: playerId,
            local_game_id: payload.session_id,
            game_session_id: payload.session_id,
            rules_version: 8,
            started_at: payload.started_at,
            ended_at: payload.ended_at,
            outcome: 'abandoned' as const,
            final_score: null,
            record_source: 'verified_session' as const,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }];
        }
      },
      fetchActiveGameSession: async () => ({
        session_id: 'sess-cross-conflict-101',
        started_at: '2026-08-29T10:00:00.000Z',
        seed: 42,
        rules_snapshot: CLEAN_POOL_REPLAY_RULES,
        status: 'started' as const,
        rounds_completed: 3,
        final_score: 50,
        actions: [
          { type: 'wait' as const },
          { type: 'wait' as const },
          { type: 'wait' as const },
        ],
      }),
      fetchCultivationLedger: async () => ({ records: ledgerRecords, summary: {} as any }),
      fetchLeaderboard: async () => [],
    };

    const controller = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(controller);
    await controller.init();

    expect(controller.getState().terminationConflict).not.toBeNull();

    // 玩家在冲突弹窗中选择「确认终止最新对局」
    const resolved = await useGameStore.getState().resolveTerminationConflict('terminate_latest');
    expect(resolved).toBe(true);

    // 1. 终态落库携带最新云端进度数据
    expect(finalizedPayload).not.toBeNull();
    expect(finalizedPayload.session_id).toBe('sess-cross-conflict-101');
    expect(finalizedPayload.status).toBe('abandoned');
    expect(finalizedPayload.rounds_completed).toBe(3);
    expect(finalizedPayload.final_score).toBe(50);

    // 2. 本地待同步记录清空，冲突状态解除
    expect(readPendingTerminations(storage, 'player-cross-1').length).toBe(0);
    expect(controller.getState().terminationConflict).toBeNull();

    // 3. 修行账本恰好计入 1 次 abandoned
    const profile = buildCultivationProfileSnapshot(
      useGameStore.getState().cultivationLedgerRecords,
      controller.getState().cultivationLedger?.records ?? null,
      8,
      true,
    );
    expect(profile.combinedSummary.abandonedGames).toBe(1);
  });

  it('受损局免惩罚恢复遇到跨设备更晚行动时，同样触发冲突决策，防止误删除另一设备的新进度', async () => {
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-cross-2',
      public_player_id: 'pub-cross-2',
      public_code: 'CODE-CROSS-2',
      display_name: '设备2修士',
    }));

    let upsertCalledWithCorrupted = false;
    const mockBackend = {
      ensureSession: async () => true,
      uploadEvents: async () => true,
      upsertSession: async (_playerId: string, payload: any) => {
        if (payload.status === 'corrupted_recovery') {
          upsertCalledWithCorrupted = true;
        }
      },
      // 云端在另一设备上已经正常推进到了第 5 回合
      fetchActiveGameSession: async () => ({
        session_id: 'sess-corrupted-conflict-202',
        started_at: '2026-08-29T10:00:00.000Z',
        seed: 42,
        rules_snapshot: CLEAN_POOL_REPLAY_RULES,
        status: 'started' as const,
        rounds_completed: 5,
        final_score: 120,
        actions: [
          { type: 'wait' as const },
          { type: 'wait' as const },
          { type: 'wait' as const },
          { type: 'wait' as const },
          { type: 'wait' as const },
        ],
      }),
      recoverCorruptedSession: async () => ({ success: true }),
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
    };

    const controller = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(controller);
    await controller.init();

    // 本机在第 1 轮（1 步行动）时发生受损异常
    (controller as any).session = {
      session_id: 'sess-corrupted-conflict-202',
      client_session_id: 'client-sess-202',
      started_at: '2026-08-29T10:00:00.000Z',
      meta: {} as any,
      verified: null,
      playerId: 'player-cross-2',
      replayActions: [{ type: 'wait' as const }],
      ended: false,
    };
    (controller as any).sessionProgress = { rounds: 1, final_score: 10, margin_call_count: 0 };

    // 本机尝试对该 session 执行免惩罚受损恢复（例如由于本地旧坏档重放错误）
    const ok = await controller.discardSessionWithoutPenalty('corrupted_recovery', 'sess-corrupted-conflict-202');

    // 关键断言 1：不能直接成功落库 corrupted_recovery 并删除云端新进度
    expect(ok).toBe(false);
    expect(upsertCalledWithCorrupted).toBe(false);

    // 关键断言 2：触发跨设备冲突状态
    const conflict = controller.getState().terminationConflict;
    expect(conflict).not.toBeNull();
    expect(conflict?.sessionId).toBe('sess-corrupted-conflict-202');
    expect(conflict?.cloudSession.rounds_completed).toBe(5);
  });

  it('历史口径保护：历史已确认的 abandoned 记录保持原样，系统只对明确受损会话免惩罚，不进行猜测性批量改写', async () => {
    // 模拟云端历史账本中包含 2 条真实主动放弃历史和 1 条已完成记录
    const historicalLedgerEntries = [
      {
        player_id: 'player-cross-3',
        local_game_id: 'legacy-abandon-1',
        game_session_id: 'legacy-abandon-1',
        rules_version: 7,
        started_at: '2026-08-20T10:00:00.000Z',
        ended_at: '2026-08-20T10:05:00.000Z',
        outcome: 'abandoned' as const,
        final_score: null,
        record_source: 'verified_session' as const,
        created_at: '2026-08-20T10:05:00.000Z',
        updated_at: '2026-08-20T10:05:00.000Z',
      },
      {
        player_id: 'player-cross-3',
        local_game_id: 'legacy-abandon-2',
        game_session_id: 'legacy-abandon-2',
        rules_version: 7,
        started_at: '2026-08-21T10:00:00.000Z',
        ended_at: '2026-08-21T10:08:00.000Z',
        outcome: 'abandoned' as const,
        final_score: null,
        record_source: 'verified_session' as const,
        created_at: '2026-08-21T10:08:00.000Z',
        updated_at: '2026-08-21T10:08:00.000Z',
      },
      {
        player_id: 'player-cross-3',
        local_game_id: 'legacy-complete-1',
        game_session_id: 'legacy-complete-1',
        rules_version: 7,
        started_at: '2026-08-22T10:00:00.000Z',
        ended_at: '2026-08-22T10:30:00.000Z',
        outcome: 'completed' as const,
        final_score: 2500,
        record_source: 'verified_session' as const,
        created_at: '2026-08-22T10:30:00.000Z',
        updated_at: '2026-08-22T10:30:00.000Z',
      },
    ];

    const profile = buildCultivationProfileSnapshot(
      [],
      historicalLedgerEntries as any,
      8,
      true,
    );

    // 关键断言：历史中断记录原样保留
    expect(profile.combinedSummary.abandonedGames).toBe(2);
    expect(profile.combinedSummary.completedGames).toBe(1);
    expect(profile.perseverance.abandonedGames).toBe(2);
    expect(profile.perseverance.completedGames).toBe(1);
  });

  it('开始页直接放弃云端活跃局：未进入对局时，正确继承云端进度与序号，不误判冲突并顺利落库 abandoned', async () => {
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-cross-start',
      public_player_id: 'pub-cross-start',
      public_code: 'CODE-CROSS-START',
      display_name: '开始页修士',
    }));

    let upsertPayload: any = null;
    const mockBackend = {
      ensureSession: async () => true,
      uploadEvents: async () => true,
      upsertSession: async (_playerId: string, payload: any) => {
        upsertPayload = payload;
      },
      fetchActiveGameSession: async () => ({
        session_id: 'sess-start-screen-abandon',
        client_session_id: 'client-start-screen-abandon',
        started_at: '2026-08-29T10:00:00.000Z',
        seed: 42,
        rules_snapshot: CLEAN_POOL_REPLAY_RULES,
        status: 'started' as const,
        rounds_completed: 4,
        final_score: 80,
        actions: [
          { type: 'wait' as const },
          { type: 'wait' as const },
          { type: 'wait' as const },
          { type: 'wait' as const },
        ],
      }),
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
    };

    const controller = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(controller);
    await controller.init();

    // 此时玩家在开始页（controller.session 为 null，但存在 activeCloudSession）
    expect(controller.getState().activeCloudSession).not.toBeNull();
    expect(controller.getState().activeCloudSession?.rounds_completed).toBe(4);

    // 玩家在开始页点击主动放弃 / 开新局覆盖该旧云端局
    controller.abandonSession('new_game_override');
    await controller.syncPendingTerminations();

    // 关键断言 1：未误触发跨设备冲突弹窗
    expect(controller.getState().terminationConflict).toBeNull();

    // 关键断言 2：正确继承了云端第 4 轮与预期序号 4，成功落库 abandoned
    expect(upsertPayload).not.toBeNull();
    expect(upsertPayload.session_id).toBe('sess-start-screen-abandon');
    expect(upsertPayload.status).toBe('abandoned');
    expect(upsertPayload.rounds_completed).toBe(4);
    expect(upsertPayload.final_score).toBe(80);
    expect(upsertPayload.expected_session_revision ?? upsertPayload.expected_last_event_sequence).toBe(4);

    // 关键断言 3：pending 待同步队列已清空
    expect(readPendingTerminations(storage, 'player-cross-start').length).toBe(0);
  });

  it('并发竞态保护：预检后另一设备并发写入新行动，RPC 返回 40900/conflict，客户端挂起冲突且不静默覆盖', async () => {
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-cross-race',
      public_player_id: 'pub-cross-race',
      public_code: 'CODE-CROSS-RACE',
      display_name: '竞态修士',
    }));

    // 本机离线时记录的待同步记录（当时预期最大 sequence 为 2）
    writePendingTermination(storage, {
      sessionId: 'sess-cross-race-303',
      playerId: 'player-cross-race',
      reason: 'voluntary_termination',
      roundsCompleted: 2,
      finalScore: 20,
      occurredAt: '2026-08-29T10:05:00.000Z',
      status: 'pending',
      clientActionCount: 2,
      expectedLastEventSequence: 2,
    });

    let currentCloudActions = 2;
    const mockBackend = {
      ensureSession: async () => true,
      uploadEvents: async () => true,
      fetchActiveGameSession: async () => ({
        session_id: 'sess-cross-race-303',
        started_at: '2026-08-29T10:00:00.000Z',
        seed: 42,
        rules_snapshot: CLEAN_POOL_REPLAY_RULES,
        status: 'started' as const,
        rounds_completed: currentCloudActions === 2 ? 2 : 4,
        final_score: 50,
        actions: Array(currentCloudActions).fill({ type: 'wait' as const }),
      }),
      upsertSession: async (_playerId: string, payload: any) => {
        // 模拟：在客户端 fetchActiveGameSession 预检刚通过后，另一设备并发向数据库写入了 sequence 3 & 4
        // 导致 RPC 事务在执行行级锁时发现 max(sequence) = 4 > expectedLastEventSequence(2)
        currentCloudActions = 4;
        const err: any = new Error('conflict: newer events exist (expected 2, actual 4)');
        err.code = '40900';
        err.isConflict = true;
        throw err;
      },
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
    };

    const controller = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(controller);
    await controller.init();

    // 触发同步
    await controller.syncPendingTerminations();

    // 关键断言 1：并发冲突被捕获，挂起为 terminationConflict
    const conflict = controller.getState().terminationConflict;
    expect(conflict).not.toBeNull();
    expect(conflict?.sessionId).toBe('sess-cross-race-303');
    expect(conflict?.cloudSession.rounds_completed).toBe(4);

    // 关键断言 2：本地 pending 记录仍然安全保留，未静默丢失
    expect(readPendingTerminations(storage, 'player-cross-race').length).toBe(1);
  });

  it('云端 revision 更高但回合与动作数未变：syncPendingTerminations 严格校验 expectedSessionRevision，拦截并触发冲突弹窗，绝不静默覆盖', async () => {
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-rev-only-conflict',
      public_player_id: 'pub-rev-only',
      public_code: 'CODE-REV-ONLY',
      display_name: '版本冲突修士',
    }));

    // 本机离线时记录的待终止记录（回合 2，动作 2，expectedSessionRevision: 2）
    writePendingTermination(storage, {
      sessionId: 'sess-rev-only-505',
      playerId: 'player-rev-only-conflict',
      reason: 'voluntary_termination',
      roundsCompleted: 2,
      finalScore: 20,
      occurredAt: '2026-08-29T10:05:00.000Z',
      status: 'pending',
      clientActionCount: 2,
      expectedSessionRevision: 2,
      expectedLastEventSequence: 2,
    });

    let upsertCalled = false;
    const mockBackend = {
      ensureSession: async () => true,
      uploadEvents: async () => [{ session_id: 'sess-rev-only-505', session_revision: 5, inserted_count: 1 }],
      // 云端返回：回合数=2，动作数=2（完全相同），但云端 session_revision=5（例如有其他元数据或系统事件写入）
      fetchActiveGameSession: async () => ({
        session_id: 'sess-rev-only-505',
        started_at: '2026-08-29T10:00:00.000Z',
        seed: 42,
        rules_snapshot: CLEAN_POOL_REPLAY_RULES,
        status: 'started' as const,
        rounds_completed: 2,
        final_score: 20,
        actions: [{ type: 'wait' as const }, { type: 'wait' as const }],
        session_revision: 5,
      }),
      upsertSession: async () => {
        upsertCalled = true;
      },
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
    };

    const controller = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(controller);
    await controller.init();

    // 触发同步
    await controller.syncPendingTerminations();

    // 关键断言 1：尽管回合/动作数相同，但因 cloudRevision(5) > expectedRevision(2)，触发了跨设备冲突弹窗！
    const conflict = controller.getState().terminationConflict;
    expect(conflict).not.toBeNull();
    expect(conflict?.sessionId).toBe('sess-rev-only-505');
    expect(conflict?.cloudSession.session_revision).toBe(5);

    // 关键断言 2：绝没有静默调用 upsertSession 覆盖云端！
    expect(upsertCalled).toBe(false);

    // 关键断言 3：pending 待同步记录完整保留在本地
    expect(readPendingTerminations(storage, 'player-rev-only-conflict').length).toBe(1);
  });

  it('远端新增非回合事件 -> 本端上传本地终止事件 -> 因果版本不被上传回调覆盖并严格弹冲突', async () => {
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-remote-bump',
      public_player_id: 'pub-remote-bump',
      public_code: 'CODE-REMOTE-BUMP',
      display_name: '远端推进修士',
    }));

    let upsertCalled = false;
    let cloudRevision = 3; // 远端写入了非回合事件（如 action_lock），推动云端 revision 到 3

    const mockBackend = {
      ensureSession: async () => true,
      uploadEvents: async () => {
        // 本地上传本地终止事件，服务端插入后 revision 变为 4
        cloudRevision = 4;
        return [{ session_id: 'sess-remote-bump-606', session_revision: 4, inserted_count: 1 }];
      },
      fetchActiveGameSession: async () => ({
        session_id: 'sess-remote-bump-606',
        started_at: '2026-08-29T10:00:00.000Z',
        seed: 42,
        rules_snapshot: CLEAN_POOL_REPLAY_RULES,
        status: 'started' as const,
        rounds_completed: 1,
        final_score: 10,
        actions: [{ type: 'wait' as const }],
        session_revision: cloudRevision,
      }),
      upsertSession: async () => {
        upsertCalled = true;
      },
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
    };

    const controller = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(controller);
    await controller.init();
    controller.setTelemetryEnabled(true);

    // 1. 本地从 revision=2 开始会话
    controller.resumeVerifiedSession(
      { rules_version: '8', game_mode: 'volatility_trade', volatility_enabled: true },
      {
        session_id: 'sess-remote-bump-606',
        client_session_id: 'client-bump-606',
        started_at: '2026-08-29T10:00:00.000Z',
        seed: 42,
        rules_snapshot: CLEAN_POOL_REPLAY_RULES,
        session_revision: 2,
      },
      [{ type: 'wait' as const }],
      { rounds: 1, final_score: 10, margin_call_count: 0 },
    );

    // 2. 本端决定主动终止
    controller.abandonSession('voluntary_termination');

    // 3. 验证 pending 记录记录了因果版本 expectedSessionRevision = 2
    const pendingList = readPendingTerminations(storage, 'player-remote-bump');
    expect(pendingList[0].expectedSessionRevision).toBe(2);

    // 4. 同步终止记录：尽管 uploadEvents 触发了回调，pending 记录的 expectedSessionRevision 绝不能被覆盖成 4！
    await controller.syncPendingTerminations();

    // 关键断言 1：pending 记录仍然保持因果版本 2
    expect(readPendingTerminations(storage, 'player-remote-bump')[0].expectedSessionRevision).toBe(2);

    // 关键断言 2：因为 cloudRevision (4) > expectedRevision (2)，触发冲突弹窗！
    const conflict = controller.getState().terminationConflict;
    expect(conflict).not.toBeNull();
    expect(conflict?.sessionId).toBe('sess-remote-bump-606');

    // 关键断言 3：绝没有静默覆盖云端
    expect(upsertCalled).toBe(false);
  });

  it('受损局冲突选择「安全重置」：走服务端重放验证并写入 corrupted_recovery，绝不转为 abandoned', async () => {
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-cross-reset',
      public_player_id: 'pub-cross-reset',
      public_code: 'CODE-CROSS-RESET',
      display_name: '重置修士',
    }));

    let recoverCorruptedCalled = false;
    let upsertAbandonedCalled = false;
    const mockBackend = {
      ensureSession: async () => true,
      uploadEvents: async () => true,
      upsertSession: async (_playerId: string, payload: any) => {
        if (payload.status === 'abandoned') {
          upsertAbandonedCalled = true;
        }
      },
      fetchActiveGameSession: async () => ({
        session_id: 'sess-corrupted-conflict-404',
        started_at: '2026-08-29T10:00:00.000Z',
        seed: 42,
        rules_snapshot: CLEAN_POOL_REPLAY_RULES,
        status: 'started' as const,
        rounds_completed: 3,
        final_score: 30,
        actions: [{ type: 'wait' as const }, { type: 'wait' as const }, { type: 'wait' as const }],
      }),
      recoverCorruptedSession: async (sessionId: string) => {
        if (sessionId === 'sess-corrupted-conflict-404') {
          recoverCorruptedCalled = true;
          return { success: true };
        }
        return { success: false, error: 'invalid' };
      },
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
    };

    const controller = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(controller);
    await controller.init();

    // 本机在第 1 轮（1 步行动）时发生受损
    (controller as any).session = {
      session_id: 'sess-corrupted-conflict-404',
      client_session_id: 'client-sess-404',
      started_at: '2026-08-29T10:00:00.000Z',
      meta: {} as any,
      verified: null,
      playerId: 'player-cross-reset',
      replayActions: [{ type: 'wait' as const }],
      ended: false,
    };
    (controller as any).sessionProgress = { rounds: 1, final_score: 10, margin_call_count: 0 };

    // 触发受损恢复冲突
    await controller.discardSessionWithoutPenalty('corrupted_recovery', 'sess-corrupted-conflict-404');
    expect(controller.getState().terminationConflict).not.toBeNull();
    expect(controller.getState().terminationConflict?.kind).toBe('corrupted_recovery');

    // 玩家选择「安全重置该对局（免惩罚）」
    const resolved = await useGameStore.getState().resolveTerminationConflict('reset_corrupted');
    expect(resolved).toBe(true);

    // 关键断言 1：调用了服务端受损验证接口
    expect(recoverCorruptedCalled).toBe(true);

    // 关键断言 2：绝对没有落库为 abandoned
    expect(upsertAbandonedCalled).toBe(false);

    // 关键断言 3：冲突解除，状态清空
    expect(controller.getState().terminationConflict).toBeNull();
  });

  it('口径对齐回归：包含 session_start 与 round_settled 的完整事件流，放弃时携带最新序号且无假冲突', async () => {
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-seq-align',
      public_player_id: 'pub-seq-align',
      public_code: 'CODE-SEQ-ALIGN',
      display_name: '序列对齐修士',
    }));

    let capturedUpsertPayload: any = null;
    const mockBackend = {
      ensureSession: async () => true,
      uploadEvents: async () => true,
      upsertSession: async (_playerId: string, payload: any) => {
        capturedUpsertPayload = payload;
      },
      fetchActiveGameSession: async () => null,
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
    };

    const controller = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(controller);
    await controller.init();
    controller.setTelemetryEnabled(true);

    // 开启会话（产生 session_start 事件，sequence 0）
    const started = controller.startSession({
      rules_version: '8',
      game_mode: 'volatility_trade',
      volatility_enabled: true,
    }, {
      session_id: 'sess-seq-101',
      started_at: '2026-08-29T10:00:00.000Z',
      seed: 42,
      rules_snapshot: CLEAN_POOL_REPLAY_RULES,
    });
    expect(started).toBe(true);

    // 模拟行动事件 (action_wait, sequence 1) 与回合结算事件 (round_settled, sequence 2)
    const t1 = controller.track('action_wait', {
      session_id: 'sess-seq-101',
      round: 1,
      season: 'spring',
      qi_before: 20,
      qi_after: 25,
      score_before: 0,
      score_after: 0,
      leverage_multiplier: 1,
      public_context: [],
      hand_context: [],
      ends_game: false,
      replay_action: { type: 'wait' },
    });
    expect(t1).toBe(true);

    const t2 = controller.track('round_settled', {
      session_id: 'sess-seq-101',
      round: 1,
      season: 'spring',
      hold_earnings: 10,
      hold_qi_cost: 0,
      base_qi_recover: 5,
      wait_qi_recover: 0,
      margin_call_triggered: false,
      margin_call_count: 0,
      qi_after: 25,
      score_after: 10,
    });
    expect(t2).toBe(true);

    // 主动终止
    controller.abandonSession('voluntary_termination');
    const pendingList = readPendingTerminations(storage, 'player-seq-align');
    // 离线/未同步状态下，expectedSessionRevision 严格取最后一次服务端确认的 revision (0)，不本地自增冒充
    expect(pendingList[0]?.expectedSessionRevision).toBe(0);
    await controller.syncPendingTerminations();

    expect(capturedUpsertPayload).not.toBeNull();
    expect(capturedUpsertPayload.status).toBe('abandoned');
    expect(capturedUpsertPayload.expected_session_revision).toBe(0);
  });

  it('跨设备会话版本贯穿：拉取云端会话(revision=7) -> 续局 -> 本地持久化 -> 离线终止 -> 携带云端 revision=7 成功同步', async () => {
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-cross-rev',
      public_player_id: 'pub-cross-rev',
      public_code: 'CODE-CROSS-REV',
      display_name: '版本贯穿修士',
    }));

    let syncedPayload: any = null;
    const mockCloudSession = {
      session_id: 'sess-cloud-rev-7',
      client_session_id: 'client-rev-7',
      started_at: '2026-08-29T10:00:00.000Z',
      seed: 42,
      rules_snapshot: CLEAN_POOL_REPLAY_RULES,
      actions: [{ type: 'wait' }, { type: 'wait' }] as any,
      rounds_completed: 2,
      final_score: 20,
      session_revision: 7,
    };

    const mockBackend = {
      ensureSession: async () => true,
      uploadEvents: async () => true,
      upsertSession: async (_playerId: string, payload: any) => {
        syncedPayload = payload;
      },
      fetchActiveGameSession: async () => mockCloudSession,
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
    };

    const controller = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(controller);
    await controller.init();
    controller.setTelemetryEnabled(true);

    // 1. 模拟续局：从云端拉取 revision=7 的会话
    const resumeOk = controller.resumeVerifiedSession(
      { rules_version: '8', game_mode: 'volatility_trade', volatility_enabled: true },
      {
        session_id: mockCloudSession.session_id,
        client_session_id: mockCloudSession.client_session_id,
        started_at: mockCloudSession.started_at,
        seed: mockCloudSession.seed,
        rules_snapshot: mockCloudSession.rules_snapshot,
        session_revision: mockCloudSession.session_revision,
      },
      mockCloudSession.actions,
      { rounds: 2, final_score: 20, margin_call_count: 0 },
    );
    expect(resumeOk).toBe(true);

    // 2. 验证本地持久化已记录 sessionRevision=7
    const persisted = JSON.parse(storage.getItem('jiazi_active_verified_session') || '{}');
    expect(persisted.sessionRevision).toBe(7);

    // 3. 玩家主动终止
    controller.abandonSession('voluntary_termination');

    // 4. 验证待同步记录中保存了 expectedSessionRevision=7
    const pendingList = JSON.parse(storage.getItem('jiazi_pending_terminations') || '{}')['player-cross-rev'];
    expect(pendingList[0].expectedSessionRevision ?? pendingList[0].expectedLastEventSequence).toBe(7);

    // 5. 同步至云端
    await controller.syncPendingTerminations();
    expect(syncedPayload).not.toBeNull();
    expect(syncedPayload.expected_session_revision).toBe(7);
  });

  it('续局完整持久化回归：续局 -> 记录动作 -> 刷新实例 -> 终止，sessionRevision 依然保持 7，不被本地中间写操作清空退回 0', async () => {
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-persist-flow',
      public_player_id: 'pub-persist-flow',
      public_code: 'CODE-PERSIST-FLOW',
      display_name: '持久化流修士',
    }));

    let syncedPayload: any = null;
    const mockCloudSession = {
      session_id: 'sess-cloud-rev-persist',
      client_session_id: 'client-rev-persist',
      started_at: '2026-08-29T10:00:00.000Z',
      seed: 42,
      rules_snapshot: CLEAN_POOL_REPLAY_RULES,
      actions: [{ type: 'wait' }] as any,
      rounds_completed: 1,
      final_score: 10,
      session_revision: 7,
    };

    const mockBackend = {
      ensureSession: async () => true,
      uploadEvents: async () => true,
      upsertSession: async (_playerId: string, payload: any) => {
        syncedPayload = payload;
      },
      fetchActiveGameSession: async () => mockCloudSession,
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
    };

    const c1 = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(c1);
    await c1.init();
    c1.setTelemetryEnabled(true);

    // 1. 续局继承 revision=7
    c1.resumeVerifiedSession(
      { rules_version: '8', game_mode: 'volatility_trade', volatility_enabled: true },
      {
        session_id: mockCloudSession.session_id,
        client_session_id: mockCloudSession.client_session_id,
        started_at: mockCloudSession.started_at,
        seed: mockCloudSession.seed,
        rules_snapshot: mockCloudSession.rules_snapshot,
        session_revision: 7,
      },
      mockCloudSession.actions,
      { rounds: 1, final_score: 10, margin_call_count: 0 },
    );

    // 2. 本地记录动作与刷新进度
    c1.recordReplayAction({ type: 'buy', cardIndex: 0, leverage: false });
    c1.updateSessionProgress({ rounds: 2, final_score: 25, margin_call_count: 0 });

    // 3. 验证 persistCurrentSession 没有把 sessionRevision 冲掉
    const rawSaved = JSON.parse(storage.getItem('jiazi_active_verified_session') || '{}');
    expect(rawSaved.sessionRevision).toBe(7);

    // 4. 模拟页面刷新（实例化全新 c2）
    const c2 = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(c2);
    await c2.init();
    c2.setTelemetryEnabled(true);

    // 5. 再次触发动作并主动终止
    c2.recordReplayAction({ type: 'wait' });
    c2.abandonSession('voluntary_termination');

    // 6. 验证待同步记录与同步至服务端的 expected_session_revision 依然是 7
    const pendingList = readPendingTerminations(storage, 'player-persist-flow');
    expect(pendingList[0]?.expectedSessionRevision).toBe(7);

    await c2.syncPendingTerminations();
    expect(syncedPayload).not.toBeNull();
    expect(syncedPayload.expected_session_revision).toBe(7);
  });

  it('防伪安全闸门：已 abandoned 或 completed 的对局，技术恢复接口明确拒绝 409', async () => {
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-guard',
      public_player_id: 'pub-guard',
      public_code: 'CODE-GUARD',
      display_name: '防伪修士',
    }));

    const mockBackend = {
      ensureSession: async () => true,
      uploadEvents: async () => true,
      upsertSession: async () => {},
      fetchActiveGameSession: async () => null,
      recoverCorruptedSession: async (_sessionId: string) => {
        // 服务端拒绝已终结会话
        return {
          success: false,
          error: 'session_already_finalized: status is abandoned',
          isConflict: true,
        };
      },
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
    };

    const controller = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(controller);
    await controller.init();

    const ok = await controller.discardSessionWithoutPenalty('corrupted_recovery', 'sess-abandoned-guard');
    expect(ok).toBe(false);
  });
});
