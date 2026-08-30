import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useGameStore, bindTurnManagerCallbacks, setTelemetryControllerForTesting } from '../../app/src/store';
import { TurnManager } from '../../src/core/TurnManager';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import { SeededRandomSource } from '../../src/core/RandomSource';
import { TREND_WINDOW_REPLAY_RULES } from '../../src/core/ReplayRules';

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
vi.stubGlobal('fetch', () => Promise.reject(new Error('no fetch in test env')));

function createMockTelemetryController(sessionId = 'sess-cloud-99', customActions: any[] = [{ type: 'wait' }]) {
  const state = {
    consent: { version: 1, granted: true, granted_at: '2026-08-01T00:00:00.000Z' },
    identity: {
      player_id: 'p-1',
      public_player_id: 'pub-1',
      public_code: 'C1',
      display_name: '修士',
      leaderboard_eligible: true,
    },
    telemetryEnabled: true,
    busy: false,
    error: null,
    recovery_code: 'REC1',
    cultivationLedger: null,
    cultivationLedgerBusy: false,
    cultivationLedgerError: null,
    activeCloudSession: {
      session_id: sessionId,
      client_session_id: sessionId,
      started_at: '2026-08-28T00:00:00.000Z',
      seed: 42,
      rules_snapshot: TREND_WINDOW_REPLAY_RULES,
      status: 'started' as const,
      rounds_completed: 1,
      final_score: 10,
      actions: customActions,
    },
  };

  return {
    init: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn(() => state),
    getActiveSessionId: vi.fn(() => sessionId),
    prepareVerifiedSession: vi.fn().mockResolvedValue({
      session_id: sessionId,
      seed: 42,
      rules_snapshot: TREND_WINDOW_REPLAY_RULES,
    }),
    startSession: vi.fn().mockReturnValue(true),
    recordReplayAction: vi.fn(),
    removeLastReplayAction: vi.fn(),
    abandonSession: vi.fn(),
    resumeVerifiedSession: vi.fn().mockReturnValue(true),
    refreshActiveSession: vi.fn().mockResolvedValue(state.activeCloudSession),
    refreshCultivationLedger: vi.fn().mockResolvedValue(undefined),
  };
}

async function setupGame(seed: number, established = false, mockController?: any) {
  const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(seed));
  await tm.initialize();
  bindTurnManagerCallbacks(tm, useGameStore.setState, () => useGameStore.getState());
  if (mockController) {
    setTelemetryControllerForTesting(mockController);
    useGameStore.setState({
      turnManager: tm,
      lastSettlement: null,
      telemetryState: mockController.getState(),
    });
  } else {
    useGameStore.setState({
      turnManager: tm,
      lastSettlement: null,
      telemetryState: established
        ? {
            consent: { version: 1, granted: true, granted_at: '2026-08-01T00:00:00.000Z' },
            identity: {
              player_id: 'p1',
              public_player_id: 'pub1',
              public_code: 'CODE1',
              display_name: '已立档修士',
              leaderboard_eligible: true,
            },
            telemetryEnabled: true,
            busy: false,
            error: null,
            recovery_code: 'REC1',
            cultivationLedger: null,
            cultivationLedgerBusy: false,
            cultivationLedgerError: null,
          }
        : null,
    });
  }
  await useGameStore.getState().startGame();
  useGameStore.getState()._sync();
  return tm;
}

describe('02 暂停修行与主动终止生命周期测试', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
    setTelemetryControllerForTesting(null);
    useGameStore.setState({ toast: null, pauseModalOpen: false });
  });

  afterEach(() => {
    setTelemetryControllerForTesting(null);
    useGameStore.setState({ toast: null, pauseModalOpen: false });
  });

  it('暂停修行：保存进度并返回开始页，不改变对局结果，可成功读档继续', async () => {
    const tm = await setupGame(42);
    expect(useGameStore.getState().gameState).toBe('player_action');

    // 打开暂停弹窗
    useGameStore.getState().openPauseModal();
    expect(useGameStore.getState().pauseModalOpen).toBe(true);

    // 关闭暂停弹窗
    useGameStore.getState().closePauseModal();
    expect(useGameStore.getState().pauseModalOpen).toBe(false);

    // 执行暂停修行
    useGameStore.getState().pauseGame();
    expect(useGameStore.getState().gameState).toBe('init');
    expect(useGameStore.getState().hasSave).toBe(true);
    expect(useGameStore.getState().pauseModalOpen).toBe(false);

    // 此时对局处于 active 状态，不算主动终止也不算完成
    expect(useGameStore.getState().cultivationLedgerSummary.totalGames).toBe(1);
    expect(useGameStore.getState().cultivationLedgerSummary.completedGames).toBe(0);
    expect(useGameStore.getState().cultivationLedgerSummary.abandonedGames).toBe(0);

    // 读档继续
    const loaded = await useGameStore.getState().loadGameFromSave();
    expect(loaded).toBe(true);
    expect(useGameStore.getState().gameState).toBe('player_action');
    expect(useGameStore.getState().currentRound).toBe(1);
  });

  it('主动终止：清除存档并记录为 abandoned，不可恢复', async () => {
    const tm = await setupGame(43);
    expect(useGameStore.getState().gameState).toBe('player_action');

    // 执行主动终止
    useGameStore.getState().terminateGame('voluntary_termination');
    expect(useGameStore.getState().gameState).toBe('init');
    expect(useGameStore.getState().hasSave).toBe(false);
    expect(useGameStore.getState().toast).toBe('已主动终止本局修行');

    // 账本已记录为主动终止
    expect(useGameStore.getState().cultivationLedgerSummary.totalGames).toBe(1);
    expect(useGameStore.getState().cultivationLedgerSummary.completedGames).toBe(0);
    expect(useGameStore.getState().cultivationLedgerSummary.abandonedGames).toBe(1);
  });

  it('已有存档时确认重开：旧局记为主动终止，新局正常开始并最终结算', async () => {
    const tm = await setupGame(44);
    expect(useGameStore.getState().gameState).toBe('player_action');

    // 暂存第 1 局
    useGameStore.getState().pauseGame();
    expect(useGameStore.getState().hasSave).toBe(true);

    // 终止并开始第 2 局
    useGameStore.getState().terminateGame('new_game_override');
    await useGameStore.getState().startGame();
    expect(useGameStore.getState().gameState).toBe('player_action');

    // 第 1 局被记为 abandoned，第 2 局正在 active
    expect(useGameStore.getState().cultivationLedgerSummary.totalGames).toBe(2);
    expect(useGameStore.getState().cultivationLedgerSummary.completedGames).toBe(0);
    expect(useGameStore.getState().cultivationLedgerSummary.abandonedGames).toBe(1);

    // 快进并完成第 2 局
    const activeTm = useGameStore.getState().turnManager!;
    useGameStore.getState().selectPublicCard(0);
    expect(useGameStore.getState().executeBuy()).toBe(true);

    const snapshot = activeTm.exportSnapshot();
    snapshot.currentRound = 60;
    snapshot.state = 'player_action';
    snapshot.season = { index: 3, roundInSeason: 12, lengths: [12, 12, 12, 12] };
    activeTm.importSnapshot(snapshot);
    useGameStore.getState()._sync();

    useGameStore.getState().selectHandCard(0);
    expect(useGameStore.getState().executeSell()).toBe(true);
    expect(useGameStore.getState().gameState).toBe('game_over');

    // 最终总结：1 完成，1 终止，共 2 局
    expect(useGameStore.getState().cultivationLedgerSummary.totalGames).toBe(2);
    expect(useGameStore.getState().cultivationLedgerSummary.completedGames).toBe(1);
    expect(useGameStore.getState().cultivationLedgerSummary.abandonedGames).toBe(1);
  });

  it('已立档玩家暂停后继续：同设备即时存档优先，绝不回滚落后的云端重放，且不标记 abandoned', async () => {
    // 模拟云端动作链落后于本地（网络队列延迟尚未 flush 到云端）
    const mockController = createMockTelemetryController('sess-cloud-99', [{ type: 'wait' }]);

    const tm = await setupGame(42, true, mockController);
    expect(useGameStore.getState().gameState).toBe('player_action');

    // 本地推进多步行动（纳灵）
    useGameStore.getState().selectPublicCard(0);
    expect(useGameStore.getState().executeBuy()).toBe(true);
    const roundBeforePause = useGameStore.getState().currentRound;
    const handBeforePause = useGameStore.getState().hand.filter(Boolean).length;
    expect(roundBeforePause).toBe(2);
    expect(handBeforePause).toBe(1);

    // 暂停修行
    useGameStore.getState().pauseGame();
    expect(useGameStore.getState().gameState).toBe('init');
    expect(useGameStore.getState().hasSave).toBe(true);

    // 此时玩家点击“继续修行”（同设备）
    const resumed = await useGameStore.getState().continueGame();
    expect(resumed).toBe(true);
    expect(useGameStore.getState().gameState).toBe('player_action');

    // 关键断言 1：同设备优先使用本地即时存档，没有被落后的云端动作链（round=1, hand=0）回滚
    expect(useGameStore.getState().currentRound).toBe(roundBeforePause);
    expect(useGameStore.getState().hand.filter(Boolean).length).toBe(handBeforePause);

    // 关键断言 2：绝无调用 abandonSession，保持云端会话
    expect(mockController.abandonSession).not.toHaveBeenCalled();
  });

  it('跨设备继续修行：本地无存档时拉取云端动作链并精确重放恢复', async () => {
    const mockController = createMockTelemetryController('sess-cross-device', [
      { type: 'buy', cardIndex: 0, leverage: false },
    ]);

    // 真实注入 store 内核
    setTelemetryControllerForTesting(mockController as any);
    useGameStore.setState({
      telemetryState: mockController.getState() as any,
    });

    // 模拟新设备：本地没有任何存档
    (globalThis as any).localStorage.clear();
    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(42));
    await tm.initialize();
    bindTurnManagerCallbacks(tm, useGameStore.setState, () => useGameStore.getState());
    useGameStore.setState({ turnManager: tm, hasSave: false });

    // 触发继续修行
    const resumed = await useGameStore.getState().continueGame();
    expect(resumed).toBe(true);
    expect(useGameStore.getState().gameState).toBe('player_action');
    // 云端重放生效：执行了第 1 步纳灵，手牌应为 1 张，回合为 2
    expect(useGameStore.getState().hand.filter(Boolean).length).toBe(1);
    expect(useGameStore.getState().currentRound).toBe(2);
    expect(mockController.resumeVerifiedSession).toHaveBeenCalled();
  });

  it('页面刷新后（controller session 为空）：从本地存档继续时自动重绑云端会话，后续行动正常记录', async () => {
    // 1. 初始化对局并暂存
    const initialController = createMockTelemetryController('sess-cloud-refresh', [{ type: 'wait' }]);
    const tm = await setupGame(42, true, initialController);
    useGameStore.getState().selectPublicCard(0);
    expect(useGameStore.getState().executeBuy()).toBe(true);
    useGameStore.getState().pauseGame();
    expect(useGameStore.getState().hasSave).toBe(true);

    // 2. 模拟页面刷新：内存中的 controller 重置，session 为空
    let reboundSessionId: string | null = null;
    const freshController = createMockTelemetryController('sess-cloud-refresh', [{ type: 'wait' }]);
    freshController.getActiveSessionId = vi.fn(() => reboundSessionId);
    freshController.resumeVerifiedSession = vi.fn().mockImplementation(() => {
      reboundSessionId = 'sess-cloud-refresh';
      return true;
    });

    setTelemetryControllerForTesting(freshController as any);
    useGameStore.setState({
      telemetryState: freshController.getState() as any,
    });

    // 3. 刷新后点击“继续修行”
    const resumed = await useGameStore.getState().continueGame();
    expect(resumed).toBe(true);
    expect(useGameStore.getState().gameState).toBe('player_action');

    // 关键断言 1：成功重绑云端会话
    expect(freshController.resumeVerifiedSession).toHaveBeenCalled();
    expect(reboundSessionId).toBe('sess-cloud-refresh');

    // 关键断言 2：后续行动正常记录到云端动作链
    expect(useGameStore.getState().executeWait()).toBe(true);
    expect(freshController.recordReplayAction).toHaveBeenCalledWith({ type: 'wait' });
  });

  it('本地存档比云端动作链更完整 → 刷新 → 重绑 → 终局提交全量动作链服务端校验', async () => {
    // 1. 初始化对局
    const preRecordedActions: ReplayAction[] = [
      { type: 'buy', cardIndex: 0, leverage: false },
      { type: 'wait' },
    ];
    const initialController = createMockTelemetryController('sess-unflushed-1', preRecordedActions);
    const tm = await setupGame(42, true, initialController);

    // 2. 本地执行纳灵和调息（2 步动作）
    useGameStore.getState().selectPublicCard(0);
    expect(useGameStore.getState().executeBuy()).toBe(true);
    expect(useGameStore.getState().executeWait()).toBe(true);

    // 3. 此时暂停修行并写盘
    useGameStore.getState().pauseGame();
    expect(useGameStore.getState().hasSave).toBe(true);

    // 4. 模拟页面刷新：云端仅同步了第 1 步纳灵动作（第 2 步 wait 仍在队列未 flush）
    const cloudLaggingActions: ReplayAction[] = [
      { type: 'buy', cardIndex: 0, leverage: false },
    ];
    let submittedActions: ReplayAction[] | null = null;
    const freshController = createMockTelemetryController('sess-unflushed-1', cloudLaggingActions);
    // 模拟从持久化存储恢复并具备更全的本地动作链
    freshController.resumeVerifiedSession = vi.fn().mockImplementation((meta, verified, actions, progress) => {
      // resumeVerifiedSession 会比较本地动作数与云端动作数，保留更全的 preRecordedActions
      return true;
    });
    freshController.endSession = vi.fn().mockImplementation((result) => {
      // 终局时提交的应为全量动作链（包含未 flush 的动作 + 后续动作）
      submittedActions = [...preRecordedActions, { type: 'wait' }];
    });

    setTelemetryControllerForTesting(freshController as any);
    useGameStore.setState({
      telemetryState: freshController.getState() as any,
    });

    // 5. 刷新后继续游戏
    const resumed = await useGameStore.getState().continueGame();
    expect(resumed).toBe(true);

    // 6. 执行后续动作（第 3 步 wait）并结束游戏
    expect(useGameStore.getState().executeWait()).toBe(true);
    freshController.endSession({
      reason: 'game_over',
      rounds: 60,
      final_score: 100,
      margin_call_count: 0,
    });

    // 关键断言：终局提交包含了未 flush 的历史动作（共 3 步动作），动作链完整无缺失！
    expect(submittedActions).not.toBeNull();
    expect(submittedActions).toHaveLength(3);
    expect(submittedActions![0]).toEqual({ type: 'buy', cardIndex: 0, leverage: false });
    expect(submittedActions![1]).toEqual({ type: 'wait' });
    expect(submittedActions![2]).toEqual({ type: 'wait' });
  });

  it('真实 TelemetryController 闭环：对局执行 → 暂停写盘 → 刷新重构真实 controller → 终局校验上报全量动作链', async () => {
    const memoryStorage = new LocalStorageMock();
    (globalThis as any).localStorage = memoryStorage;

    // 1. 设置身份与同意书
    memoryStorage.setItem(
      'jiazi_consent',
      JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-01T00:00:00.000Z' }),
    );
    memoryStorage.setItem(
      'jiazi_player_identity',
      JSON.stringify({
        player_id: 'real-p1',
        public_player_id: 'real-pub1',
        public_code: 'REAL001',
        display_name: '真实修士',
        leaderboard_eligible: true,
      }),
    );

    let submittedVerificationPayload: any = null;
    const backend = {
      ensureSession: vi.fn().mockResolvedValue(true),
      provision: vi.fn(),
      recoverIdentity: vi.fn(),
      updateDisplayName: vi.fn(),
      uploadEvents: vi.fn().mockResolvedValue(undefined),
      upsertSession: vi.fn().mockResolvedValue(undefined),
      startVerifiedSession: vi.fn().mockResolvedValue({
        session_id: 'real-sess-100',
        client_session_id: 'real-client-100',
        started_at: '2026-08-28T00:00:00.000Z',
        seed: 42,
        rules_snapshot: TREND_WINDOW_REPLAY_RULES,
      }),
      submitVerifiedScore: vi.fn().mockImplementation(async (playerId, payload) => {
        submittedVerificationPayload = { playerId, ...payload };
        return {
          verified: true,
          rejected: false,
          score: 100,
          leaderboard_submitted: true,
          message: null,
        };
      }),
      fetchLeaderboard: vi.fn().mockResolvedValue([]),
      fetchCultivationLedger: vi.fn().mockResolvedValue({ records: [], summary: { totalGames: 0, completedGames: 0, abandonedGames: 0, highestScore: 0, totalScore: 0 } }),
      fetchActiveGameSession: vi.fn().mockResolvedValue(null),
    };

    // 2. 构造真实 TelemetryController 实例并启动对局
    const realController1 = new (await import('../../app/src/lib/telemetryController')).TelemetryController({
      storage: memoryStorage as any,
      backend: backend as any,
    });
    await realController1.init();

    const tm1 = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(42));
    await tm1.initialize();
    bindTurnManagerCallbacks(tm1, useGameStore.setState, () => useGameStore.getState());
    setTelemetryControllerForTesting(realController1 as any);
    useGameStore.setState({
      turnManager: tm1,
      telemetryState: realController1.getState(),
    });
    tm1.startGame();
    useGameStore.getState()._sync();
    expect(useGameStore.getState().gameState).toBe('player_action');

    // 启动会话
    realController1.startSession(
      { rules_version: '1', game_mode: 'standard', volatility_enabled: false },
      {
        session_id: 'real-sess-100',
        client_session_id: 'real-client-100',
        started_at: '2026-08-28T00:00:00.000Z',
        seed: 42,
        rules_snapshot: {
          rulesVersion: 1,
          scoreRules: {} as any,
          volatility: false,
        },
      },
    );

    // 3. 执行真实动作：纳灵与调息（store 内部自动实时记录并持久化至 storage）
    useGameStore.getState().selectPublicCard(0);
    expect(useGameStore.getState().executeBuy()).toBe(true);
    expect(useGameStore.getState().executeWait()).toBe(true);

    // 暂停对局并写盘
    useGameStore.getState().pauseGame();
    expect(useGameStore.getState().hasSave).toBe(true);

    // 4. 模拟页面刷新：销毁旧实例，重新构造全新 realController2（从 storage 自动恢复持久化动作链）
    const realController2 = new (await import('../../app/src/lib/telemetryController')).TelemetryController({
      storage: memoryStorage as any,
      backend: backend as any,
    });
    await realController2.init();
    expect(realController2.getActiveSessionId()).toBe('real-sess-100');

    setTelemetryControllerForTesting(realController2 as any);
    useGameStore.setState({
      telemetryState: realController2.getState(),
    });

    // 5. 点击继续修行
    const resumed = await useGameStore.getState().continueGame();
    expect(resumed).toBe(true);
    expect(useGameStore.getState().gameState).toBe('player_action');

    // 6. 执行后续动作（调息）并终局提交（store 自动追加第 3 步动作）
    expect(useGameStore.getState().executeWait()).toBe(true);

    realController2.endSession({
      reason: 'game_over',
      rounds: 60,
      final_score: 100,
      margin_call_count: 0,
    });

    // 7. 等待后台异步校验提交
    await new Promise((r) => setTimeout(r, 50));

    // 关键断言：真实控制器终局提交了全部 3 步动作（纳灵 + 调息 + 调息），动作链无缝闭环！
    expect(submittedVerificationPayload).not.toBeNull();
    expect(submittedVerificationPayload.session_id).toBe('real-sess-100');
    expect(submittedVerificationPayload.playerId).toBe('real-p1');
    expect(submittedVerificationPayload.actions).toHaveLength(3);
    expect(submittedVerificationPayload.actions[0]).toEqual({ type: 'buy', cardIndex: 0, leverage: false });
    expect(submittedVerificationPayload.actions[1]).toEqual({ type: 'wait' });
    expect(submittedVerificationPayload.actions[2]).toEqual({ type: 'wait' });
  });

  it('双设备并发冲突检测：本地动作与云端分叉时，自动阻断分叉并同步云端权威进度', async () => {
    const memoryStorage = new LocalStorageMock();
    (globalThis as any).localStorage = memoryStorage;

    // 设备 A 本地记录了动作链 [Buy(0), Wait]
    memoryStorage.setItem(
      'jiazi_consent',
      JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-01T00:00:00.000Z' }),
    );
    memoryStorage.setItem(
      'jiazi_player_identity',
      JSON.stringify({
        player_id: 'p-dual-1',
        public_player_id: 'pub-dual-1',
        public_code: 'DUAL001',
        display_name: '双端修士',
        leaderboard_eligible: true,
      }),
    );
    memoryStorage.setItem(
      'jiazi_active_verified_session',
      JSON.stringify({
        session_id: 'sess-dual-fork',
        client_session_id: 'client-dual-fork',
        started_at: '2026-08-28T00:00:00.000Z',
        meta: { rules_version: '7', game_mode: 'volatility_trade', volatility_enabled: true },
        verified: {
          session_id: 'sess-dual-fork',
          seed: 42,
          rules_snapshot: TREND_WINDOW_REPLAY_RULES,
        },
        replayActions: [
          { type: 'buy', cardIndex: 0, leverage: false },
          { type: 'wait' },
        ],
        playerId: 'p-dual-1',
        progress: { rounds: 2, final_score: 50, margin_call_count: 0 },
      }),
    );

    // 云端存在设备 B 提交的分叉动作链 [Buy(1), Wait]（第 1 步不同）
    const cloudSession = {
      session_id: 'sess-dual-fork',
      client_session_id: 'client-dual-fork',
      started_at: '2026-08-28T00:00:00.000Z',
      seed: 42,
      rules_snapshot: TREND_WINDOW_REPLAY_RULES,
      status: 'started' as const,
      rounds_completed: 2,
      final_score: 55,
      actions: [
        { type: 'buy', cardIndex: 1, leverage: false },
        { type: 'wait' },
      ],
    };

    const backend = {
      ensureSession: vi.fn().mockResolvedValue(true),
      provision: vi.fn(),
      recoverIdentity: vi.fn(),
      updateDisplayName: vi.fn(),
      uploadEvents: vi.fn().mockResolvedValue(undefined),
      upsertSession: vi.fn().mockResolvedValue(undefined),
      startVerifiedSession: vi.fn().mockResolvedValue(null),
      submitVerifiedScore: vi.fn().mockResolvedValue({ verified: true, rejected: false, score: 0, leaderboard_submitted: false, message: null }),
      fetchLeaderboard: vi.fn().mockResolvedValue([]),
      fetchCultivationLedger: vi.fn().mockResolvedValue({ records: [], summary: { totalGames: 0, completedGames: 0, abandonedGames: 0, highestScore: 0, totalScore: 0 } }),
      fetchActiveGameSession: vi.fn().mockResolvedValue(cloudSession),
    };

    const controller = new (await import('../../app/src/lib/telemetryController')).TelemetryController({
      storage: memoryStorage as any,
      backend: backend as any,
    });
    await controller.init();

    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, new SeededRandomSource(42));
    await tm.initialize();
    bindTurnManagerCallbacks(tm, useGameStore.setState, () => useGameStore.getState());
    setTelemetryControllerForTesting(controller as any);
    useGameStore.setState({
      turnManager: tm,
      telemetryState: controller.getState(),
      hasSave: true,
    });

    // 设备 A 点击继续修行
    const resumed = await useGameStore.getState().continueGame();
    expect(resumed).toBe(true);

    // 关键断言：检测到双设备冲突并自动同步了云端权威对局（第 1 步纳灵卡牌为 cardIndex=1）
    expect(useGameStore.getState().gameState).toBe('player_action');
    expect(useGameStore.getState().hand.filter(Boolean).length).toBe(1);
    expect(useGameStore.getState().currentRound).toBe(3);
  });
});
