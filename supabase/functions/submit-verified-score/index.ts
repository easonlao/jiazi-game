import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  MAX_REPLAY_ACTIONS,
  replayGame,
  ReplayValidationError,
  type ReplayAction,
} from '../../../src/core/ReplayRunner.ts';
import type { ReplayRulesSnapshot } from '../../../src/core/ReplayRules.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'server_misconfigured' }, 500);

  const token = extractBearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return json({ error: 'unauthorized' }, 401);
  const body = await parseJsonBody(req);
  const sessionId = typeof body?.session_id === 'string' ? body.session_id.trim() : '';
  const actions = parseActions(body?.actions);
  if (!sessionId || !actions) return json({ error: 'invalid_body' }, 400);

  const { data: link, error: linkError } = await supabase
    .from('player_identity_links')
    .select('player_id')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  if (linkError) return json({ error: 'internal_error' }, 500);
  if (!link) return json({ error: 'identity_not_ready' }, 403);

  const { data: session, error: sessionError } = await supabase
    .from('game_sessions')
    .select('id, player_id, status, rules_version, replay_seed, rules_snapshot, verified_at')
    .eq('id', sessionId)
    .eq('player_id', link.player_id)
    .maybeSingle();
  if (sessionError) return json({ error: 'internal_error' }, 500);
  if (!session) return json({ error: 'session_not_found' }, 404);
  if (session.verified_at || session.status === 'completed') {
    return json({ error: 'session_already_submitted' }, 409);
  }
  if (!Number.isSafeInteger(session.replay_seed) || !isReplayRulesSnapshot(session.rules_snapshot)) {
    return json({ error: 'session_not_verifiable' }, 409);
  }

  let replay;
  try {
    replay = await replayGame({
      seed: session.replay_seed,
      actions,
      rulesVersion: session.rules_snapshot.rulesVersion,
      volatility: session.rules_snapshot.volatility,
      scoreRules: session.rules_snapshot.scoreRules,
    });
  } catch (error) {
    if (error instanceof ReplayValidationError) {
      return json({ error: 'replay_rejected', action_index: error.actionIndex }, 422);
    }
    console.error('submit-verified-score replay failed', error);
    return json({ error: 'internal_error' }, 500);
  }

  const verifiedAt = new Date().toISOString();
  const finalScore = Math.round(replay.score * 10) / 10;
  const { error: updateError } = await supabase
    .from('game_sessions')
    .update({
      status: 'completed',
      rounds_completed: replay.rounds,
      final_score: Math.max(0, finalScore),
      ended_at: verifiedAt,
      verified_at: verifiedAt,
    })
    .eq('id', session.id)
    .eq('player_id', link.player_id)
    .is('verified_at', null);
  if (updateError) return json({ error: 'internal_error' }, 500);

  const { data: profile, error: profileError } = await supabase
    .from('player_profiles')
    .select('public_player_id, leaderboard_eligible, display_name')
    .eq('id', link.player_id)
    .single();
  if (profileError || !profile) return json({ error: 'internal_error' }, 500);

  const eligible = profile.leaderboard_eligible === true &&
    typeof profile.display_name === 'string' && profile.display_name.trim().length > 0;
  if (eligible && finalScore >= 0) {
    const { error: leaderboardError } = await supabase
      .from('leaderboard_entries')
      .insert({
        public_player_id: profile.public_player_id,
        score: finalScore,
        rules_version: String(replay.rulesVersion),
        session_id: session.id,
      });
    if (leaderboardError && leaderboardError.code !== '23505') {
      console.error('submit-verified-score leaderboard insert failed', leaderboardError);
      return json({ error: 'internal_error' }, 500);
    }
  }

  return json({
    verified: true,
    score: finalScore,
    leaderboard_submitted: eligible && finalScore >= 0,
    rules_version: String(replay.rulesVersion),
    rounds: replay.rounds,
  }, 200);
});

function parseActions(value: unknown): ReplayAction[] | null {
  if (!Array.isArray(value) || value.length > MAX_REPLAY_ACTIONS) return null;
  const actions: ReplayAction[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.type !== 'string') return null;
    switch (item.type) {
      case 'buy':
        if (!isIndex(item.cardIndex) || typeof item.leverage !== 'boolean') return null;
        actions.push({ type: 'buy', cardIndex: item.cardIndex, leverage: item.leverage });
        break;
      case 'sell':
        if (!isIndex(item.slotIndex)) return null;
        actions.push({ type: 'sell', slotIndex: item.slotIndex });
        break;
      case 'wait':
        actions.push({ type: 'wait' });
        break;
      case 'lock':
      case 'unlock':
        if (!isIndex(item.cardIndex)) return null;
        actions.push({ type: item.type, cardIndex: item.cardIndex });
        break;
      default:
        return null;
    }
  }
  return actions;
}

function isReplayRulesSnapshot(value: unknown): value is ReplayRulesSnapshot {
  if (!isRecord(value) || !Number.isInteger(value.rulesVersion)) return false;
  const volatility = value.volatility;
  const scoreRules = value.scoreRules;
  return isRecord(volatility) && isRecord(scoreRules) &&
    typeof volatility.enabled === 'boolean' &&
    typeof scoreRules.holdBonus === 'number' &&
    typeof scoreRules.sellMultiplier === 'number';
}

function isIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractBearerToken(req: Request): string | null {
  const authorization = req.headers.get('authorization') ?? '';
  const [scheme, token, ...rest] = authorization.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token && rest.length === 0 ? token : null;
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
