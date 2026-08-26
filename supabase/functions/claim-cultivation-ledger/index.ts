import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: CORS_HEADERS });
  }
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
  if (!body) return json({ error: 'invalid_body' }, 400);

  const requestedPlayerId = typeof body.player_id === 'string' ? body.player_id.trim() : '';
  const records = parseRecords(body.records);
  if (records === null) return json({ error: 'invalid_body' }, 400);

  const { data: link, error: linkError } = await supabase
    .from('player_identity_links')
    .select('player_id')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  if (linkError) return json({ error: 'internal_error' }, 500);
  if (!link) return json({ error: 'identity_not_ready' }, 403);
  if (requestedPlayerId && requestedPlayerId !== link.player_id) {
    return json({ error: 'identity_mismatch' }, 403);
  }

  if (records.length > 0) {
    const now = new Date().toISOString();
    const rows = records.map((record) => ({
      player_id: link.player_id,
      local_game_id: record.local_game_id,
      game_session_id: null,
      rules_version: record.rules_version,
      started_at: record.started_at,
      ended_at: record.ended_at,
      outcome: record.outcome,
      final_score: record.final_score,
      record_source: 'local_claim',
      created_at: now,
      updated_at: now,
    }));
    const { error: upsertError } = await supabase
      .from('cultivation_ledger_entries')
      .upsert(rows, { onConflict: 'player_id,local_game_id', ignoreDuplicates: true });
    if (upsertError) {
      console.error('claim-cultivation-ledger upsert failed', upsertError);
      return json({ error: 'internal_error' }, 500);
    }
  }

  const { data: entries, error: readError } = await supabase
    .from('cultivation_ledger_entries')
    .select('player_id, local_game_id, game_session_id, rules_version, started_at, ended_at, outcome, final_score, record_source, created_at, updated_at')
    .eq('player_id', link.player_id)
    .order('started_at', { ascending: false });
  if (readError) {
    console.error('claim-cultivation-ledger read failed', readError);
    return json({ error: 'internal_error' }, 500);
  }

  return json({ records: entries ?? [] }, 200);
});

function parseRecords(value: unknown): Array<{
  local_game_id: string;
  rules_version: number;
  started_at: string;
  ended_at: string;
  outcome: 'completed' | 'abandoned';
  final_score: number | null;
}> | null {
  if (!Array.isArray(value)) return null;
  const records: Array<{
    local_game_id: string;
    rules_version: number;
    started_at: string;
    ended_at: string;
    outcome: 'completed' | 'abandoned';
    final_score: number | null;
  }> = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const local_game_id = typeof item.local_game_id === 'string' ? item.local_game_id.trim() : '';
    const rules_version = item.rules_version;
    const started_at = typeof item.started_at === 'string' ? item.started_at : '';
    const ended_at = typeof item.ended_at === 'string' ? item.ended_at : '';
    const outcome = item.outcome;
    const final_score = item.final_score;
    if (!local_game_id || !Number.isInteger(rules_version) || !started_at || !ended_at) return null;
    if (outcome !== 'completed' && outcome !== 'abandoned') return null;
    if (outcome === 'completed' && !(typeof final_score === 'number' && final_score >= 0)) return null;
    if (outcome === 'abandoned' && final_score !== null) return null;
    const startedAtMs = Date.parse(started_at);
    const endedAtMs = Date.parse(ended_at);
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs) || endedAtMs < startedAtMs) {
      return null;
    }
    records.push({
      local_game_id,
      rules_version,
      started_at,
      ended_at,
      outcome,
      final_score,
    });
  }
  return records;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
