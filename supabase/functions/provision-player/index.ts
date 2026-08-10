import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_DISPLAY_NAME = '玩家';
const RECOVERY_BYTES = 24;

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

  const { data, error: userError } = await supabase.auth.getUser(token);
  if (userError || !data.user) return json({ error: 'unauthorized' }, 401);
  if (!data.user.is_anonymous) return json({ error: 'forbidden' }, 403);
  const authUserId = data.user.id;

  const { data: existing, error: existingError } = await supabase
    .from('player_identity_links')
    .select('auth_user_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (existingError) {
    console.error('provision-player existing identity lookup failed', existingError);
    return json({ error: 'internal_error' }, 500);
  }
  if (existing) return json({ error: 'already_linked' }, 409);

  const playerId = crypto.randomUUID();
  const publicPlayerId = crypto.randomUUID();
  const displayName = sanitizeDisplayName(DEFAULT_DISPLAY_NAME);
  const recoveryCode = generateRecoveryCode();
  const secretHash = await sha256Hex(recoveryCode);

  const { error: profileError } = await supabase
    .from('player_profiles')
    .insert({ id: playerId, public_player_id: publicPlayerId, display_name: displayName });
  if (profileError) {
    console.error('provision-player profile insert failed', profileError);
    return isUniqueViolation(profileError)
      ? json({ error: 'already_linked' }, 409)
      : json({ error: 'internal_error' }, 500);
  }

  const { error: secretError } = await supabase
    .schema('private')
    .from('recovery_secrets')
    .insert({ player_id: playerId, secret_hash: secretHash });
  if (secretError) {
    console.error('provision-player recovery secret insert failed', secretError);
    await supabase.from('player_profiles').delete().eq('id', playerId);
    return json({ error: 'internal_error' }, 500);
  }

  const { error: linkError } = await supabase
    .from('player_identity_links')
    .insert({ player_id: playerId, auth_user_id: authUserId });
  if (linkError) {
    console.error('provision-player identity link insert failed', linkError);
    await supabase.schema('private').from('recovery_secrets').delete().eq('player_id', playerId);
    await supabase.from('player_profiles').delete().eq('id', playerId);
    return isUniqueViolation(linkError)
      ? json({ error: 'already_linked' }, 409)
      : json({ error: 'internal_error' }, 500);
  }

  return json(
    {
      player_id: playerId,
      public_player_id: publicPlayerId,
      display_name: displayName,
      recovery_code: recoveryCode,
    },
    201,
  );
});

function extractBearerToken(req: Request): string | null {
  const authorization = req.headers.get('authorization') ?? '';
  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function generateRecoveryCode(): string {
  const bytes = new Uint8Array(RECOVERY_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function sanitizeDisplayName(name: string): string {
  const trimmed = name.trim().slice(0, 12);
  return trimmed.length > 0 ? trimmed : DEFAULT_DISPLAY_NAME;
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
