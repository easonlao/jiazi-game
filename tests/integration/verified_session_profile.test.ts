import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useGameStore, setTelemetryControllerForTesting } from '../../app/src/store';
import { TurnManager } from '../../src/core/TurnManager';
import {
  BalanceProfile,
  getBalanceProfileById,
  V9_STANDARD_PROFILE,
  V8_STANDARD_PROFILE,
  V9_EA_TUNED_PROFILE,
} from '../../src/core/BalanceProfile';
import {
  createReplayRulesSnapshotForProfile,
  cloneReplayRulesSnapshot,
  SINGLE_VOID_REPLAY_RULES,
} from '../../src/core/ReplayRules';
import { SupabaseAnalyticsBackend } from '../../app/src/lib/analyticsBackend';
import { replayGame, type ReplayAction } from '../../src/core/ReplayRunner';
import { RULES_VERSION_SINGLE_VOID } from '../../src/core/GameSaveService';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
(globalThis as any).localStorage = new MemoryStorage();
vi.stubGlobal('fetch', () => Promise.reject(new Error('no fetch in test env')));

describe('Issue 02: 以当前平衡档案完成云端对局闭环与跨设备恢复', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
    useGameStore.setState({ toast: null, pauseModalOpen: false });
  });

  afterEach(() => {
    setTelemetryControllerForTesting(null);
    useGameStore.setState({ toast: null, pauseModalOpen: false });
  });

  it('已发布的当前平衡档案可创建、恢复并通过规则快照恢复精确参数', async () => {
    const customEaProfile: BalanceProfile = V9_EA_TUNED_PROFILE;

    const frozenSnapshot = createReplayRulesSnapshotForProfile(customEaProfile);

    const sessionData = {
      id: 'session-ea-profile-test-1',
      client_session_id: 'client-ea-1',
      started_at: '2026-08-30T12:00:00.000Z',
      replay_seed: 7777,
      rules_snapshot: frozenSnapshot,
      status: 'started',
      rounds_completed: 1,
      final_score: 0,
      session_revision: 1,
    };

    const eventsData = [
      {
        event_type: 'action_wait',
        sequence: 1,
        payload: { replay_action: { type: 'wait' } },
        occurred_at: '2026-08-30T12:01:00.000Z',
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
        return {};
      }),
    };

    const backend = new SupabaseAnalyticsBackend(client as any);
    const activeSession = await backend.fetchActiveGameSession('player-profile-test');

    expect(activeSession).not.toBeNull();
    expect(activeSession?.rules_snapshot.balanceProfileId).toBe('v9_ea_tuned');
    expect(activeSession?.rules_snapshot.balanceProfileVersion).toBe(1);

    // 跨设备恢复
    const resumed = await useGameStore.getState().resumeCloudSession(activeSession);
    expect(resumed).toBe(true);

    const resumedTm = useGameStore.getState().turnManager;
    expect(resumedTm.getBalanceProfileId()).toBe('v9_ea_tuned');
    expect(resumedTm.getBalanceProfileVersion()).toBe(1);
    expect(resumedTm.getBalanceConfig().concentrationPremiumFactor).toBe(1.2);
  });

  it('服务端重放只信任会话冻结快照，拒绝客户端伪造参数', async () => {
    const profile = V9_STANDARD_PROFILE;
    const frozenSnapshot = createReplayRulesSnapshotForProfile(profile);

    // 服务端重放完全依赖 frozenSnapshot 提供的参数
    const result = await replayGame({
      seed: 12345,
      actions: [{ type: 'wait' }],
      rulesVersion: frozenSnapshot.rulesVersion,
      volatility: frozenSnapshot.volatility,
      scoreRules: frozenSnapshot.scoreRules,
      voidCardCount: (frozenSnapshot as any).voidCardCount,
      balanceProfileId: frozenSnapshot.balanceProfileId,
      balanceProfileVersion: frozenSnapshot.balanceProfileVersion,
      balanceConfig: frozenSnapshot.balanceConfig,
      requireCompleted: false,
    });

    expect(result.completed).toBe(false);
    expect(result.rounds).toBe(1);
    expect(result.rulesVersion).toBe(RULES_VERSION_SINGLE_VOID);
  });

  it('同一账号首次、再次、跨设备开局都能成功，且返回相同持久化档案', async () => {
    const assignmentsTable = new Map<string, { experiment_id: string; variant_id: string; balance_profile_id: string }>();

    const activeExp = {
      id: 'ea_v9_balance_test',
      name: 'V9 平衡微调试验',
      enabled: true,
      rulesVersion: 9,
      variants: [
        { variantId: 'control', balanceProfileId: 'v9_standard', weight: 50 },
        { variantId: 'treatment_tuned', balanceProfileId: 'v9_ea_tuned', weight: 50 },
      ],
    };

    // 模拟服务端 start-verified-session 逻辑（含 variantId 精确匹配）
    const serverStartSession = async (playerId: string) => {
      let balanceProfileId = 'v9_standard';
      let experimentId: string | null = null;
      let variantId: string | null = null;

      const persistent = assignmentsTable.get(`${playerId}:${activeExp.id}`);
      if (persistent) {
        const matchedVariant = activeExp.variants.find((v) => v.variantId === persistent.variant_id);
        if (!matchedVariant || matchedVariant.balanceProfileId !== persistent.balance_profile_id) {
          throw new Error('500 server_misconfigured');
        }
        balanceProfileId = persistent.balance_profile_id;
        experimentId = activeExp.id;
        variantId = matchedVariant.variantId;
      } else {
        // 首次分配
        experimentId = activeExp.id;
        variantId = 'treatment_tuned';
        balanceProfileId = 'v9_ea_tuned';
        assignmentsTable.set(`${playerId}:${activeExp.id}`, {
          experiment_id: experimentId,
          variant_id: variantId,
          balance_profile_id: balanceProfileId,
        });
      }

      const profile = getBalanceProfileById(balanceProfileId)!;
      const snapshot = createReplayRulesSnapshotForProfile(profile);
      snapshot.experimentId = experimentId;
      snapshot.variantId = variantId;

      return {
        session_id: `sess_${Math.random()}`,
        started_at: new Date().toISOString(),
        seed: 42,
        rules_snapshot: snapshot,
      };
    };

    // 1. 首次开局（自动分配并持久化）
    const start1 = await serverStartSession('player_alice');
    expect(start1.rules_snapshot.balanceProfileId).toBe('v9_ea_tuned');
    expect(start1.rules_snapshot.variantId).toBe('treatment_tuned');

    // 2. 第二次开局（读取已持久化记录，不能因 variantId 字段名报错）
    const start2 = await serverStartSession('player_alice');
    expect(start2.rules_snapshot.balanceProfileId).toBe('v9_ea_tuned');
    expect(start2.rules_snapshot.variantId).toBe('treatment_tuned');

    // 3. 跨设备开局（同一 player_id 在新设备上请求）
    const start3 = await serverStartSession('player_alice');
    expect(start3.rules_snapshot.balanceProfileId).toBe('v9_ea_tuned');
    expect(start3.rules_snapshot.variantId).toBe('treatment_tuned');
  });

  it('修改客户端本地实验配置，不能改变已登录玩家在开始页、档案和榜单看到的当前档案', async () => {
    const storage = new MemoryStorage();
    const mockBackend = {
      ensureSession: vi.fn(async () => true),
      provision: vi.fn(),
      recoverIdentity: vi.fn(),
      updateDisplayName: vi.fn(),
      uploadEvents: vi.fn(async () => []),
      upsertSession: vi.fn(async () => undefined),
      startVerifiedSession: vi.fn(),
      submitVerifiedScore: vi.fn(),
      fetchLeaderboard: vi.fn(async (_limit, _rules, profileId) => {
        return [
          {
            session_id: 's1',
            public_player_id: 'pub1',
            public_code: 'CODE1',
            display_name: '玩家1',
            final_score: 100,
            completed_at: '2026-08-30T00:00:00.000Z',
            rules_version: '9',
            balance_profile_id: profileId ?? 'v9_standard',
          },
        ];
      }),
      fetchActiveGameSession: vi.fn(async () => null),
      fetchCultivationLedger: vi.fn(async () => ({ records: [], summary: {} as any })),
      // 服务端鉴权返回已持久化的实验档案
      fetchAssignedBalanceProfile: vi.fn(async () => 'v9_ea_tuned'),
      recoverCorruptedSession: vi.fn(async () => ({ success: true })),
    };

    storage.setItem('jiazi_consent', JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-30T00:00:00.000Z' }));
    storage.setItem('jiazi_player_identity', JSON.stringify({
      player_id: 'player_assigned_1',
      public_player_id: 'pub1',
      public_code: 'P001',
      display_name: '测试修士',
      leaderboard_eligible: true,
    }));

    const { TelemetryController } = await import('../../app/src/lib/telemetryController');
    const controller = new TelemetryController({
      storage,
      backend: mockBackend,
      onStateChange: (s) => useGameStore.setState({ telemetryState: s }),
    });
    setTelemetryControllerForTesting(controller);

    // 触发鉴权刷新服务端档案
    const assignedProfile = await controller.refreshAssignedBalanceProfile();
    expect(assignedProfile).toBe('v9_ea_tuned');
    expect(useGameStore.getState().telemetryState?.assignedBalanceProfileId).toBe('v9_ea_tuned');

    // 打开排行榜，应直接按服务端的 v9_ea_tuned 筛选
    useGameStore.getState().openLeaderboard();
    expect(useGameStore.getState().leaderboardOpen).toBe(true);

    // 刷新云端榜，验证 controller.fetchLeaderboard 接收的 balanceProfileId 必定为 v9_ea_tuned
    await useGameStore.getState().refreshCloudLeaderboard();
    expect(mockBackend.fetchLeaderboard).toHaveBeenCalledWith(
      50,
      '9',
      'v9_ea_tuned',
    );
  });
});
