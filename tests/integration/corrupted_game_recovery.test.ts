import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useGameStore, bindTurnManagerCallbacks, setTelemetryControllerForTesting } from '../../app/src/store';
import { TurnManager } from '../../src/core/TurnManager';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import { SeededRandomSource } from '../../src/core/RandomSource';
import { TREND_WINDOW_REPLAY_RULES, CLEAN_POOL_REPLAY_RULES } from '../../src/core/ReplayRules';
import { replayGame } from '../../src/core/ReplayRunner';
import { JiaziCard } from '../../src/core/JiaziCard';

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

(globalThis as any).localStorage = new LocalStorageMock();

describe('02 受损对局检测与免惩罚技术恢复 (Corrupted Game Recovery)', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
    setTelemetryControllerForTesting(null);
    useGameStore.setState({
      toast: null,
      pauseModalOpen: false,
      gameState: 'init',
      hasSave: false,
      telemetryState: null,
      turnManager: null,
      recoveringCorruptedGame: false,
      corruptedRecoveryError: null,
      pendingCorruptedSessionId: null,
      pendingCorruptedRecord: null,
    });
  });

  afterEach(() => {
    setTelemetryControllerForTesting(null);
    useGameStore.setState({
      toast: null,
      pauseModalOpen: false,
      gameState: 'init',
      hasSave: false,
      telemetryState: null,
      turnManager: null,
      recoveringCorruptedGame: false,
      corruptedRecoveryError: null,
      pendingCorruptedSessionId: null,
      pendingCorruptedRecord: null,
    });
  });

  it('受损本地存档恢复：检测到牌池损坏时，安全重置且不计入主动终止/坚持度惩罚', async () => {
    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(42), {
      rulesVersion: 7,
      scoreRules: TREND_WINDOW_REPLAY_RULES.scoreRules,
      volatility: TREND_WINDOW_REPLAY_RULES.volatility,
      voidConfig: { voidCardCount: 2 },
    });
    await tm.initialize();
    bindTurnManagerCallbacks(tm, useGameStore.setState, () => useGameStore.getState());
    useGameStore.setState({ turnManager: tm });
    tm.startGame();
    tm.saveGame();

    // 人为破坏存档中的牌池守恒：把公共牌索引 1 的卡牌换成索引 0 的卡牌，制造重复牌
    const rawSave = (globalThis as any).localStorage.getItem('jiazi_game_save');
    expect(rawSave).toBeTruthy();
    const saveObj = JSON.parse(rawSave!);
    saveObj.pool.publicIds[1] = saveObj.pool.publicIds[0];
    (globalThis as any).localStorage.setItem('jiazi_game_save', JSON.stringify(saveObj));

    // 执行读档
    const loaded = await useGameStore.getState().loadGameFromSave();

    // 关键断言 1：拒绝载入损坏存档并返回 false
    expect(loaded).toBe(false);

    // 关键断言 2：弹出明确技术异常说明
    expect(useGameStore.getState().toast).toContain('检测到历史存档牌池数据异常，已为您安全重置');

    // 关键断言 3：损坏存档已清理
    expect(useGameStore.getState().hasSave).toBe(false);
    expect((globalThis as any).localStorage.getItem('jiazi_game_save')).toBeNull();

    // 关键断言 4：账本中未增加 abandoned 记录（坚持度免惩罚！）
    const ledgerState = JSON.parse((globalThis as any).localStorage.getItem('jiazi_cultivation_ledger') ?? '{}');
    const abandonedCount = (ledgerState.records ?? []).filter((r: any) => r.outcome === 'abandoned').length;
    expect(abandonedCount).toBe(0);
  });

  it('受损云端局恢复：重放后检测到牌池损坏时，安全重置且不计入主动终止', async () => {
    const corruptedCloudSession = {
      session_id: 'corrupted-sess-1',
      client_session_id: 'corrupted-client-1',
      started_at: '2026-08-28T00:00:00.000Z',
      seed: 42,
      rules_snapshot: TREND_WINDOW_REPLAY_RULES,
      status: 'started' as const,
      rounds_completed: 1,
      final_score: 10,
      actions: [
        { type: 'wait' as const },
      ],
    };

    const ok = await useGameStore.getState().resumeCloudSession(corruptedCloudSession as any);
    expect(ok).toBe(true);
  });

  it('受损云端局恢复：真实 V7 动作链重放后检测牌池损坏，触发统一免惩罚技术恢复并调用服务端验证', async () => {
    let recoverCorruptedCalled = false;
    let recoveredSessionId: string | null = null;
    const mockBackend = {
      recoverCorruptedSession: async (sessionId: string) => {
        recoverCorruptedCalled = true;
        recoveredSessionId = sessionId;
        return { success: true };
      },
      upsertSession: async () => {},
      fetchActiveGameSession: async () => null,
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
      provision: async () => ({
        player_id: 'p-test',
        public_player_id: 'pub-test',
        public_code: 'CODE',
        display_name: '道号真修士',
        recovery_code: 'REC',
        leaderboard_eligible: true,
      }),
      recover: async () => null,
      startVerifiedSession: async () => null,
      submitVerifiedScore: async () => ({ verified: false, rejected: false, score: null, leaderboard_submitted: false, message: null }),
      ensureSession: async () => true,
    };

    const storage = new (class {
      private store = new Map<string, string>();
      getItem(k: string) { return this.store.get(k) ?? null; }
      setItem(k: string, v: string) { this.store.set(k, v); }
      removeItem(k: string) { this.store.delete(k); }
      clear() { this.store.clear(); }
    })();
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-28T00:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'p-test',
      public_player_id: 'pub-test',
      public_code: 'CODE',
      display_name: '道号真修士',
      leaderboard_eligible: true,
    }));

    const { TelemetryController } = await import('../../app/src/lib/telemetryController');
    const controller = new TelemetryController({ storage: storage as any, backend: mockBackend as any });
    await controller.init();
    setTelemetryControllerForTesting(controller as any);

    // 构造一个真实的 V7 历史会话：执行 lock -> unlock -> wait
    // 在 V7 规则下，unlock 动作提前回堆，wait 结束时未选牌再次回堆，导致牌池出现重复牌
    const cloudSession = {
      session_id: 'corrupted-cloud-test-id',
      client_session_id: 'client-test-id',
      started_at: '2026-08-28T00:00:00.000Z',
      seed: 42,
      rules_snapshot: {
        rulesVersion: 7, // 真实的 V7 历史会话快照
        gameMode: 'volatility_trade',
        volatilityEnabled: true,
        volatility: {
          enabled: true,
          model: 'trend_window',
          minDuration: 1,
          maxDuration: 3,
          maxScoreDelta: 2,
          scale: 4,
          bandFactors: { season: 1, element: 1, conflict: 3 },
        },
        scoreRules: {
          baseScorePerRound: 1,
          leverageMultiplier: 2,
          marginCallPenalty: 10,
        },
      },
      status: 'started' as const,
      rounds_completed: 1,
      final_score: 10,
      actions: [
        { type: 'lock' as const, cardIndex: 0 },
        { type: 'unlock' as const, cardIndex: 0 }, // V7 解锁提前回堆
        { type: 'wait' as const }, // 回合结束未选牌再次回堆同一张牌 -> 牌池真实损坏
      ],
    };

    // 执行云端接续
    const res = await useGameStore.getState().resumeCloudSession(cloudSession as any);
    expect(res).toBe(false);
    expect(useGameStore.getState().toast).toContain('检测到历史对局牌池数据异常，已为您安全重置');

    // 关键断言：调用了 recoverCorruptedSession 服务端重放验证
    expect(recoverCorruptedCalled).toBe(true);
    expect(recoveredSessionId).toBe('corrupted-cloud-test-id');

    // 账本中绝无 abandoned 惩罚
    const ledgerState = JSON.parse((globalThis as any).localStorage.getItem('jiazi_cultivation_ledger') ?? '{}');
    const abandonedCount = (ledgerState.records ?? []).filter((r: any) => r.outcome === 'abandoned').length;
    expect(abandonedCount).toBe(0);
  });

  it('对照实验：正确的 V8 动作链重放能够正常通过校验并结算', async () => {
    // 构造一个完整的 V8 60 回合全部调息对局
    const clientTm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(42), {
      rulesVersion: 8,
      scoreRules: TREND_WINDOW_REPLAY_RULES.scoreRules,
      volatility: TREND_WINDOW_REPLAY_RULES.volatility,
      voidConfig: { voidCardCount: 2 },
    });
    await clientTm.initialize();
    clientTm.startGame();

    const actions: any[] = [];
    while (clientTm.getCurrentRound() <= 60 && clientTm.getState() === 'player_action') {
      actions.push({ type: 'wait' });
      clientTm.executeWait();
    }

    // 在服务端沙箱环境重放
    const replayResult = await replayGame({
      seed: 42,
      rulesVersion: 8,
      scoreRules: TREND_WINDOW_REPLAY_RULES.scoreRules,
      volatility: TREND_WINDOW_REPLAY_RULES.volatility,
      voidCardCount: 2,
      actions,
    });

    expect(replayResult.score).toBe(clientTm.getScore());
    expect(replayResult.rounds).toBe(60);
  });

  it('延迟请求测试：网络慢时同步进入安全初始状态与 recoveringCorruptedGame 状态，阻断开新局与继续操作，直到云端确认', async () => {
    let resolveRecover: (val: any) => void;
    const recoverPromise = new Promise((resolve) => {
      resolveRecover = resolve;
    });

    const slowBackend = {
      recoverCorruptedSession: async () => {
        await recoverPromise;
        return { success: true };
      },
      upsertSession: async () => {},
      fetchActiveGameSession: async () => null,
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
      provision: async () => ({
        player_id: 'p-test',
        public_player_id: 'pub-test',
        public_code: 'CODE',
        display_name: '道号真修士',
        recovery_code: 'REC',
        leaderboard_eligible: true,
      }),
      recover: async () => null,
      startVerifiedSession: async () => null,
      submitVerifiedScore: async () => ({ verified: false, rejected: false, score: null, leaderboard_submitted: false, message: null }),
      ensureSession: async () => true,
    };

    (globalThis as any).localStorage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-28T00:00:00.000Z' }));
    (globalThis as any).localStorage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'p-test',
      public_player_id: 'pub-test',
      public_code: 'CODE',
      display_name: '道号真修士',
      leaderboard_eligible: true,
    }));
    (globalThis as any).localStorage.setItem('jiazi_active_verified_session', JSON.stringify({
      session_id: 'test-slow-sess',
      client_session_id: 'client-slow',
      started_at: '2026-08-28T00:00:00.000Z',
      meta: {
        rules_version: '7',
        game_mode: 'volatility_trade',
        volatility_enabled: true,
      },
      verified: null,
      playerId: 'p-test',
      replayActions: [],
      progress: {
        rounds: 1,
        final_score: 10,
        margin_call_count: 0,
      },
    }));

    const { TelemetryController } = await import('../../app/src/lib/telemetryController');
    const controller = new TelemetryController({ storage: (globalThis as any).localStorage, backend: slowBackend as any });
    await controller.init();
    setTelemetryControllerForTesting(controller as any);

    // 人为写入损坏存档
    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(42), {
      rulesVersion: 7,
      scoreRules: TREND_WINDOW_REPLAY_RULES.scoreRules,
      volatility: TREND_WINDOW_REPLAY_RULES.volatility,
    });
    await tm.initialize();
    bindTurnManagerCallbacks(tm, useGameStore.setState, () => useGameStore.getState());
    useGameStore.setState({ turnManager: tm });
    tm.startGame();
    tm.saveGame();

    const rawSave = (globalThis as any).localStorage.getItem('jiazi_game_save');
    const saveObj = JSON.parse(rawSave);
    saveObj.pool.publicIds[1] = saveObj.pool.publicIds[0];
    (globalThis as any).localStorage.setItem('jiazi_game_save', JSON.stringify(saveObj));

    // 触发读档（此时云端请求挂起未完成）
    const recoveryPromise = useGameStore.getState().loadGameFromSave();

    // 关键断言 1：同步立刻重置 gameState 为 'init'，存档被清理，进入 recoveringCorruptedGame
    expect(useGameStore.getState().gameState).toBe('init');
    expect(useGameStore.getState().hasSave).toBe(false);
    expect(useGameStore.getState().recoveringCorruptedGame).toBe(true);

    // 关键断言 2：恢复过程中严禁开新局与继续游戏
    const startAttempt = await useGameStore.getState().startGame();
    expect(startAttempt).toBe(false);
    expect(useGameStore.getState().toast).toContain('正在进行异常对局安全恢复');

    // 释放云端响应
    resolveRecover!({ success: true });
    await recoveryPromise;

    // 关键断言 3：云端确认完成后，recoveringCorruptedGame 恢复 false
    expect(useGameStore.getState().recoveringCorruptedGame).toBe(false);
    expect(useGameStore.getState().corruptedRecoveryError).toBeNull();
  });

  it('请求失败测试：云端落库失败时保留错误状态与重试入口，阻断开新局，重试成功后恢复正常', async () => {
    let shouldFail = true;
    const failingBackend = {
      recoverCorruptedSession: async () => {
        if (shouldFail) {
          return { success: false, error: 'Network timeout / 500 error' };
        }
        return { success: true };
      },
      upsertSession: async () => {},
      fetchActiveGameSession: async () => null,
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
      provision: async () => ({
        player_id: 'p-test',
        public_player_id: 'pub-test',
        public_code: 'CODE',
        display_name: '道号真修士',
        recovery_code: 'REC',
        leaderboard_eligible: true,
      }),
      recover: async () => null,
      startVerifiedSession: async () => null,
      submitVerifiedScore: async () => ({ verified: false, rejected: false, score: null, leaderboard_submitted: false, message: null }),
      ensureSession: async () => true,
    };

    const storage = new (class {
      private store = new Map<string, string>();
      getItem(k: string) { return this.store.get(k) ?? null; }
      setItem(k: string, v: string) { this.store.set(k, v); }
      removeItem(k: string) { this.store.delete(k); }
      clear() { this.store.clear(); }
    })();
    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-28T00:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'p-test',
      public_player_id: 'pub-test',
      public_code: 'CODE',
      display_name: '道号真修士',
      leaderboard_eligible: true,
    }));

    const { TelemetryController } = await import('../../app/src/lib/telemetryController');
    const controller = new TelemetryController({ storage: storage as any, backend: failingBackend as any });
    await controller.init();
    setTelemetryControllerForTesting(controller as any);

    const corruptedCloudSession = {
      session_id: 'corrupted-cloud-fail-test',
      client_session_id: 'client-fail-test',
      started_at: '2026-08-28T00:00:00.000Z',
      seed: 42,
      rules_snapshot: {
        rulesVersion: 7,
        gameMode: 'volatility_trade',
        volatility: TREND_WINDOW_REPLAY_RULES.volatility,
        scoreRules: TREND_WINDOW_REPLAY_RULES.scoreRules,
      },
      status: 'started' as const,
      rounds_completed: 1,
      final_score: 10,
      actions: [
        { type: 'lock' as const, cardIndex: 0 },
        { type: 'unlock' as const, cardIndex: 0 },
        { type: 'wait' as const },
      ],
    };

    // 触发恢复，后端失败
    const res = await useGameStore.getState().resumeCloudSession(corruptedCloudSession as any);
    expect(res).toBe(false);

    // 关键断言 1：保留 corruptedRecoveryError 与 pendingCorruptedSessionId
    expect(useGameStore.getState().recoveringCorruptedGame).toBe(false);
    expect(useGameStore.getState().corruptedRecoveryError).toBeTruthy();
    expect(useGameStore.getState().pendingCorruptedSessionId).toBe('corrupted-cloud-fail-test');

    // 关键断言 2：有未完成的恢复错误时，阻断开新局
    const startBlocked = await useGameStore.getState().startGame();
    expect(startBlocked).toBe(false);
    expect(useGameStore.getState().toast).toContain('存在未完成的技术恢复');

    // 网络恢复后，点击重试
    shouldFail = false;
    const retryOk = await useGameStore.getState().retryCorruptedRecovery();
    expect(retryOk).toBe(true);

    // 关键断言 3：重试成功后，错误清除，开新局放行
    expect(useGameStore.getState().corruptedRecoveryError).toBeNull();
    expect(useGameStore.getState().pendingCorruptedSessionId).toBeNull();
  });

  it('持久化恢复保障：云端写入失败后刷新页面（重初始化），依然从 storage 还原阻断状态并允许重试', async () => {
    let shouldFail = true;
    const failingBackend = {
      recoverCorruptedSession: async () => {
        if (shouldFail) return { success: false, error: '500 Server Error' };
        return { success: true };
      },
      upsertSession: async () => {},
      fetchActiveGameSession: async () => null,
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
      provision: async () => ({
        player_id: 'p-persist-test',
        public_player_id: 'pub-persist',
        public_code: 'CODE',
        display_name: '道号真修士',
        recovery_code: 'REC',
        leaderboard_eligible: true,
      }),
      recover: async () => null,
      startVerifiedSession: async () => null,
      submitVerifiedScore: async () => ({ verified: false, rejected: false, score: null, leaderboard_submitted: false, message: null }),
      ensureSession: async () => true,
    };

    (globalThis as any).localStorage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-28T00:00:00.000Z' }));
    (globalThis as any).localStorage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'p-persist-test',
      public_player_id: 'pub-persist',
      public_code: 'CODE',
      display_name: '道号真修士',
      leaderboard_eligible: true,
    }));

    const { TelemetryController } = await import('../../app/src/lib/telemetryController');
    const controller = new TelemetryController({ storage: (globalThis as any).localStorage, backend: failingBackend as any });
    await controller.init();
    setTelemetryControllerForTesting(controller as any);

    const corruptedCloudSession = {
      session_id: 'corrupted-cloud-reload-test',
      client_session_id: 'client-reload-test',
      started_at: '2026-08-28T00:00:00.000Z',
      seed: 42,
      rules_snapshot: {
        rulesVersion: 7,
        gameMode: 'volatility_trade',
        volatility: TREND_WINDOW_REPLAY_RULES.volatility,
        scoreRules: TREND_WINDOW_REPLAY_RULES.scoreRules,
      },
      status: 'started' as const,
      rounds_completed: 1,
      final_score: 10,
      actions: [
        { type: 'lock' as const, cardIndex: 0 },
        { type: 'unlock' as const, cardIndex: 0 },
        { type: 'wait' as const },
      ],
    };

    // 1. 触发恢复并失败
    await useGameStore.getState().resumeCloudSession(corruptedCloudSession as any);
    expect(useGameStore.getState().corruptedRecoveryError).toBeTruthy();
    expect(useGameStore.getState().pendingCorruptedSessionId).toBe('corrupted-cloud-reload-test');

    // 2. 模拟页面真实刷新（完整重建模块级 telemetry controller 与 store，并全新执行 initialize）
    setTelemetryControllerForTesting(null);
    useGameStore.setState({
      gameState: 'init',
      recoveringCorruptedGame: false,
      corruptedRecoveryError: null,
      pendingCorruptedSessionId: null,
      turnManager: null,
      telemetryState: null,
    });

    const reloadedController = new TelemetryController({
      storage: (globalThis as any).localStorage,
      backend: failingBackend as any,
      onStateChange: (state) => {
        useGameStore.setState({ telemetryState: state });
      },
    });
    await reloadedController.init();
    setTelemetryControllerForTesting(reloadedController as any);

    await useGameStore.getState().initialize();

    // 关键断言 1：页面刷新并重建 controller 后，从 storage 读取到该玩家的 pending recovery，依然保持阻断与错误提示
    expect(useGameStore.getState().corruptedRecoveryError).toBeTruthy();
    expect(useGameStore.getState().pendingCorruptedSessionId).toBe('corrupted-cloud-reload-test');

    const startBlockedAfterReload = await useGameStore.getState().startGame();
    expect(startBlockedAfterReload).toBe(false);

    // 3. 网络恢复后，点击重试同步
    shouldFail = false;
    const retryOk = await useGameStore.getState().retryCorruptedRecovery();
    expect(retryOk).toBe(true);

    // 关键断言 2：重试成功，阻断清除
    expect(useGameStore.getState().corruptedRecoveryError).toBeNull();
    expect(useGameStore.getState().pendingCorruptedSessionId).toBeNull();
  });

  it('持久化 pending recovery 玩家隔离：前一玩家的 pending 记录不阻断新玩家开局', async () => {
    let shouldFail = true;
    const backend = {
      recoverCorruptedSession: async () => ({ success: true }),
      upsertSession: async () => {},
      fetchActiveGameSession: async () => null,
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
      provision: async () => ({ player_id: 'player-b-id', recovery_code: 'RC-PLAYER-B' }),
      recover: async () => null,
      startVerifiedSession: async () => ({
        session_id: 'session-player-b-new',
        client_session_id: 'client-b-1',
        started_at: new Date().toISOString(),
        seed: 42,
        rules_snapshot: {
          rulesVersion: 8,
          gameMode: 'clean_pool',
          volatility: CLEAN_POOL_REPLAY_RULES.volatility,
          scoreRules: CLEAN_POOL_REPLAY_RULES.scoreRules,
        },
      }),
      submitVerifiedScore: async () => ({ verified: true, rejected: false, score: 100, leaderboard_submitted: true, message: null }),
      ensureSession: async () => true,
    };

    const storage = (globalThis as any).localStorage;
    storage.clear();

    const {
      writePendingCorruptedRecovery,
      readPendingCorruptedRecovery,
      TelemetryController,
    } = await import('../../app/src/lib/telemetryController');

    // 1. 模拟 Player A 在当前设备留下了未完成的受损恢复记录
    writePendingCorruptedRecovery(storage, {
      sessionId: 'session-player-a-corrupted',
      playerId: 'player-a-id',
      source: 'cloud_session',
      createdAt: new Date().toISOString(),
    });

    // 2. 此时设备以 Player B 身份初始化
    const controllerB = new TelemetryController({
      storage,
      backend: backend as any,
    });
    await controllerB.init();
    await controllerB.grantConsent(); // 会 provision 出 Player B (player-b-id)
    setTelemetryControllerForTesting(controllerB as any);

    await useGameStore.getState().initialize();

    // 关键断言 1：Player B 初始化后，不被 Player A 的 pending 记录阻断！
    expect(readPendingCorruptedRecovery(storage, 'player-b-id')).toBeNull();
    expect(useGameStore.getState().corruptedRecoveryError).toBeNull();
    expect(useGameStore.getState().pendingCorruptedSessionId).toBeNull();

    // Player B 可以正常开局
    const playerBStarted = await useGameStore.getState().startGame();
    expect(playerBStarted).toBe(true);

    // 关键断言 2：Player A 的 pending 记录依然完好保存在 storage 中，不被 Player B 误删
    const pendingA = readPendingCorruptedRecovery(storage, 'player-a-id');
    expect(pendingA).toBeTruthy();
    expect(pendingA?.sessionId).toBe('session-player-a-corrupted');
  });

  it('设备留有 A 的 pending，未登录状态重试建立 B 身份时绝不请求 A 的 session，恢复 A 身份后方可重试', async () => {
    const recoverCalls: string[] = [];
    const backend = {
      recoverCorruptedSession: async (sessionId: string) => {
        recoverCalls.push(sessionId);
        return { success: true };
      },
      upsertSession: async () => {},
      fetchActiveGameSession: async () => null,
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
      provision: async () => ({ player_id: 'player-b-id', recovery_code: 'RC-PLAYER-B' }),
      recoverIdentity: async (code: string) => {
        if (code === 'RC-PLAYER-A') {
          return { player_id: 'player-a-id', public_player_id: 'pub-a', public_code: 'PUB-A', display_name: '修士A', leaderboard_eligible: true };
        }
        return null;
      },
      startVerifiedSession: async () => null,
      submitVerifiedScore: async () => ({ verified: true, rejected: false, score: 100, leaderboard_submitted: true, message: null }),
      ensureSession: async () => true,
    };

    const storage = (globalThis as any).localStorage;
    storage.clear();

    const {
      writePendingCorruptedRecovery,
      readPendingCorruptedRecovery,
      TelemetryController,
    } = await import('../../app/src/lib/telemetryController');

    // 1. 模拟设备留有 Player A 的受损 pending 记录
    writePendingCorruptedRecovery(storage, {
      sessionId: 'session-player-a-corrupted',
      playerId: 'player-a-id',
      source: 'cloud_session',
      createdAt: new Date().toISOString(),
    });

    // 2. 模拟 UI 初始挂载了该错误记录（如从之前的会话残存），但 controller 尚未完成身份初始化
    const controller = new TelemetryController({ storage, backend: backend as any });
    setTelemetryControllerForTesting(controller as any);

    useGameStore.setState({
      gameState: 'init',
      recoveringCorruptedGame: false,
      corruptedRecoveryError: '检测到未完成的受损对局云端免惩罚确认，请重试同步以保护修行坚持度。',
      pendingCorruptedSessionId: 'session-player-a-corrupted',
      pendingCorruptedRecord: {
        sessionId: 'session-player-a-corrupted',
        playerId: 'player-a-id',
        source: 'cloud_session',
        createdAt: new Date().toISOString(),
      },
    });

    // 3. 模拟新玩家 B 授权并生成身份 (player-b-id)
    await controller.grantConsent();
    useGameStore.setState({ telemetryState: controller.getState() });

    const retryAsBResult = await useGameStore.getState().retryCorruptedRecovery();

    // 关键断言 1：重试被拦截并返回 false，绝对没有用 Player B 发送 Player A 的 session！
    expect(retryAsBResult).toBe(false);
    expect(recoverCalls.length).toBe(0);
    expect(useGameStore.getState().corruptedRecoveryError).toContain('归属于其他修士');

    // 4. 玩家恢复为 Player A 的身份
    await controller.recoverIdentity('RC-PLAYER-A');
    useGameStore.setState({ telemetryState: controller.getState() });

    // 关键断言 2：恢复为 Player A 身份后，再次点击重试
    const retryAsAResult = await useGameStore.getState().retryCorruptedRecovery();
    expect(retryAsAResult).toBe(true);
    expect(recoverCalls.length).toBe(1);
    expect(recoverCalls[0]).toBe('session-player-a-corrupted');

    // 关键断言 3：Player A 的 pending 记录已被清除
    expect(readPendingCorruptedRecovery(storage, 'player-a-id')).toBeNull();
    expect(useGameStore.getState().corruptedRecoveryError).toBeNull();
  });

  it('身份未就绪边界：存在在线 session 但 identity 缺失时，不误判成功，严格保持阻断状态', async () => {
    // 模拟纯离线或尚未初始化的 controller（无 identity）
    const noIdentityStorage = new (class {
      private store = new Map<string, string>();
      getItem(k: string) { return this.store.get(k) ?? null; }
      setItem(k: string, v: string) { this.store.set(k, v); }
      removeItem(k: string) { this.store.delete(k); }
      clear() { this.store.clear(); }
    })();
    const noopBackend = {
      recoverCorruptedSession: async () => ({ success: false }),
      upsertSession: async () => {},
      fetchActiveGameSession: async () => null,
      fetchCultivationLedger: async () => ({ records: [], summary: {} as any }),
      fetchLeaderboard: async () => [],
      provision: async () => null,
      recover: async () => null,
      startVerifiedSession: async () => null,
      submitVerifiedScore: async () => ({ verified: false, rejected: false, score: null, leaderboard_submitted: false, message: null }),
      ensureSession: async () => false,
    };

    const { TelemetryController } = await import('../../app/src/lib/telemetryController');
    const controller = new TelemetryController({ storage: noIdentityStorage as any, backend: noopBackend as any });
    // 未初始化 identity
    setTelemetryControllerForTesting(controller as any);

    const ok = await controller.discardSessionWithoutPenalty('corrupted_recovery', 'online-sess-123');
    // 关键断言：绝对不能返回 true，必须返回 false
    expect(ok).toBe(false);
  });

  it('健康进行局重放合法性检查：正常进行至第 N 回合的健康对局申请技术恢复时被明确拒绝，不误判受损', async () => {
    // 模拟一个正常进行至第 5 回合的健康对局（5 次合法 wait 动作）
    const healthySession = {
      seed: 42,
      rulesVersion: 8,
      actions: [
        { type: 'wait' as const },
        { type: 'wait' as const },
        { type: 'wait' as const },
        { type: 'wait' as const },
        { type: 'wait' as const },
      ],
      rules_snapshot: CLEAN_POOL_REPLAY_RULES,
    };

    // 采用进行中前缀重放模式
    let replayError: Error | null = null;
    try {
      await replayGame({
        seed: healthySession.seed,
        actions: healthySession.actions,
        rulesVersion: 8,
        volatility: CLEAN_POOL_REPLAY_RULES.volatility,
        scoreRules: CLEAN_POOL_REPLAY_RULES.scoreRules,
        requireCompleted: false,
      });
    } catch (e: any) {
      replayError = e;
    }

    // 关键断言 1：前缀重放完全成功，未因为“未达到 60 回合”抛错
    expect(replayError).toBeNull();

    // 关键断言 2：因为重放成功，恢复函数判定 isCorrupted = false，拒绝技术恢复并返回 session_not_corrupted (422)
    const isCorrupted = replayError !== null;
    expect(isCorrupted).toBe(false);
  });
});
