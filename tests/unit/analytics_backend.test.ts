import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAnalyticsBackend, NoopAnalyticsBackend } from '../../app/src/lib/analyticsBackend';
import { summarizeCultivationLedger } from '../../app/src/lib/cultivationLedger';
import { cloneReplayRulesSnapshot } from '../../src/core';

describe('SupabaseAnalyticsBackend session lifecycle', () => {
  it('writes sessions through the owner-checked RPC', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const client = { rpc } as unknown as SupabaseClient;
    const backend = new SupabaseAnalyticsBackend(client);

    await backend.upsertSession('player-1', {
      session_id: 'session-1',
      started_at: '2026-08-10T00:00:00.000Z',
      status: 'started',
      rounds_completed: 0,
      final_score: 0,
      rules_version: '3',
      game_mode: 'volatility_trade',
      app_version: '0.2.0',
      consent_version: '1',
    });

    expect(rpc).toHaveBeenCalledWith('upsert_game_session', {
      p_player_id: 'player-1',
      p_session_id: 'session-1',
      p_client_session_id: 'session-1',
      p_started_at: '2026-08-10T00:00:00.000Z',
      p_status: 'started',
      p_rounds_completed: 0,
      p_final_score: 0,
      p_rules_version: '3',
      p_game_mode: 'volatility_trade',
      p_app_version: '0.2.0',
      p_consent_version: '1',
      p_ended_at: null,
      p_expected_session_revision: null,
    });
  });

  it('requests the exact rules version and returns success when creating a verified session', async () => {
    const invoke = vi.fn(async () => ({
      data: {
        session_id: 'verified-session',
        started_at: '2026-08-10T00:00:00.000Z',
        seed: 42,
        rules_snapshot: cloneReplayRulesSnapshot(),
      },
      error: null,
    }));
    const client = { functions: { invoke } } as unknown as SupabaseClient;
    const backend = new SupabaseAnalyticsBackend(client);

    const result = await backend.startVerifiedSession('player-1', {
      session_id: 'client-session',
      started_at: '2026-08-10T00:00:00.000Z',
      status: 'started',
      rounds_completed: 0,
      final_score: 0,
      rules_version: '8',
      game_mode: 'volatility_trade',
      app_version: '0.2.0',
      consent_version: '1',
    });

    expect(invoke).toHaveBeenCalledWith('start-verified-session', {
      body: expect.objectContaining({ requested_rules_version: '8' }),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.session.session_id).toBe('verified-session');
      expect(result.session.seed).toBe(42);
    }
  });

  it('correctly categorizes start errors by HTTP status and network type', async () => {
    // 1. 401 Unauthorized
    const client401 = {
      functions: {
        invoke: vi.fn(async () => ({
          data: null,
          error: {
            message: 'unauthorized',
            context: new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
          },
        })),
      },
    } as unknown as SupabaseClient;
    const backend401 = new SupabaseAnalyticsBackend(client401);
    const res401 = await backend401.startVerifiedSession('p1', {
      session_id: 's1',
      started_at: '2026-08-10T00:00:00.000Z',
      status: 'started',
      rounds_completed: 0,
      final_score: 0,
      rules_version: '8',
      game_mode: 'volatility_trade',
      app_version: '0.2.0',
      consent_version: '1',
    });
    expect(res401.success).toBe(false);
    if (!res401.success) {
      expect(res401.error.code).toBe('identity_not_ready');
      expect(res401.error.userMessage).toContain('修士身份鉴权已失效');
    }

    // 2. 403 Forbidden (identity_not_ready)
    const client403 = {
      functions: {
        invoke: vi.fn(async () => ({
          data: null,
          error: {
            message: 'identity_not_ready',
            context: new Response(JSON.stringify({ error: 'identity_not_ready' }), { status: 403 }),
          },
        })),
      },
    } as unknown as SupabaseClient;
    const backend403 = new SupabaseAnalyticsBackend(client403);
    const res403 = await backend403.startVerifiedSession('p1', {
      session_id: 's1',
      started_at: '2026-08-10T00:00:00.000Z',
      status: 'started',
      rounds_completed: 0,
      final_score: 0,
      rules_version: '8',
      game_mode: 'volatility_trade',
      app_version: '0.2.0',
      consent_version: '1',
    });
    expect(res403.success).toBe(false);
    if (!res403.success) {
      expect(res403.error.code).toBe('identity_not_ready');
      expect(res403.error.userMessage).toContain('修士身份尚未在云端立档');
    }

    // 3. 409 Rules Version Mismatch
    const client409 = {
      functions: {
        invoke: vi.fn(async () => ({
          data: null,
          error: {
            message: 'rules_version_not_supported',
            context: new Response(JSON.stringify({ error: 'rules_version_not_supported' }), { status: 409 }),
          },
        })),
      },
    } as unknown as SupabaseClient;
    const backend409 = new SupabaseAnalyticsBackend(client409);
    const res409 = await backend409.startVerifiedSession('p1', {
      session_id: 's1',
      started_at: '2026-08-10T00:00:00.000Z',
      status: 'started',
      rounds_completed: 0,
      final_score: 0,
      rules_version: '8',
      game_mode: 'volatility_trade',
      app_version: '0.2.0',
      consent_version: '1',
    });
    expect(res409.success).toBe(false);
    if (!res409.success) {
      expect(res409.error.code).toBe('rules_version_mismatch');
      expect(res409.error.userMessage).toContain('云端规则版本与当前客户端不一致');
    }

    // 4. 500 Server Error
    const client500 = {
      functions: {
        invoke: vi.fn(async () => ({
          data: null,
          error: {
            message: 'internal_error',
            context: new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 }),
          },
        })),
      },
    } as unknown as SupabaseClient;
    const backend500 = new SupabaseAnalyticsBackend(client500);
    const res500 = await backend500.startVerifiedSession('p1', {
      session_id: 's1',
      started_at: '2026-08-10T00:00:00.000Z',
      status: 'started',
      rounds_completed: 0,
      final_score: 0,
      rules_version: '8',
      game_mode: 'volatility_trade',
      app_version: '0.2.0',
      consent_version: '1',
    });
    expect(res500.success).toBe(false);
    if (!res500.success) {
      expect(res500.error.code).toBe('service_unavailable');
      expect(res500.error.userMessage).toContain('云端开局服务暂时不可用');
    }

    // 5. Network Error (TypeError / Failed to fetch)
    const clientNet = {
      functions: {
        invoke: vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      },
    } as unknown as SupabaseClient;
    const backendNet = new SupabaseAnalyticsBackend(clientNet);
    const resNet = await backendNet.startVerifiedSession('p1', {
      session_id: 's1',
      started_at: '2026-08-10T00:00:00.000Z',
      status: 'started',
      rounds_completed: 0,
      final_score: 0,
      rules_version: '8',
      game_mode: 'volatility_trade',
      app_version: '0.2.0',
      consent_version: '1',
    });
    expect(resNet.success).toBe(false);
    if (!resNet.success) {
      expect(resNet.error.code).toBe('network_error');
      expect(resNet.error.userMessage).toContain('网络连接失败');
    }

    // 6. Invalid response structure -> service_contract_error
    const clientInvalid = {
      functions: {
        invoke: vi.fn(async () => ({
          data: { corrupted: true },
          error: null,
        })),
      },
    } as unknown as SupabaseClient;
    const backendInvalid = new SupabaseAnalyticsBackend(clientInvalid);
    const resInvalid = await backendInvalid.startVerifiedSession('p1', {
      session_id: 's1',
      started_at: '2026-08-10T00:00:00.000Z',
      status: 'started',
      rounds_completed: 0,
      final_score: 0,
      rules_version: '8',
      game_mode: 'volatility_trade',
      app_version: '0.2.0',
      consent_version: '1',
    });
    expect(resInvalid.success).toBe(false);
    if (!resInvalid.success) {
      expect(resInvalid.error.code).toBe('service_contract_error');
      expect(resInvalid.error.userMessage).toContain('格式异常');
    }

    // 7. NoopAnalyticsBackend -> cloud_not_configured
    const noopBackend = new NoopAnalyticsBackend();
    expect(noopBackend.isConfigured).toBe(false);
    const resNoop = await noopBackend.startVerifiedSession();
    expect(resNoop.success).toBe(false);
    if (!resNoop.success) {
      expect(resNoop.error.code).toBe('cloud_not_configured');
      expect(resNoop.error.userMessage).toContain('云端服务未配置');
    }
  });

  it('does not mistake a non-idempotent 409 response for a verified score', async () => {
    const invoke = vi.fn(async () => ({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: new Response(JSON.stringify({ error: 'session_not_active' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    }));
    const client = { functions: { invoke } } as unknown as SupabaseClient;
    const backend = new SupabaseAnalyticsBackend(client);

    const result = await backend.submitVerifiedScore('player-1', {
      session_id: 'session-1',
      actions: [],
    });

    expect(result).toEqual({
      verified: false,
      rejected: true,
      score: null,
      leaderboard_submitted: false,
      message: 'session_not_active',
    });
  });

  it('读取云端修行账本时按 owner 过滤并汇总', async () => {
    const rows = [
      {
        player_id: 'player-1',
        local_game_id: 'game-1',
        game_session_id: null,
        rules_version: 7,
        started_at: '2026-08-10T00:00:00.000Z',
        ended_at: '2026-08-10T00:30:00.000Z',
        outcome: 'completed',
        final_score: 120.5,
        record_source: 'local_claim',
        created_at: '2026-08-10T00:30:00.000Z',
        updated_at: '2026-08-10T00:30:00.000Z',
      },
      {
        player_id: 'player-1',
        local_game_id: 'game-2',
        game_session_id: 'session-2',
        rules_version: 6,
        started_at: '2026-08-11T00:00:00.000Z',
        ended_at: '2026-08-11T00:45:00.000Z',
        outcome: 'abandoned',
        final_score: null,
        record_source: 'verified_session',
        created_at: '2026-08-11T00:45:00.000Z',
        updated_at: '2026-08-11T00:45:00.000Z',
      },
    ];
    const order = vi.fn(async () => ({ data: rows, error: null }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const client = { from } as unknown as SupabaseClient;
    const backend = new SupabaseAnalyticsBackend(client);

    const snapshot = await backend.fetchCultivationLedger('player-1');

    expect(from).toHaveBeenCalledWith('cultivation_ledger_entries');
    expect(eq).toHaveBeenCalledWith('player_id', 'player-1');
    expect(snapshot).toEqual({
      records: rows,
      summary: summarizeCultivationLedger([
        {
          rulesVersion: 7,
          outcome: 'completed',
          finalScore: 120.5,
        },
        {
          rulesVersion: 6,
          outcome: 'abandoned',
          finalScore: null,
        },
      ]),
    });
  });

  it('fetchActiveGameSession 正确查询 game_sessions 与 game_events 并还原动作链（区分数据库主键与客户端ID）', async () => {
    const sessionData = {
      id: 'db-uuid-session-123',
      client_session_id: 'client-sess-abc',
      started_at: '2026-08-27T10:00:00.000Z',
      replay_seed: 42,
      rules_snapshot: {
        rulesVersion: 7,
        scoreRules: {},
        volatility: {},
        voidCardCount: 2,
      },
      status: 'started',
      rounds_completed: 3,
      final_score: 50,
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
      {
        event_type: 'action_lock',
        sequence: 3,
        payload: { card_index: 1 },
        occurred_at: '2026-08-27T10:03:00.000Z',
      },
      {
        event_type: 'action_sell',
        sequence: 4,
        payload: { slot_index: 0 },
        occurred_at: '2026-08-27T10:04:00.000Z',
      },
    ];

    const eventsEqMock = vi.fn().mockReturnThis();

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
            eq: eventsEqMock,
            order: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: eventsData, error: null }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const backend = new SupabaseAnalyticsBackend(client);
    const active = await backend.fetchActiveGameSession('player-1');

    expect(active).not.toBeNull();
    expect(active?.session_id).toBe('db-uuid-session-123');
    expect(active?.client_session_id).toBe('client-sess-abc');
    expect(active?.seed).toBe(42);
    expect(active?.rules_snapshot.rulesVersion).toBe(7);
    expect(eventsEqMock).toHaveBeenCalledWith('player_id', 'player-1');
    expect(eventsEqMock).toHaveBeenCalledWith('session_id', 'db-uuid-session-123');
    expect(active?.actions).toEqual([
      { type: 'buy', cardIndex: 0, leverage: false },
      { type: 'wait' },
      { type: 'lock', cardIndex: 1 },
      { type: 'sell', slotIndex: 0 },
    ]);
  });
});

describe('SupabaseAnalyticsBackend.updateDisplayName', () => {
  const PROFILE_ROW = {
    player_id: 'player-1',
    public_player_id: 'public-1',
    public_code: 'PUBLIC001',
    display_name: '测试玩家',
    leaderboard_eligible: true,
  };

  /** 构造支持 update().eq().select().single() 链式调用的 mock client。 */
  function createClientForUpdate(result: { data: unknown; error: unknown }) {
    const single = vi.fn(async () => result);
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const client = { from } as unknown as SupabaseClient;
    return { client, single, select, eq, update };
  }

  it('update 后返回服务端确认的身份（含资格）', async () => {
    const { client, select, eq, update } = createClientForUpdate({ data: PROFILE_ROW, error: null });
    const backend = new SupabaseAnalyticsBackend(client);

    await expect(backend.updateDisplayName('player-1', '测试玩家')).resolves.toEqual(PROFILE_ROW);

    expect(update).toHaveBeenCalledWith({ display_name: '测试玩家' });
    expect(eq).toHaveBeenCalledWith('id', 'player-1');
    expect(select).toHaveBeenCalledWith(
      'player_id:id, public_player_id, public_code, display_name, leaderboard_eligible',
    );
  });

  it('未命中（0 行返回）时失败，不静默成功', async () => {
    const { client } = createClientForUpdate({
      data: null,
      error: {
        message: 'JSON object requested, multiple (or no) rows returned',
        code: 'PGRST116',
        details: 'The result contains 0 rows',
        hint: '',
        code_level: 'PG',
      },
    });
    const backend = new SupabaseAnalyticsBackend(client);

    await expect(backend.updateDisplayName('player-1', '玩家')).rejects.toThrow(
      'multiple (or no) rows returned',
    );
  });

  it('update 报错（RLS/网络/服务端）时失败', async () => {
    const { client } = createClientForUpdate({ data: null, error: { message: 'update forbidden' } });
    const backend = new SupabaseAnalyticsBackend(client);

    await expect(backend.updateDisplayName('player-1', '测试玩家')).rejects.toThrow('update forbidden');
  });

  it('返回异常形状（缺字段）时视为失败', async () => {
    const { client } = createClientForUpdate({ data: { player_id: 'player-1' }, error: null });
    const backend = new SupabaseAnalyticsBackend(client);

    await expect(backend.updateDisplayName('player-1', '测试玩家')).rejects.toThrow(
      'updateDisplayName 未命中档案或返回异常',
    );
  });
});

describe('SupabaseAnalyticsBackend recoverCorruptedSession & activeSession revision', () => {
  it('recoverCorruptedSession 携带 expected_session_revision 调用 Edge Function', async () => {
    const invoke = vi.fn(async () => ({
      data: { success: true, status: 'corrupted_recovery', session_id: 'sess-1' },
      error: null,
    }));
    const client = { functions: { invoke } } as unknown as SupabaseClient;
    const backend = new SupabaseAnalyticsBackend(client);

    const res = await backend.recoverCorruptedSession('sess-1', 42);
    expect(invoke).toHaveBeenCalledWith('recover-corrupted-session', {
      body: { session_id: 'sess-1', expected_session_revision: 42 },
    });
    expect(res).toEqual({ success: true, error: undefined, isConflict: false });
  });

  it('recoverCorruptedSession 遇到 FunctionsHttpError 409 冲突时可靠识别并回传 isConflict: true', async () => {
    const httpError = {
      message: 'Edge Function returned a non-2xx status code',
      context: {
        status: 409,
        json: async () => ({ error: 'conflict', message: 'Concurrent session update detected' }),
      },
    };
    const invoke = vi.fn(async () => ({
      data: null,
      error: httpError,
    }));
    const client = { functions: { invoke } } as unknown as SupabaseClient;
    const backend = new SupabaseAnalyticsBackend(client);

    const res = await backend.recoverCorruptedSession('sess-1', 10);
    expect(res.success).toBe(false);
    expect(res.isConflict).toBe(true);
    expect(res.error).toBe('conflict');
  });

  it('fetchActiveGameSession 正确提取 session_revision 与事件列表', async () => {
    const events = [
      { event_type: 'session_start', sequence: 0, payload: {}, occurred_at: '2026-08-10T00:00:00.000Z' },
      { event_type: 'action_buy', sequence: 1, payload: { card_index: 0, use_leverage: false }, occurred_at: '2026-08-10T00:00:01.000Z' },
      { event_type: 'round_settled', sequence: 2, payload: {}, occurred_at: '2026-08-10T00:00:02.000Z' },
      { event_type: 'action_wait', sequence: 5, payload: {}, occurred_at: '2026-08-10T00:00:03.000Z' },
      { event_type: 'round_settled', sequence: 6, payload: {}, occurred_at: '2026-08-10T00:00:04.000Z' },
    ];
    const eventsOrder2 = vi.fn(async () => ({ data: events, error: null }));
    const eventsOrder1 = vi.fn(() => ({ order: eventsOrder2 }));
    const eventsEq2 = vi.fn(() => ({ order: eventsOrder1 }));
    const eventsEq1 = vi.fn(() => ({ eq: eventsEq2 }));
    const eventsSelect = vi.fn(() => ({ eq: eventsEq1 }));

    const sessionRow = {
      id: 'sess-1',
      started_at: '2026-08-10T00:00:00.000Z',
      replay_seed: 123,
      rules_snapshot: { rulesVersion: 8, volatility: true },
      rounds_completed: 2,
      final_score: 50,
      session_revision: 5,
    };
    const sessionLimit = vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: sessionRow, error: null })) }));
    const sessionOrder = vi.fn(() => ({ limit: sessionLimit }));
    const sessionIn = vi.fn(() => ({ order: sessionOrder }));
    const sessionEq = vi.fn(() => ({ in: sessionIn }));
    const sessionSelect = vi.fn(() => ({ eq: sessionEq }));

    const from = vi.fn((table: string) => {
      if (table === 'game_sessions') return { select: sessionSelect };
      if (table === 'game_events') return { select: eventsSelect };
      return {} as any;
    });
    const client = { from } as unknown as SupabaseClient;
    const backend = new SupabaseAnalyticsBackend(client);

    const active = await backend.fetchActiveGameSession('player-1');
    expect(active).not.toBeNull();
    expect(active?.session_revision).toBe(5);
    expect(active?.last_event_sequence).toBe(6);
    expect(active?.actions).toHaveLength(2); // action_buy, action_wait
  });

  it('uploadEvents 通过 append_game_events RPC 进行受控追加写并返回 revision', async () => {
    const rpc = vi.fn(async (_name: string, _args: any) => ({
      data: [{ session_id: 'sess-1', session_revision: 3, inserted_count: 2 }],
      error: null,
    }));
    const client = { rpc } as unknown as SupabaseClient;
    const backend = new SupabaseAnalyticsBackend(client);

    const result = await backend.uploadEvents('player-1', [
      { id: 'ev-1', type: 'action_buy', payload: { session_id: 'sess-1', round: 1 }, sequence: 1, ts: '2026-08-10T00:00:00.000Z' },
      { id: 'ev-2', type: 'round_settled', payload: { session_id: 'sess-1', round: 1 }, sequence: 2, ts: '2026-08-10T00:00:01.000Z' },
    ]);

    expect(rpc).toHaveBeenCalledWith('append_game_events', {
      p_player_id: 'player-1',
      p_events: [
        {
          session_id: 'sess-1',
          client_event_id: 'ev-1',
          sequence: 1,
          event_type: 'action_buy',
          round: 1,
          season: null,
          action: 'buy',
          payload: { session_id: 'sess-1', round: 1 },
          occurred_at: '2026-08-10T00:00:00.000Z',
        },
        {
          session_id: 'sess-1',
          client_event_id: 'ev-2',
          sequence: 2,
          event_type: 'round_settled',
          round: 1,
          season: null,
          action: null,
          payload: { session_id: 'sess-1', round: 1 },
          occurred_at: '2026-08-10T00:00:01.000Z',
        },
      ],
    });
    expect(result).toEqual([{ session_id: 'sess-1', session_revision: 3, inserted_count: 2 }]);
  });

  it('rejects verified sessions with drifted V8 rules snapshots and returns service_contract_error', async () => {
    const driftedSnapshot = {
      ...cloneReplayRulesSnapshot(),
      scoreRules: { holdBonus: 1.2, sellMultiplier: 999 }, // 发生参数漂移
    };

    const invoke = vi.fn(async () => ({
      data: {
        session_id: 'drifted-session',
        started_at: '2026-08-10T00:00:00.000Z',
        seed: 42,
        rules_snapshot: driftedSnapshot,
      },
      error: null,
    }));
    const client = { functions: { invoke } } as unknown as SupabaseClient;
    const backend = new SupabaseAnalyticsBackend(client);

    const result = await backend.startVerifiedSession('player-1', {
      session_id: 'client-session',
      started_at: '2026-08-10T00:00:00.000Z',
      status: 'started',
      rounds_completed: 0,
      final_score: 0,
      rules_version: '8',
      game_mode: 'volatility_trade',
      app_version: '0.2.0',
      consent_version: '1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('service_contract_error');
      expect(result.error.message).toContain('Rules snapshot contract violation');
      expect(result.error.userMessage).toContain('异常');
    }
  });
});
