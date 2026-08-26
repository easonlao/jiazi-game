-- Backfill historical completed and abandoned game sessions into cultivation_ledger_entries.
--
-- This ensures existing players' historical records are visible in their
-- cultivation profile and ledger summaries immediately upon upgrade.

insert into public.cultivation_ledger_entries (
  player_id,
  local_game_id,
  game_session_id,
  rules_version,
  started_at,
  ended_at,
  outcome,
  final_score,
  record_source,
  created_at,
  updated_at
)
select
  gs.player_id,
  gs.id::text as local_game_id,
  gs.id as game_session_id,
  case
    when gs.rules_version ~ '^[0-9]+$' then gs.rules_version::integer
    else 1
  end as rules_version,
  gs.started_at,
  greatest(coalesce(gs.ended_at, gs.verified_at, gs.created_at, clock_timestamp()), gs.started_at) as ended_at,
  gs.status as outcome,
  case
    when gs.status = 'completed' then greatest(0, round(gs.final_score::numeric, 1))
    else null
  end as final_score,
  'verified_session' as record_source,
  coalesce(gs.created_at, gs.started_at, now()) as created_at,
  coalesce(gs.verified_at, gs.ended_at, gs.created_at, now()) as updated_at
from public.game_sessions gs
where gs.status in ('completed', 'abandoned')
  and exists (
    select 1
    from public.player_profiles pp
    where pp.id = gs.player_id
  )
on conflict (player_id, local_game_id) do update set
  game_session_id = excluded.game_session_id,
  rules_version = excluded.rules_version,
  started_at = excluded.started_at,
  ended_at = excluded.ended_at,
  outcome = excluded.outcome,
  final_score = excluded.final_score,
  record_source = excluded.record_source,
  updated_at = excluded.updated_at;

notify pgrst, 'reload schema';
