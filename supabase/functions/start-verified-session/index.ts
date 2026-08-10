import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { cloneReplayRulesSnapshot } from '../../../src/core/ReplayRules.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CLIENT_SESSION_ID_MAX = 128;

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
  const clientSessionId = typeof body?.client_session_id === 'string'
    ? body.client_session_id.trim()
    : '';
  if (!clientSessionId || clientSessionId.length > CLIENT_SESSION_ID_MAX) {
    return json({ error: 'invalid_client_session_id' }, 400);
  }

  const { data: link, error: linkError } = await supabase
    .from('player_identity_links')
    .select('player_id')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  if (linkError) return json({ error: 'internal_error' }, 500);
  if (!link) return json({ error: 'identity_not_ready' }, 403);

  const { data: existing, error: existingError } = await supabase
    .from('game_sessions')
    .select('id, started_at, replay_seed, rules_snapshot, status, verified_at')
    .eq('player_id', link.player_id)
    .eq('client_session_id', clientSessionId)
    .maybeSingle();
  if (existingError) return json({ error: 'internal_error' }, 500);
  if (existing) {
    if (existing.status === 'completed' || existing.verified_at) {
      return json({ error: 'session_already_completed' }, 409);
    }
    if (isValidStoredSession(existing)) return json(toResponse(existing), 200);
  }

  const rules = cloneReplayRulesSnapshot();
  const seed = generateSeed();
  const sessionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from('game_sessions')
    .insert({
      id: sessionId,
      player_id: link.player_id,
      client_session_id: clientSessionId,
      rules_version: String(rules.rulesVersion),
      game_mode: rules.gameMode,
      app_version: stringField(body?.app_version, 32) ?? 'unknown',
      consent_version: stringField(body?.consent_version, 32) ?? '0',
      status: 'started',
      started_at: startedAt,
      rounds_completed: 0,
      final_score: 0,
      replay_seed: seed,
      rules_snapshot: rules,
    })
    .select('id, started_at, replay_seed, rules_snapshot, status, verified_at')
    .single();

  if (insertError) {
    // A concurrent retry may have won the unique (player_id, client_session_id)
    // race; return that server-owned session instead of creating a second seed.
    if (insertError.code === '23505') {
      const { data: raced } = await supabase
        .from('game_sessions')
        .select('id, started_at, replay_seed, rules_snapshot, status, verified_at')
        .eq('player_id', link.player_id)
        .eq('client_session_id', clientSessionId)
        .maybeSingle();
      if (raced && isValidStoredSession(raced)) return json(toResponse(raced), 200);
    }
    console.error('start-verified-session insert failed', insertError);
    return json({ error: 'internal_error' }, 500);
  }

  return json(toResponse(inserted), 201);
});

function isValidStoredSession(value: Record<string, unknown>): boolean {
  return typeof value.id === 'string' &&
    typeof value.started_at === 'string' &&
    typeof value.replay_seed === 'number' &&
    Number.isSafeInteger(value.replay_seed) &&
    value.rules_snapshot !== null &&
    typeof value.rules_snapshot === 'object';
}

function toResponse(value: Record<string, unknown>) {
  return {
    session_id: value.id,
    started_at: value.started_at,
    seed: value.replay_seed,
    rules_snapshot: value.rules_snapshot,
  };
}

function generateSeed(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] & 0x7fffffff;
}

function extractBearerToken(req: Request): string | null {
  const authorization = req.headers.get('authorization') ?? '';
  const [scheme, token, ...rest] = authorization.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token && rest.length === 0 ? token : null;
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function stringField(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim().length <= maxLength ? value.trim() : null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
