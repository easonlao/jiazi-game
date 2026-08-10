import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const RECOVERY_CODE_MIN_LENGTH = 8;
const RECOVERY_CODE_MAX_LENGTH = 128;

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

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json({ error: 'unauthorized' }, 401);

  if (!isAnonymousUser(user)) return json({ error: 'not_anonymous' }, 403);

  const authUserId = user.id;

  const { data: existingLink, error: linkCheckError } = await supabase
    .from('player_identity_links')
    .select('auth_user_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (linkCheckError) return json({ error: 'internal_error' }, 500);
  if (existingLink) return json({ error: 'already_linked' }, 409);

  const body = await parseJsonBody(req);
  if (!body) return json({ error: 'invalid_body' }, 400);

  const recoveryCode = typeof body.recovery_code === 'string' ? body.recovery_code.trim() : '';
  if (
    recoveryCode.length < RECOVERY_CODE_MIN_LENGTH ||
    recoveryCode.length > RECOVERY_CODE_MAX_LENGTH
  ) {
    return json({ error: 'invalid_recovery_code' }, 400);
  }

  const attempt = await registerAttempt(supabase, authUserId);
  if (attempt.error) return json({ error: 'internal_error' }, 500);
  if (attempt.locked) return json({ error: 'too_many_attempts' }, 429);

  const secretHash = await sha256Hex(recoveryCode);

  const { data: secret, error: secretError } = await supabase
    .schema('private')
    .from('recovery_secrets')
    .select('player_id')
    .eq('secret_hash', secretHash)
    .limit(1)
    .maybeSingle();
  if (secretError) return json({ error: 'internal_error' }, 500);
  if (!secret) return json({ error: 'invalid_recovery_code' }, 400);

  const { error: insertError } = await supabase
    .from('player_identity_links')
    .insert({ player_id: secret.player_id, auth_user_id: authUserId });
  if (insertError) {
    return isUniqueViolation(insertError)
      ? json({ error: 'already_linked' }, 409)
      : json({ error: 'internal_error' }, 500);
  }

  const { error: resetError } = await supabase
    .schema('private')
    .from('recovery_attempts')
    .update({ window_started_at: new Date().toISOString(), attempt_count: 0 })
    .eq('auth_user_id', authUserId);
  if (resetError) return json({ error: 'internal_error' }, 500);

  const { data: profile, error: profileError } = await supabase
    .from('player_profiles')
    .select('id, public_player_id, public_code, display_name, leaderboard_eligible')
    .eq('id', secret.player_id)
    .single();
  if (profileError || !profile) return json({ error: 'internal_error' }, 500);

  return json(
    {
      player_id: profile.id,
      public_player_id: profile.public_player_id,
      public_code: profile.public_code,
      display_name: profile.display_name,
      leaderboard_eligible: profile.leaderboard_eligible === true,
    },
    200,
  );
});

async function registerAttempt(
  supabase: ReturnType<typeof createClient>,
  authUserId: string,
): Promise<{ error: boolean; locked?: boolean }> {
  const now = new Date();

  const { data: row, error: selectError } = await supabase
    .schema('private')
    .from('recovery_attempts')
    .select('auth_user_id, window_started_at, attempt_count')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (selectError) return { error: true };

  if (!row) {
    const { error: insertError } = await supabase
      .schema('private')
      .from('recovery_attempts')
      .insert({
        auth_user_id: authUserId,
        window_started_at: now.toISOString(),
        attempt_count: 1,
        updated_at: now.toISOString(),
      });
    return { error: !!insertError };
  }

  const windowExpired =
    now.getTime() - new Date(row.window_started_at).getTime() >= ATTEMPT_WINDOW_MS;

  if (windowExpired) {
    const { error: resetError } = await supabase
      .schema('private')
      .from('recovery_attempts')
      .update({
        window_started_at: now.toISOString(),
        attempt_count: 1,
        updated_at: now.toISOString(),
      })
      .eq('auth_user_id', authUserId);
    return { error: !!resetError };
  }

  if (row.attempt_count >= MAX_ATTEMPTS) {
    return { error: false, locked: true };
  }

  const { error: updateError } = await supabase
    .schema('private')
    .from('recovery_attempts')
    .update({
      attempt_count: row.attempt_count + 1,
      updated_at: now.toISOString(),
    })
    .eq('auth_user_id', authUserId);
  return { error: !!updateError };
}

function isAnonymousUser(user: {
  app_metadata?: Record<string, unknown>;
  is_anonymous?: boolean;
}): boolean {
  const appMetadata = user.app_metadata ?? {};
  return (
    appMetadata.provider === 'anonymous' ||
    appMetadata.is_anonymous === true ||
    user.is_anonymous === true
  );
}

function extractBearerToken(req: Request): string | null {
  const authorization = req.headers.get('authorization') ?? '';
  const [scheme, token, ...rest] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) return null;
  return token;
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
