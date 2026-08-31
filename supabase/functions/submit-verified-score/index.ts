import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  MAX_REPLAY_ACTIONS,
  replayGame,
  ReplayValidationError,
  type ReplayAction,
} from '../../../src/core/ReplayRunner.ts';
import {
  CURRENT_REPLAY_RULES,
  getReplayRulesByVersion,
  validateRulesSnapshotContract,
  type ReplayRulesSnapshot,
} from '../../../src/core/ReplayRules.ts';
import { normalizeVerifiedScore } from '../../../src/core/VerifiedScore.ts';

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
    .select('id, player_id, status, rules_version, replay_seed, rules_snapshot, started_at, verified_at, final_score, rounds_completed')
    .eq('id', sessionId)
    .eq('player_id', link.player_id)
    .maybeSingle();
  if (sessionError) return json({ error: 'internal_error' }, 500);
  if (!session) return json({ error: 'session_not_found' }, 404);
  const sessionProfileId = (session.rules_snapshot as { balanceProfileId?: string })?.balanceProfileId ?? null;
  const sessionRulesVersionRaw = session.rules_version;

  if (session.verified_at) {
    const { data: leaderboardEntry, error: leaderboardError } = await supabase
      .from('leaderboard_entries')
      .select('session_id')
      .eq('session_id', session.id)
      .maybeSingle();
    if (leaderboardError) return json({ error: 'internal_error' }, 500);
    let leaderboardSubmitted = Boolean(leaderboardEntry);
    const verifiedScore = typeof session.final_score === 'number' ? session.final_score : null;

    // 会话校验成功后若榜单插入曾瞬时失败，重试必须补插（基于会话自身规则版本与平衡档案）；旧版本只读历史记录，不新增榜单。
    if (!leaderboardSubmitted && verifiedScore !== null && verifiedScore >= 0) {
      const { data: profile, error: profileError } = await supabase
        .from('player_profiles')
        .select('public_player_id, leaderboard_eligible, display_name')
        .eq('id', link.player_id)
        .single();
      if (profileError || !profile) return json({ error: 'internal_error' }, 500);
      const eligible = profile.leaderboard_eligible === true &&
        typeof profile.display_name === 'string' && profile.display_name.trim().length > 0;
      if (eligible) {
        const { error: repairError } = await supabase
          .from('leaderboard_entries')
          .insert({
            public_player_id: profile.public_player_id,
            score: verifiedScore,
            rules_version: String(sessionRulesVersionRaw),
            balance_profile_id: sessionProfileId,
            session_id: session.id,
          });
        if (repairError && repairError.code !== '23505') {
          console.error('submit-verified-score leaderboard repair failed', repairError);
          return json({ error: 'internal_error' }, 500);
        }
        leaderboardSubmitted = true;
      }
    }
    const ledgerUpdated = await upsertCultivationLedgerEntry(supabase, {
      player_id: link.player_id,
      local_game_id: session.id,
      game_session_id: session.id,
      rules_version: Number(sessionRulesVersionRaw),
      balance_profile_id: sessionProfileId,
      started_at: session.started_at,
      ended_at: session.verified_at,
      outcome: 'completed',
      final_score: verifiedScore,
      record_source: 'verified_session',
      updated_at: session.verified_at ?? new Date().toISOString(),
    });
    if (!ledgerUpdated) return json({ error: 'internal_error' }, 500);
    return json({
      verified: true,
      score: verifiedScore,
      leaderboard_submitted: leaderboardSubmitted,
      rules_version: String(sessionRulesVersion),
      balance_profile_id: sessionProfileId,
      rounds: typeof session.rounds_completed === 'number' ? session.rounds_completed : 60,
    }, 200);
  }
  if (session.status === 'completed') {
    return json({ error: 'session_not_active' }, 409);
  }
  if (session.status !== 'started' && session.status !== 'running') {
    return json({ error: 'session_not_active' }, 409);
  }
  if (!Number.isSafeInteger(session.replay_seed) || !isReplayRulesSnapshot(session.rules_snapshot)) {
    return json({ error: 'session_not_verifiable' }, 409);
  }
  // 规则版本门控：只接受注册表内可校验的版本（当前新局为 V10，旧局按各自冻结快照解释）。
  // 会话 rules_version 与规则快照的 rulesVersion 必须同时落在注册表且互相一致；
  // V1-V3 历史对局只读，不重放、不上新榜；新局版本必须与快照契约一致。
  const sessionRulesVersion = Number(session.rules_version);
  const sessionRules = getReplayRulesByVersion(sessionRulesVersion);
  if (
    !sessionRules ||
    session.rules_snapshot.rulesVersion !== sessionRules.rulesVersion ||
    !validateRulesSnapshotContract(session.rules_snapshot, sessionRulesVersion).valid
  ) {
    return json({ error: 'rules_version_not_supported' }, 422);
  }

  const rulesSnapshot = session.rules_snapshot as ReplayRulesSnapshot;
  let replay;
  try {
    replay = await replayGame({
      seed: session.replay_seed,
      actions,
      rulesVersion: rulesSnapshot.rulesVersion,
      volatility: rulesSnapshot.volatility,
      scoreRules: rulesSnapshot.scoreRules,
      voidCardCount: (rulesSnapshot as { voidCardCount?: number }).voidCardCount !== undefined
        ? (rulesSnapshot as { voidCardCount?: number }).voidCardCount
        : (rulesSnapshot.rulesVersion >= 5 ? 3 : 0),
      voidKMin: (rulesSnapshot as { voidKMin?: number }).voidKMin,
      voidKMax: (rulesSnapshot as { voidKMax?: number }).voidKMax,
      balanceProfileId: rulesSnapshot.balanceProfileId,
      balanceProfileVersion: rulesSnapshot.balanceProfileVersion,
      balanceConfig: rulesSnapshot.balanceConfig,
    });
  } catch (error) {
    if (error instanceof ReplayValidationError) {
      return json({ error: 'replay_rejected', action_index: error.actionIndex }, 422);
    }
    console.error('submit-verified-score replay failed', error);
    return json({ error: 'internal_error' }, 500);
  }

  const verifiedAt = new Date().toISOString();
  // 会话、排行榜与返回响应共用同一规范化口径：先按 0.1 舍入，负分归零。
  const finalScore = normalizeVerifiedScore(replay.score);
  const { data: updatedSession, error: updateError } = await supabase
    .from('game_sessions')
    .update({
      status: 'completed',
      rounds_completed: replay.rounds,
      final_score: finalScore,
      ended_at: verifiedAt,
      verified_at: verifiedAt,
    })
    .eq('id', session.id)
    .eq('player_id', link.player_id)
    .in('status', ['started', 'running'])
    .is('verified_at', null)
    .select('id')
    .maybeSingle();
  if (updateError) return json({ error: 'internal_error' }, 500);
  if (!updatedSession) return json({ error: 'session_not_active' }, 409);

  const { data: profile, error: profileError } = await supabase
    .from('player_profiles')
    .select('public_player_id, leaderboard_eligible, display_name')
    .eq('id', link.player_id)
    .single();
  if (profileError || !profile) return json({ error: 'internal_error' }, 500);

  const eligible = profile.leaderboard_eligible === true &&
    typeof profile.display_name === 'string' && profile.display_name.trim().length > 0;
  if (eligible) {
    const { error: leaderboardError } = await supabase
      .from('leaderboard_entries')
      .insert({
        public_player_id: profile.public_player_id,
        score: finalScore,
        // 榜单条目按会话自身规则版本与平衡档案落库（支持按平衡档案隔离）。
        rules_version: String(session.rules_version),
        balance_profile_id: rulesSnapshot.balanceProfileId ?? null,
        session_id: session.id,
      });
    if (leaderboardError && leaderboardError.code !== '23505') {
      console.error('submit-verified-score leaderboard insert failed', leaderboardError);
      return json({ error: 'internal_error' }, 500);
    }
  }

  const ledgerUpdated = await upsertCultivationLedgerEntry(supabase, {
    player_id: link.player_id,
    local_game_id: session.id,
    game_session_id: session.id,
    rules_version: Number(session.rules_version),
    balance_profile_id: rulesSnapshot.balanceProfileId ?? null,
    started_at: session.started_at,
    ended_at: verifiedAt,
    outcome: 'completed',
    final_score: finalScore,
    record_source: 'verified_session',
    updated_at: verifiedAt,
  });
  if (!ledgerUpdated) return json({ error: 'internal_error' }, 500);

  return json({
    verified: true,
    score: finalScore,
    leaderboard_submitted: eligible,
    rules_version: String(session.rules_version),
    balance_profile_id: (session.rules_snapshot as { balanceProfileId?: string })?.balanceProfileId,
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

async function upsertCultivationLedgerEntry(
  supabase: ReturnType<typeof createClient>,
  entry: {
    player_id: string;
    local_game_id: string;
    game_session_id: string;
    rules_version: number;
    balance_profile_id?: string | null;
    started_at: string;
    ended_at: string;
    outcome: 'completed';
    final_score: number | null;
    record_source: 'verified_session';
    updated_at: string;
  },
): Promise<boolean> {
  const { error } = await supabase
    .from('cultivation_ledger_entries')
    .upsert(entry, { onConflict: 'player_id,local_game_id' });
  if (error && error.code !== '23505') {
    console.error('submit-verified-score cultivation ledger upsert failed', error);
    return false;
  }
  return true;
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
