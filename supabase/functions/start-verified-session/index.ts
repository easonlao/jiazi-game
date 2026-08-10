import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  cloneReplayRulesSnapshot,
  TRADE_REPLAY_RULES,
  BALANCED_TRADE_REPLAY_RULES,
} from '../../../src/core/ReplayRules.ts';

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
  // 旧客户端未发送版本时继续使用 V3，保证服务端可先于前端安全部署。
  const requestedRulesVersion = body?.requested_rules_version === undefined
    ? TRADE_REPLAY_RULES.rulesVersion
    : Number(body.requested_rules_version);
  const rulesSource = requestedRulesVersion === TRADE_REPLAY_RULES.rulesVersion
    ? TRADE_REPLAY_RULES
    : requestedRulesVersion === BALANCED_TRADE_REPLAY_RULES.rulesVersion
      ? BALANCED_TRADE_REPLAY_RULES
      : null;
  if (!rulesSource || !isVerifiedRulesVersionEnabled(String(requestedRulesVersion))) {
    return json({ error: 'rules_version_not_supported' }, 409);
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
    if (existing.status === 'abandoned' || existing.status === 'failed') {
      return json({ error: 'session_not_reusable' }, 409);
    }
    if (isValidStoredSession(existing)) {
      const storedRules = existing.rules_snapshot as Record<string, unknown>;
      if (storedRules.rulesVersion !== rulesSource.rulesVersion) {
        return json({ error: 'session_rules_mismatch' }, 409);
      }
      return json(toResponse(existing), 200);
    }
  }

  const rules = cloneReplayRulesSnapshot(rulesSource);
  const seed = generateSeed();
  const sessionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .schema('private')
    .rpc('start_verified_game_session', {
      p_player_id: link.player_id,
      p_session_id: sessionId,
      p_client_session_id: clientSessionId,
      p_started_at: startedAt,
      p_rules_version: String(rules.rulesVersion),
      p_game_mode: rules.gameMode,
      p_app_version: stringField(body?.app_version, 32) ?? 'unknown',
      p_consent_version: stringField(body?.consent_version, 32) ?? '0',
      p_replay_seed: seed,
      p_rules_snapshot: rules,
    })
    .maybeSingle();

  if (insertError) {
    console.error('start-verified-session insert failed', insertError);
    return json({ error: 'internal_error' }, 500);
  }

  if (!inserted || !isValidStoredSession(inserted)) {
    console.error('start-verified-session returned an invalid session row');
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

/** 默认只开放生产 V3；开发后端需显式设置 VERIFIED_RULES_VERSIONS=3,4。 */
function isVerifiedRulesVersionEnabled(rulesVersion: string): boolean {
  const configured = Deno.env.get('VERIFIED_RULES_VERSIONS')?.trim() || '3';
  return configured.split(',').map((value) => value.trim()).includes(rulesVersion);
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
