import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  replayGame,
  ReplayValidationError,
  type ReplayAction,
} from '../../../src/core/ReplayRunner.ts';

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
  if (!sessionId) return json({ error: 'invalid_body', message: 'session_id is required' }, 400);
  const expectedRevision = typeof body?.expected_session_revision === 'number'
    ? body.expected_session_revision
    : typeof body?.expected_last_event_sequence === 'number'
      ? body.expected_last_event_sequence
      : null;

  const { data: link, error: linkError } = await supabase
    .from('player_identity_links')
    .select('player_id')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  if (linkError) return json({ error: 'internal_error' }, 500);
  if (!link) return json({ error: 'identity_not_ready' }, 403);

  const { data: session, error: sessionError } = await supabase
    .from('game_sessions')
    .select('id, player_id, status, rules_version, replay_seed, rules_snapshot, started_at, verified_at, final_score, rounds_completed, session_revision')
    .eq('id', sessionId)
    .eq('player_id', link.player_id)
    .maybeSingle();
  if (sessionError) return json({ error: 'internal_error' }, 500);
  if (!session) return json({ error: 'session_not_found' }, 404);

  // 若已在 corrupted_recovery 终态，幂等返回成功
  if (session.status === 'corrupted_recovery') {
    return json({ success: true, status: 'corrupted_recovery', session_id: sessionId }, 200);
  }
  // P0: 仅允许 started 或 running 会话进入技术恢复，严禁篡改已终结会话（abandoned/failed/completed）
  if (session.status !== 'started' && session.status !== 'running') {
    return json({
      error: 'session_already_finalized',
      message: `Session status is ${session.status}. Only active sessions (started/running) can be recovered.`,
    }, 409);
  }

  // 从数据库读取事件链
  const { data: events, error: eventsError } = await supabase
    .from('game_events')
    .select('event_type, sequence, payload, occurred_at')
    .eq('player_id', link.player_id)
    .eq('session_id', sessionId)
    .order('sequence', { ascending: true })
    .order('occurred_at', { ascending: true });
  if (eventsError) return json({ error: 'internal_error' }, 500);

  const actions: ReplayAction[] = [];
  let maxObservedSequence = 0;
  if (Array.isArray(events)) {
    for (const ev of events) {
      if (typeof ev.sequence === 'number' && ev.sequence > maxObservedSequence) {
        maxObservedSequence = ev.sequence;
      }
      const p = (ev.payload as Record<string, unknown>) ?? {};
      if (p.replay_action && typeof (p.replay_action as { type?: unknown }).type === 'string') {
        actions.push(p.replay_action as ReplayAction);
      } else if (ev.event_type === 'action_buy' && typeof p.card_index === 'number') {
        actions.push({ type: 'buy', cardIndex: p.card_index, leverage: Boolean(p.use_leverage) });
      } else if (ev.event_type === 'action_sell' && typeof p.slot_index === 'number') {
        actions.push({ type: 'sell', slotIndex: p.slot_index });
      } else if (ev.event_type === 'action_wait') {
        actions.push({ type: 'wait' });
      } else if (ev.event_type === 'action_lock' && typeof p.card_index === 'number') {
        actions.push({ type: 'lock', cardIndex: p.card_index });
      } else if (ev.event_type === 'action_unlock' && typeof p.card_index === 'number') {
        actions.push({ type: 'unlock', cardIndex: p.card_index });
      }
    }
  }

  let isCorrupted = false;
  let corruptionReason = '';

  // 1. 检查 seed 与规则快照
  if (typeof session.replay_seed !== 'number' || !session.rules_snapshot) {
    isCorrupted = true;
    corruptionReason = 'Missing replay seed or rules snapshot in session';
  } else {
    // 2. 在隔离沙箱中真实重放已上传的事件链（采用合法前缀模式：校验已发生动作合法性与牌池守恒，不要求对局必须结束）
    try {
      await replayGame({
        seed: session.replay_seed,
        actions,
        rulesVersion: session.rules_snapshot.rulesVersion,
        volatility: session.rules_snapshot.volatility,
        scoreRules: session.rules_snapshot.scoreRules,
        voidCardCount: (session.rules_snapshot as { voidCardCount?: number }).voidCardCount !== undefined
          ? (session.rules_snapshot as { voidCardCount?: number }).voidCardCount
          : (session.rules_snapshot.rulesVersion >= 5 ? 3 : 0),
        requireCompleted: false,
      });
      // 若前缀重放完全成功且合法，证明进行中对局完全健康，非受损对局！
      isCorrupted = false;
    } catch (err) {
      // 抛出异常（如牌池守恒被破坏、非法卡牌索引、规则冲突），证实损坏证据确凿
      isCorrupted = true;
      corruptionReason = err instanceof Error ? err.message : String(err);
    }
  }

  if (!isCorrupted) {
    // 对局健康，拒绝恶意伪造受损恢复！
    return json({
      error: 'session_not_corrupted',
      message: 'Replay succeeded. Session is valid and healthy, technical recovery rejected.',
    }, 422);
  }

  // P1: 使用 Service Role 调用私有原子 RPC finalize_corrupted_recovery（行级锁 + advisory 锁 + 版本校验）
  const targetExpectedRevision = expectedRevision ?? (typeof session.session_revision === 'number' ? session.session_revision : null);
  const { error: updateError } = await supabase.schema('private').rpc('finalize_corrupted_recovery', {
    p_session_id: session.id,
    p_player_id: link.player_id,
    p_expected_session_revision: targetExpectedRevision,
  });

  if (updateError) {
    const code = (updateError as any).code ?? '';
    const msg = updateError.message ?? '';
    if (code === '40900' || msg.includes('conflict') || msg.includes('session_already_finalized')) {
      return json({
        error: 'conflict',
        message: 'Concurrent session update detected during recovery.',
      }, 409);
    }
    console.error('Failed to finalize corrupted_recovery', updateError);
    return json({ error: 'internal_error' }, 500);
  }

  return json({
    success: true,
    status: 'corrupted_recovery',
    session_id: sessionId,
    corruption_reason: corruptionReason,
  }, 200);
});

function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text();
    if (!text) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function json(payload: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}
