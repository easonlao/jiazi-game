import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useGameStore, bindTurnManagerCallbacks, setTelemetryControllerForTesting } from '../../app/src/store';
import { TurnManager } from '../../src/core/TurnManager';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import { SeededRandomSource } from '../../src/core/RandomSource';
import {
  CURRENT_REPLAY_RULES,
  RELATIONSHIP_RESPONSE_REPLAY_RULES,
  TREND_WINDOW_REPLAY_RULES,
  cloneReplayRulesSnapshot,
} from '../../src/core/ReplayRules';
import { SupabaseAnalyticsBackend } from '../../app/src/lib/analyticsBackend';
import { TelemetryController } from '../../app/src/lib/telemetryController';

class MemoryStorage {
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

(globalThis as any).localStorage = new MemoryStorage();
vi.stubGlobal('fetch', () => Promise.reject(new Error('no fetch in test env')));

describe('03 跨设备继续当前修行测试（真实 Supabase 查询与动作链路还原）', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
    useGameStore.setState({ toast: null, pauseModalOpen: false });
  });

  afterEach(() => {
    setTelemetryControllerForTesting(null);
    useGameStore.setState({ toast: null, pauseModalOpen: false });
  });

  it('在第二台设备通过 SupabaseAnalyticsBackend 查询 game_sessions 与 game_events 重建对局，重新绑定遥测并继续游戏', async () => {
    const sessionData = {
      id: 'db-uuid-cross-dev-42',
      client_session_id: 'cross-device-sess-42',
      started_at: '2026-08-27T10:00:00.000Z',
      replay_seed: 8888,
      // V10 活跃局必须和 V9 一样可跨设备精确恢复；不能把 relationship_response 当作 V8 趋势快照拒绝。
      rules_snapshot: cloneReplayRulesSnapshot(RELATIONSHIP_RESPONSE_REPLAY_RULES),
      status: 'started',
      rounds_completed: 2,
      final_score: 15.5,
    };

    const eventsData = [
      {
        event_type: 'action_buy',
        sequence: 1,
        payload: { card_index: 0, use_leverage: false },
        occurred_at: '2026-08-27T10:01:00.000Z',
      },
      {
        event_type: 'action_wait',
        sequence: 2,
        payload: {},
        occurred_at: '2026-08-27T10:02:00.000Z',
      },
    ];

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'game_sessions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: sessionData, error: null }),
          };
        }
        if (table === 'game_events') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: eventsData, error: null }),
          };
        }
        if (table === 'cultivation_ledger_entries') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {};
      }),
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'auth-user-1' } } }, error: null }),
        signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null }),
      },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as unknown as SupabaseClient;

    const backend = new SupabaseAnalyticsBackend(client);
    const storage = new MemoryStorage();
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-27T00:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-cross-dev',
      public_player_id: 'pub-cross-dev',
      public_code: 'CROSS123',
      display_name: '道号二号机',
      leaderboard_eligible: true,
    }));

    const controller = new TelemetryController({ storage, backend });
    setTelemetryControllerForTesting(controller);

    // 设备 2 初始化，自动拉取活跃云端局
    await controller.init();
    expect(client.from).toHaveBeenCalledWith('game_sessions');
    expect(client.from).toHaveBeenCalledWith('game_events');

    const activeCloudSession = controller.getState().activeCloudSession;
    expect(activeCloudSession).not.toBeNull();
    expect(activeCloudSession?.session_id).toBe('db-uuid-cross-dev-42');
    expect(activeCloudSession?.client_session_id).toBe('cross-device-sess-42');
    expect(activeCloudSession?.actions).toEqual([
      { type: 'buy', cardIndex: 0, leverage: false },
      { type: 'wait' },
    ]);

    // 设备 1 对照组：用相同 seed 和 actions 推进到第 3 回合
    const random1 = new SeededRandomSource(8888);
    const tm1 = new TurnManager(undefined, random1, {
      rulesVersion: RELATIONSHIP_RESPONSE_REPLAY_RULES.rulesVersion,
      scoreRules: RELATIONSHIP_RESPONSE_REPLAY_RULES.scoreRules,
      volatility: RELATIONSHIP_RESPONSE_REPLAY_RULES.volatility,
      volatilityRandom: random1,
      branchRollRandom: random1,
      voidConfig: {
        voidCardCount: RELATIONSHIP_RESPONSE_REPLAY_RULES.voidCardCount,
        voidKMin: RELATIONSHIP_RESPONSE_REPLAY_RULES.voidKMin,
        voidKMax: RELATIONSHIP_RESPONSE_REPLAY_RULES.voidKMax,
      },
    });
    await tm1.initialize();
    tm1.startGame();
    tm1.executeBuy(0, false);
    tm1.executeWait();
    const stateRoundOnDevice1 = tm1.getCurrentRound();
    const scoreOnDevice1 = tm1.getScore();
    const qiOnDevice1 = tm1.getQi();
    const handCardsOnDevice1 = tm1.getHand().map((s) => s?.card.id);

    // 将 controller 状态同步至 store 测试环境
    useGameStore.setState({
      telemetryState: controller.getState(),
      turnManager: new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(1234)),
    });

    // 设备 2 执行恢复续局
    const resumed = await useGameStore.getState().resumeCloudSession(activeCloudSession);
    expect(resumed).toBe(true);

    const tm2 = useGameStore.getState().turnManager!;
    expect(tm2.getCurrentRound()).toBe(stateRoundOnDevice1);
    expect(tm2.getScore()).toBeCloseTo(scoreOnDevice1, 2);
    expect(tm2.getQi()).toBe(qiOnDevice1);
    expect(tm2.getHand().map((s) => s?.card.id)).toEqual(handCardsOnDevice1);
    expect(useGameStore.getState().gameState).toBe('player_action');
    expect(useGameStore.getState().toast).toBe('已同步恢复当前修行');

    // 验证遥测会话已重新绑定
    expect(controller.getActiveSessionId()).toBe('db-uuid-cross-dev-42');

    // 设备 2 继续进行操作（如调息）
    expect(useGameStore.getState().executeWait()).toBe(true);
    expect(tm2.getCurrentRound()).toBe(stateRoundOnDevice1 + 1);
  });

  it('第二台设备确认开新局将覆盖并终止旧云端对局，确保单账号仅存在一个继续中对局', async () => {
    const cloudSession = {
      session_id: 'cross-device-sess-old',
      started_at: '2026-08-27T09:00:00.000Z',
      seed: 9999,
      rules_snapshot: cloneReplayRulesSnapshot(CURRENT_REPLAY_RULES),
      actions: [],
      rounds_completed: 0,
      final_score: 0,
    };

    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(1234));
    await tm.initialize();
    bindTurnManagerCallbacks(tm, useGameStore.setState, () => useGameStore.getState());
    useGameStore.setState({
      turnManager: tm,
      hasSave: false,
      gameState: 'init',
      telemetryState: {
        consent: { version: 1, granted: true, granted_at: '2026-08-27T00:00:00.000Z' },
        identity: {
          player_id: 'player-cross-dev',
          public_player_id: 'pub-cross-dev',
          public_code: 'CROSS123',
          display_name: '道号二号机',
          leaderboard_eligible: true,
        },
        telemetryEnabled: true,
        busy: false,
        error: null,
        recovery_code: null,
        cultivationLedger: null,
        cultivationLedgerBusy: false,
        cultivationLedgerError: null,
        activeCloudSession: cloudSession,
        activeCloudSessionBusy: false,
      },
    });

    // 玩家选择终止旧局开启新局
    useGameStore.getState().terminateGame('new_game_override');
    expect(useGameStore.getState().toast).toBe('已主动终止本局修行');

    // 开新局（本地）
    const started = await useGameStore.getState().startGame(true);
    expect(started).toBe(true);
    expect(useGameStore.getState().gameState).toBe('player_action');
    expect(useGameStore.getState().currentRound).toBe(1);
  });

  it('第二台设备拉取到受损 V7 活跃局（动作链导致牌池守恒破坏），触发免惩罚技术重置并向 Supabase 写入 corrupted_recovery', async () => {
    const corruptedSessionData = {
      id: 'db-uuid-corrupted-v7-cross',
      client_session_id: 'client-corrupted-cross',
      started_at: '2026-08-27T10:00:00.000Z',
      replay_seed: 42,
      // 规则快照本身必须完整合法；本例要验证的是事件链破坏，而不是放行坏快照。
      rules_snapshot: cloneReplayRulesSnapshot(TREND_WINDOW_REPLAY_RULES),
      status: 'started',
      rounds_completed: 1,
      final_score: 10,
    };

    const corruptedEventsData = [
      {
        event_type: 'action_lock',
        sequence: 1,
        payload: { card_index: 0 },
        occurred_at: '2026-08-27T10:01:00.000Z',
      },
      {
        event_type: 'action_unlock',
        sequence: 2,
        payload: { card_index: 0 },
        occurred_at: '2026-08-27T10:02:00.000Z',
      },
      {
        event_type: 'action_wait',
        sequence: 3,
        payload: {},
        occurred_at: '2026-08-27T10:03:00.000Z',
      },
    ];

    let sessionStatusPatched: string | null = null;
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'game_sessions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: corruptedSessionData, error: null }),
            update: vi.fn((payload: { status?: string }) => {
              if (payload.status) sessionStatusPatched = payload.status;
              return {
                eq: vi.fn().mockReturnThis(),
                then: (resolve: any) => resolve({ data: null, error: null }),
              };
            }),
          };
        }
        if (table === 'game_events') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: corruptedEventsData, error: null }),
          };
        }
        if (table === 'cultivation_ledger_entries') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {};
      }),
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'auth-user-1' } } }, error: null }),
        signInAnonymously: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null }),
      },
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
      },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as unknown as SupabaseClient;

    const backend = new SupabaseAnalyticsBackend(client);
    const storage = new MemoryStorage();
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-27T00:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player-cross-dev',
      public_player_id: 'pub-cross-dev',
      public_code: 'CROSS123',
      display_name: '道号二号机',
      leaderboard_eligible: true,
    }));

    const controller = new TelemetryController({ storage, backend });
    setTelemetryControllerForTesting(controller);
    await controller.init();

    const activeCloudSession = controller.getState().activeCloudSession;
    expect(activeCloudSession).not.toBeNull();
    expect(activeCloudSession?.session_id).toBe('db-uuid-corrupted-v7-cross');

    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(1234));
    await tm.initialize();
    bindTurnManagerCallbacks(tm, useGameStore.setState, () => useGameStore.getState());
    useGameStore.setState({
      turnManager: tm,
      telemetryState: controller.getState(),
      gameState: 'init',
      hasSave: false,
    });

    // 设备 2 尝试恢复云端受损局
    const resumed = await useGameStore.getState().resumeCloudSession(activeCloudSession);
    // 关键断言 1：检测到牌池损坏，返回 false，安全重置
    expect(resumed).toBe(false);
    expect(useGameStore.getState().gameState).toBe('init');
    expect(useGameStore.getState().toast).toContain('安全重置');

    // 关键断言 2：向 Supabase Edge Function 成功提交了 recover-corrupted-session 验证
    expect(client.functions.invoke).toHaveBeenCalledWith(
      'recover-corrupted-session',
      expect.objectContaining({
        body: expect.objectContaining({ session_id: 'db-uuid-corrupted-v7-cross' }),
      }),
    );
  });
});
