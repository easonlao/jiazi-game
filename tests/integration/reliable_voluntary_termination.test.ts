import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useGameStore, bindTurnManagerCallbacks, setTelemetryControllerForTesting } from '../../app/src/store';
import { TurnManager } from '../../src/core/TurnManager';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import { SeededRandomSource } from '../../src/core/RandomSource';
import { CURRENT_REPLAY_RULES } from '../../src/core/ReplayRules';
import { TelemetryController } from '../../app/src/lib/telemetryController';
import {
  readPendingTerminations,
  writePendingTermination,
  clearPendingTerminations,
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

describe('Issue 01: 可靠同步主动终止 (Reliable Voluntary Termination Sync)', () => {
  beforeEach(() => {
    storage.clear();
    setTelemetryControllerForTesting(null);
    useGameStore.setState({ toast: null, pauseModalOpen: false, hasSave: false, gameState: 'init' });
  });

  afterEach(() => {
    setTelemetryControllerForTesting(null);
    useGameStore.setState({ toast: null, pauseModalOpen: false, hasSave: false, gameState: 'init' });
  });

  it('断网主动终止：本地立即退出且存档清除，生成绑定玩家与会话的待同步意图，档案不提前计入中断', async () => {
    let upsertAttempts = 0;
    const mockBackend = {
      ensureSession: async () => true,
      uploadEvents: async () => true,
      upsertSession: async () => {
        upsertAttempts++;
        throw new Error('Network offline');
      },
      fetchActiveGameSession: async () => null,
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
      provision: async () => ({
        player_id: 'player-offline-1',
        public_player_id: 'pub-1',
        public_code: 'CODE-1',
        display_name: '离线修士',
        recovery_code: 'REC-1',
        leaderboard_eligible: true,
      }),
      recoverIdentity: async () => null,
      updateDisplayName: async () => null,
      startVerifiedSession: async () => ({
        session_id: 'sess-offline-101',
        started_at: '2026-08-29T10:00:00.000Z',
        seed: 42,
        rules_snapshot: CURRENT_REPLAY_RULES,
      }),
      submitVerifiedScore: async () => ({ verified: false, score: null, leaderboard_submitted: false }),
      claimLegacyRecords: async () => null,
    };

    const controller = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(controller);
    await controller.grantConsent();

    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(42), {
      rulesVersion: CURRENT_REPLAY_RULES.rulesVersion,
      scoreRules: CURRENT_REPLAY_RULES.scoreRules,
      volatility: CURRENT_REPLAY_RULES.volatility,
      voidConfig: { voidCardCount: CURRENT_REPLAY_RULES.voidCardCount },
    });
    await tm.initialize();
    bindTurnManagerCallbacks(tm, useGameStore.setState, () => useGameStore.getState());
    useGameStore.setState({ turnManager: tm });

    // 开始一局已立档在线对局
    await useGameStore.getState().startGame(false);
    expect(useGameStore.getState().gameState).toBe('player_action');
    expect(controller.getActiveSessionId()).toBe('sess-offline-101');

    // 执行 1 步并暂停
    useGameStore.getState().requestWaitPreview();
    useGameStore.getState().confirmSettlementPreview();
    useGameStore.getState().pauseGame();
    expect(useGameStore.getState().hasSave).toBe(true);

    // 玩家主动终止对局（离线网络失败）
    useGameStore.getState().terminateGame('voluntary_termination');

    // 1. 本地立即退出并清除存档
    expect(useGameStore.getState().gameState).toBe('init');
    expect(useGameStore.getState().hasSave).toBe(false);
    expect(storage.getItem('jiazi_game_save')).toBeNull();
    expect(controller.getActiveSessionId()).toBeNull();

    // 2. 持久化记录中生成了该玩家的待同步意图
    const pendingList = readPendingTerminations(storage, 'player-offline-1');
    expect(pendingList.length).toBe(1);
    expect(pendingList[0]).toMatchObject({
      sessionId: 'sess-offline-101',
      playerId: 'player-offline-1',
      reason: 'voluntary_termination',
      roundsCompleted: 1,
      status: 'pending',
    });

    // 3. 修行档案云端确认前，不计入已确认中断或坚持度扣分
    const profile = buildCultivationProfileSnapshot(
      useGameStore.getState().cultivationLedgerRecords,
      controller.getState().cultivationLedger?.records ?? null,
      8,
      true,
    );
    expect(profile.combinedSummary.abandonedGames).toBe(0);
    expect(profile.combinedSummary.completedGames).toBe(0);
  });

  it('刷新页面后重试保护：云端返回活跃局但本地已有待同步终止意图时，同一设备不展示继续游戏', async () => {
    // 写入玩家身份与离线待同步记录
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-offline-1',
      public_player_id: 'pub-1',
      public_code: 'CODE-1',
      display_name: '离线修士',
    }));
    writePendingTermination(storage, {
      sessionId: 'sess-offline-101',
      playerId: 'player-offline-1',
      reason: 'voluntary_termination',
      roundsCompleted: 1,
      finalScore: 0,
      occurredAt: new Date().toISOString(),
      status: 'pending',
    });

    const mockBackend = {
      ensureSession: async () => true,
      upsertSession: async () => {
        throw new Error('Still offline');
      },
      // 云端尚不知晓终止，依然返回 started 的活跃局
      fetchActiveGameSession: async () => ({
        session_id: 'sess-offline-101',
        started_at: '2026-08-29T10:00:00.000Z',
        seed: 42,
        rules_snapshot: CURRENT_REPLAY_RULES,
        status: 'started' as const,
        rounds_completed: 1,
        final_score: 0,
        actions: [{ type: 'wait' as const }],
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

    // 关键断言：即使云端返回了活跃局，但由于本地已有针对该局的待同步终止意图，activeCloudSession 必须为 null
    expect(controller.getState().activeCloudSession).toBeNull();
  });

  it('网络恢复自动重试：调用后端落库为 abandoned，待同步记录清空，账本恰好计入 1 次中断', async () => {
    let upsertPayload: any = null;
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-29T10:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-offline-1',
      public_player_id: 'pub-1',
      public_code: 'CODE-1',
      display_name: '离线修士',
    }));
    writePendingTermination(storage, {
      sessionId: 'sess-offline-101',
      playerId: 'player-offline-1',
      reason: 'voluntary_termination',
      roundsCompleted: 1,
      finalScore: 0,
      occurredAt: new Date().toISOString(),
      status: 'pending',
    });

    let ledgerRecords: any[] = [];
    const mockBackend = {
      ensureSession: async () => true,
      upsertSession: async (playerId: string, payload: any) => {
        upsertPayload = payload;
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
      fetchActiveGameSession: async () => null,
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

    // 1. 同步成功，upsertSession 携带 abandoned
    expect(upsertPayload).not.toBeNull();
    expect(upsertPayload.session_id).toBe('sess-offline-101');
    expect(upsertPayload.status).toBe('abandoned');

    // 2. 本地待同步记录清空
    expect(readPendingTerminations(storage, 'player-offline-1').length).toBe(0);

    // 3. 账本刷新后恰好计入 1 次 abandoned
    const profile = buildCultivationProfileSnapshot(
      useGameStore.getState().cultivationLedgerRecords,
      controller.getState().cultivationLedger?.records ?? null,
      8,
      true,
    );
    expect(profile.combinedSummary.abandonedGames).toBe(1);
    expect(profile.combinedSummary.completedGames).toBe(0);

    // 4. 重复调用 syncPendingTerminations 幂等无害
    upsertPayload = null;
    await controller.syncPendingTerminations();
    expect(upsertPayload).toBeNull();
  });

  it('跨玩家身份隔离：玩家 A 的待同步终止记录在切换为玩家 B 时绝不发送', async () => {
    writePendingTermination(storage, {
      sessionId: 'sess-a-999',
      playerId: 'player-A',
      reason: 'voluntary_termination',
      roundsCompleted: 3,
      finalScore: 15,
      occurredAt: new Date().toISOString(),
      status: 'pending',
    });

    const upsertedPlayers: string[] = [];
    const mockBackend = {
      ensureSession: async () => true,
      upsertSession: async (playerId: string) => {
        upsertedPlayers.push(playerId);
      },
      fetchActiveGameSession: async () => null,
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
      provision: async () => ({
        player_id: 'player-B',
        public_player_id: 'pub-b',
        public_code: 'CODE-B',
        display_name: '玩家B',
        recovery_code: 'REC-B',
        leaderboard_eligible: true,
      }),
    };

    const controller = new TelemetryController({
      storage,
      backend: mockBackend as any,
      onStateChange: (state) => useGameStore.setState({ telemetryState: state }),
    });
    setTelemetryControllerForTesting(controller);
    await controller.grantConsent();

    // 此时身份为玩家 B，绝不能同步玩家 A 的记录
    await controller.syncPendingTerminations();
    expect(upsertedPlayers).not.toContain('player-A');
    expect(upsertedPlayers).not.toContain('player-B');

    // 玩家 A 的记录仍然安全保存在 storage 中
    const listA = readPendingTerminations(storage, 'player-A');
    expect(listA.length).toBe(1);
    expect(listA[0].sessionId).toBe('sess-a-999');

    // 玩家 B 的待同步列表为空
    const listB = readPendingTerminations(storage, 'player-B');
    expect(listB.length).toBe(0);
  });

  it('游客模式纯本机行为：游客主动终止不产生云端待同步记录', async () => {
    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(42), {
      rulesVersion: CURRENT_REPLAY_RULES.rulesVersion,
      scoreRules: CURRENT_REPLAY_RULES.scoreRules,
      volatility: CURRENT_REPLAY_RULES.volatility,
      voidConfig: { voidCardCount: CURRENT_REPLAY_RULES.voidCardCount },
    });
    await tm.initialize();
    bindTurnManagerCallbacks(tm, useGameStore.setState, () => useGameStore.getState());
    useGameStore.setState({ turnManager: tm });

    // 游客本地开局
    await useGameStore.getState().startGame(true);
    expect(useGameStore.getState().gameState).toBe('player_action');

    // 游客主动终止
    useGameStore.getState().terminateGame('voluntary_termination');
    expect(useGameStore.getState().gameState).toBe('init');
    expect(useGameStore.getState().hasSave).toBe(false);

    // 游客绝不创建云端待同步记录
    const allPending = storage.getItem('jiazi_pending_terminations');
    expect(allPending).toBeNull();
  });
});
