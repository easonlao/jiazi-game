import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAnalyticsBackend } from '../../app/src/lib/analyticsBackend';
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
    });
  });

  it('requests the exact rules version when creating a verified session', async () => {
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

    await backend.startVerifiedSession('player-1', {
      session_id: 'client-session',
      started_at: '2026-08-10T00:00:00.000Z',
      status: 'started',
      rounds_completed: 0,
      final_score: 0,
      rules_version: '4',
      game_mode: 'volatility_trade',
      app_version: '0.2.0',
      consent_version: '1',
    });

    expect(invoke).toHaveBeenCalledWith('start-verified-session', {
      body: expect.objectContaining({ requested_rules_version: '4' }),
    });
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

  it('认领本机修行账本时只上传终态记录并走专用 Edge Function', async () => {
    const invoke = vi.fn(async () => ({
      data: {
        records: [
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
        ],
      },
      error: null,
    }));
    const client = { functions: { invoke } } as unknown as SupabaseClient;
    const backend = new SupabaseAnalyticsBackend(client);

    const snapshot = await backend.claimCultivationLedger('player-1', [
      {
        id: 'game-0',
        rulesVersion: 7,
        startedAt: '2026-08-09T00:00:00.000Z',
        endedAt: null,
        outcome: 'active',
        finalScore: null,
      },
      {
        id: 'game-1',
        rulesVersion: 7,
        startedAt: '2026-08-10T00:00:00.000Z',
        endedAt: '2026-08-10T00:30:00.000Z',
        outcome: 'completed',
        finalScore: 120.5,
      },
      {
        id: 'game-2',
        rulesVersion: 6,
        startedAt: '2026-08-11T00:00:00.000Z',
        endedAt: '2026-08-11T00:45:00.000Z',
        outcome: 'abandoned',
        finalScore: null,
      },
    ]);

    expect(invoke).toHaveBeenCalledWith('claim-cultivation-ledger', {
      body: {
        player_id: 'player-1',
        records: [
          {
            local_game_id: 'game-1',
            rules_version: 7,
            started_at: '2026-08-10T00:00:00.000Z',
            ended_at: '2026-08-10T00:30:00.000Z',
            outcome: 'completed',
            final_score: 120.5,
          },
          {
            local_game_id: 'game-2',
            rules_version: 6,
            started_at: '2026-08-11T00:00:00.000Z',
            ended_at: '2026-08-11T00:45:00.000Z',
            outcome: 'abandoned',
            final_score: null,
          },
        ],
      },
    });
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.summary).toEqual(
      summarizeCultivationLedger([
        {
          rulesVersion: 7,
          outcome: 'completed',
          finalScore: 120.5,
        },
      ]),
    );
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
