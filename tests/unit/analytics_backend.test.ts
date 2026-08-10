import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAnalyticsBackend } from '../../app/src/lib/analyticsBackend';
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
});
