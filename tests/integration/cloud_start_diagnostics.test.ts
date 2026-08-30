import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useGameStore,
  setTelemetryControllerForTesting,
  setCultivationLedgerForTesting,
} from '../../app/src/store';
import {
  TelemetryController,
  type PlayerIdentity,
  type StorageProvider,
} from '../../app/src/lib/telemetryController';
import { CultivationLedgerService } from '../../app/src/lib/cultivationLedger';
import type {
  AnalyticsBackend,
  CultivationLedgerSnapshot,
  SessionUpsert,
  VerifiedSessionStartResult,
} from '../../app/src/lib/analyticsBackend';
import {
  CURRENT_RULES_VERSION,
  TurnManager,
  cloneReplayRulesSnapshot,
  CURRENT_REPLAY_RULES,
} from '../../src/core';

class MemoryStorage implements StorageProvider {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const memoryStorage = new MemoryStorage();
(globalThis as any).localStorage = memoryStorage;

function createMockBackend(): AnalyticsBackend & {
  mockStartResult: VerifiedSessionStartResult;
} {
  return {
    mockStartResult: {
      success: true,
      session: {
        session_id: 'mock-session-001',
        started_at: '2026-08-30T00:00:00.000Z',
        seed: 123456,
        rules_snapshot: cloneReplayRulesSnapshot(CURRENT_REPLAY_RULES),
      },
    },
    ensureSession: vi.fn(async () => true),
    provision: vi.fn(async (_name: string) => ({
      identity: {
        player_id: 'player-001',
        public_player_id: 'pub-001',
        public_code: 'CODE001',
        display_name: _name,
        leaderboard_eligible: true,
      },
      recovery_code: 'RECOVERY-CODE-1',
    })),
    recoverIdentity: vi.fn(async () => ({
      player_id: 'player-001',
      public_player_id: 'pub-001',
      public_code: 'CODE001',
      display_name: '测试修士',
      leaderboard_eligible: true,
    })),
    updateDisplayName: vi.fn(async (_pid: string, _name: string): Promise<PlayerIdentity> => ({
      player_id: 'player-001',
      public_player_id: 'pub-001',
      public_code: 'CODE001',
      display_name: _name,
      leaderboard_eligible: true,
    })),
    uploadEvents: vi.fn(async () => []),
    upsertSession: vi.fn(async (_pid: string, _session: SessionUpsert) => undefined),
    startVerifiedSession: vi.fn(async function (this: any) {
      return this.mockStartResult;
    }),
    submitVerifiedScore: vi.fn(async () => ({
      verified: true,
      rejected: false,
      score: 100,
      leaderboard_submitted: true,
      message: null,
    })),
    fetchLeaderboard: vi.fn(async () => []),
    fetchCultivationLedger: vi.fn(async (): Promise<CultivationLedgerSnapshot> => ({
      records: [],
      summary: {
        totalGames: 0,
        completedGames: 0,
        abandonedGames: 0,
        averageScore: null,
        highestScore: null,
        ruleSummaries: [],
      },
    })),
    fetchActiveGameSession: vi.fn(async () => null),
    recoverCorruptedSession: vi.fn(async () => ({ success: true })),
  };
}

describe('云端开局错误诊断与本地降级隔离集成测试', () => {
  let storage: MemoryStorage;
  let backend: ReturnType<typeof createMockBackend>;
  let controller: TelemetryController;
  let ledger: CultivationLedgerService;

  beforeEach(async () => {
    storage = memoryStorage;
    storage.clear();
    // 预置已立档修士身份
    storage.setItem(
      'jiazi_player_identity',
      JSON.stringify({
        player_id: 'player-001',
        public_player_id: 'pub-001',
        public_code: 'CODE001',
        display_name: '测试修士',
        leaderboard_eligible: true,
      }),
    );
    storage.setItem(
      'jiazi_consent',
      JSON.stringify({ version: 1, granted: true, timestamp: Date.now() }),
    );

    backend = createMockBackend();
    controller = new TelemetryController({
      storage,
      backend,
      onStateChange: (state) => {
        useGameStore.setState({ telemetryState: state });
      },
    });
    ledger = new CultivationLedgerService(storage);

    setTelemetryControllerForTesting(controller);
    setCultivationLedgerForTesting(ledger);

    const tm = new TurnManager(undefined, undefined, {
      storage,
      rulesVersion: CURRENT_REPLAY_RULES.rulesVersion,
      scoreRules: CURRENT_REPLAY_RULES.scoreRules,
      volatility: CURRENT_REPLAY_RULES.volatility,
      voidConfig: { voidCardCount: 3 },
    });
    await tm.initialize();
    useGameStore.setState({
      turnManager: tm,
      gameState: 'init',
      hasSave: false,
      startingGame: false,
      startGameError: null,
      toast: null,
    });
  });

  it('1. 正常网络与身份下，已立档玩家成功开启 V8 云端对局并获得 seed 与规则快照', async () => {
    await controller.init();
    const store = useGameStore.getState();

    const ok = await store.startNewGame(false);
    expect(ok).toBe(true);

    const afterState = useGameStore.getState();
    expect(afterState.startGameError).toBeNull();
    expect(afterState.gameState).toBe('player_action');
    expect(controller.getActiveSessionId()).toBe('mock-session-001');

    // 修行账本应记录该会话 ID
    const ledgerState = storage.getItem('jiazi_cultivation_ledger');
    expect(ledgerState).toContain('mock-session-001');
  });

  it('2. 网络不可达时，开局失败并呈现具体错误「网络连接失败，无法访问云端服务器」', async () => {
    backend.mockStartResult = {
      success: false,
      error: {
        code: 'network_error',
        message: 'Failed to fetch',
        userMessage: '网络连接失败，无法访问云端服务器',
        statusCode: null,
      },
    };

    await controller.init();
    const store = useGameStore.getState();

    const ok = await store.startNewGame(false);
    expect(ok).toBe(false);

    const afterState = useGameStore.getState();
    expect(afterState.startGameError).toContain('网络连接失败，无法访问云端服务器');
    expect(afterState.startGameError).toContain('可重试，或改为本地开局');
    expect(afterState.toast).toBe('网络连接失败，无法访问云端服务器');
    expect(controller.getActiveSessionId()).toBeNull();
  });

  it('3. 鉴权失效 (401/403) 时，呈现具体身份错误并提示在修行档案立档', async () => {
    backend.mockStartResult = {
      success: false,
      error: {
        code: 'identity_not_ready',
        message: 'identity_not_ready',
        userMessage: '修士身份尚未在云端立档（请先在修行档案中生成玩家 ID）',
        statusCode: 403,
      },
    };

    await controller.init();
    const store = useGameStore.getState();

    const ok = await store.startNewGame(false);
    expect(ok).toBe(false);

    const afterState = useGameStore.getState();
    expect(afterState.startGameError).toContain('修士身份尚未在云端立档');
    expect(afterState.toast).toContain('修士身份尚未在云端立档');
  });

  it('4. 规则版本不一致 (409) 时，呈现具体版本不一致提示', async () => {
    backend.mockStartResult = {
      success: false,
      error: {
        code: 'rules_version_mismatch',
        message: 'rules_version_not_supported',
        userMessage: '云端规则版本与当前客户端不一致（请刷新网页）',
        statusCode: 409,
      },
    };

    await controller.init();
    const store = useGameStore.getState();

    const ok = await store.startNewGame(false);
    expect(ok).toBe(false);

    const afterState = useGameStore.getState();
    expect(afterState.startGameError).toContain('云端规则版本与当前客户端不一致');
    expect(afterState.toast).toContain('云端规则版本与当前客户端不一致');
  });

  it('5. 云端服务 500 时，呈现具体服务不可用提示', async () => {
    backend.mockStartResult = {
      success: false,
      error: {
        code: 'service_unavailable',
        message: 'internal_error',
        userMessage: '云端开局服务暂时不可用（HTTP 5xx，请稍后重试）',
        statusCode: 500,
      },
    };

    await controller.init();
    const store = useGameStore.getState();

    const ok = await store.startNewGame(false);
    expect(ok).toBe(false);

    const afterState = useGameStore.getState();
    expect(afterState.startGameError).toContain('云端开局服务暂时不可用');
  });

  it('6. 失败后选择「本地开局（不上云端榜）」，彻底隔离云端会话、账本与排行榜', async () => {
    // 模拟前次云端失败
    backend.mockStartResult = {
      success: false,
      error: {
        code: 'network_error',
        message: 'Failed to fetch',
        userMessage: '网络连接失败，无法访问云端服务器',
      },
    };
    await controller.init();

    const store = useGameStore.getState();
    await store.startNewGame(false);
    expect(useGameStore.getState().startGameError).not.toBeNull();

    // 玩家点击「本地开局（不上云端榜）」
    const localOk = await store.startNewGame(true);
    expect(localOk).toBe(true);

    const afterState = useGameStore.getState();
    expect(afterState.gameState).toBe('player_action');
    expect(afterState.isLocalOnlyGame).toBe(true);
    // 本地局不创建云端会话
    expect(controller.getActiveSessionId()).toBeNull();
    // 本地局不创建进行中修行账本
    expect(ledger.getRecords()).toHaveLength(0);

    // 终局结算
    afterState.turnManager?.endGame();
    controller.endSession({ reason: 'game_over', rounds: 60, final_score: 888, margin_call_count: 0 });

    // 不写入修行账本，不污染历史统计
    expect(ledger.getRecords()).toHaveLength(0);
    // 不提交云端校验榜
    expect(backend.submitVerifiedScore).not.toHaveBeenCalled();
  });

  it('7. 失败后重试云端开局，服务恢复后顺利进入云端对局', async () => {
    // 第一次尝试：服务 500 失败
    backend.mockStartResult = {
      success: false,
      error: {
        code: 'service_unavailable',
        message: 'internal_error',
        userMessage: '云端开局服务暂时不可用（HTTP 5xx，请稍后重试）',
        statusCode: 500,
      },
    };
    await controller.init();

    let store = useGameStore.getState();
    const failRes = await store.startNewGame(false);
    expect(failRes).toBe(false);
    expect(useGameStore.getState().startGameError).toContain('云端开局服务暂时不可用');

    // 服务恢复：第二次重试
    backend.mockStartResult = {
      success: true,
      session: {
        session_id: 'mock-session-retry-002',
        started_at: '2026-08-30T00:01:00.000Z',
        seed: 654321,
        rules_snapshot: cloneReplayRulesSnapshot(CURRENT_REPLAY_RULES),
      },
    };

    store = useGameStore.getState();
    const retryOk = await store.startNewGame(false);
    expect(retryOk).toBe(true);

    const afterState = useGameStore.getState();
    expect(afterState.startGameError).toBeNull();
    expect(afterState.gameState).toBe('player_action');
    expect(afterState.isLocalOnlyGame).toBe(false);
    expect(controller.getActiveSessionId()).toBe('mock-session-retry-002');
  });

  it('8. 未配置云端服务 (NoopAnalyticsBackend) 时，开局明确展示「云端服务未配置」', async () => {
    const { NoopAnalyticsBackend } = await import('../../app/src/lib/analyticsBackend');
    const noop = new NoopAnalyticsBackend();
    const noopController = new TelemetryController({
      storage,
      backend: noop,
      onStateChange: (state) => {
        useGameStore.setState({ telemetryState: state });
      },
    });
    setTelemetryControllerForTesting(noopController);
    await noopController.init();

    const store = useGameStore.getState();
    const ok = await store.startNewGame(false);
    expect(ok).toBe(false);

    const afterState = useGameStore.getState();
    expect(afterState.startGameError).toContain('云端服务未配置');
    expect(afterState.toast).toContain('云端服务未配置');
  });

  it('9. 云端返回数据损坏/格式异常 (service_contract_error) 时，呈现具体响应损坏提示', async () => {
    backend.mockStartResult = {
      success: false,
      error: {
        code: 'service_contract_error',
        message: 'Invalid verified session response structure',
        userMessage: '云端返回的对局种子或规则快照格式异常（请稍后重试）',
        statusCode: 200,
      },
    };
    await controller.init();

    const store = useGameStore.getState();
    const ok = await store.startNewGame(false);
    expect(ok).toBe(false);

    const afterState = useGameStore.getState();
    expect(afterState.startGameError).toContain('格式异常');
    expect(afterState.toast).toContain('格式异常');
  });

  it('10. 本地试玩局经页面刷新与继续后，持久化状态正确恢复且 100% 隔离修行账本与云端', async () => {
    await controller.init();
    const store = useGameStore.getState();

    // 1. 本地试玩开局
    const ok = await store.startNewGame(true);
    expect(ok).toBe(true);
    expect(useGameStore.getState().isLocalOnlyGame).toBe(true);
    expect(ledger.getRecords()).toHaveLength(0);

    // 2. 推进 1 轮并保存
    const tm = useGameStore.getState().turnManager!;
    tm.executeWait();
    tm.saveGame();

    // 3. 模拟页面刷新（Zustand 状态重置为默认值 isLocalOnlyGame = false）
    const freshTm = new TurnManager(undefined, undefined, {
      storage,
      rulesVersion: CURRENT_REPLAY_RULES.rulesVersion,
      scoreRules: CURRENT_REPLAY_RULES.scoreRules,
      volatility: CURRENT_REPLAY_RULES.volatility,
      voidConfig: { voidCardCount: 3 },
    });
    await freshTm.initialize();
    useGameStore.setState({
      turnManager: freshTm,
      gameState: 'init',
      hasSave: true,
      isLocalOnlyGame: false,
    });

    // 4. 点击继续修行
    const continueOk = await useGameStore.getState().continueGame();
    expect(continueOk).toBe(true);

    // 5. 验证状态与账本隔离
    const reloadedState = useGameStore.getState();
    expect(reloadedState.isLocalOnlyGame).toBe(true);
    expect(controller.getActiveSessionId()).toBeNull();
    // 账本严格保持为 0，不被 resumeActiveGame 污染！
    expect(ledger.getRecords()).toHaveLength(0);

    // 6. 终局后仍不计入修行档案
    reloadedState.turnManager?.endGame();
    expect(ledger.getRecords()).toHaveLength(0);
  });
});
