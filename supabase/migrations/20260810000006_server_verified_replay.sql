-- Server-verified leaderboard replay.
--
-- A client may still play locally when the verification service is unavailable,
-- but only a session created and completed by the Edge Function can enter the
-- verified leaderboard. The seed and rules snapshot are server-owned inputs.

alter table public.game_sessions
  add column if not exists replay_seed bigint,
  add column if not exists rules_snapshot jsonb,
  add column if not exists verified_at timestamptz;

alter table public.game_sessions
  add constraint game_sessions_replay_seed_safe
  check (replay_seed is null or replay_seed between 0 and 2147483647);

create index if not exists game_sessions_verified_at_idx
  on public.game_sessions (verified_at desc);

-- New sessions and all sensitive session fields are written by the server
-- functions. Existing client sessions remain readable for historical analytics.
revoke insert, update on public.game_sessions from authenticated;

-- The old owner insert path is intentionally retained as a policy definition
-- for compatibility with existing metadata, but no authenticated role has the
-- table privilege to use it after this migration.

-- Replace the eligibility trigger with a stronger gate. This applies to
-- service_role/direct SQL too, so a leaked client path cannot manufacture a
-- verified leaderboard row.
create or replace function public.block_ineligible_leaderboard_entry()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.game_sessions gs
    join public.player_profiles pp on pp.id = gs.player_id
    where gs.id = new.session_id
      and pp.public_player_id = new.public_player_id
      and pp.leaderboard_eligible = true
      and btrim(pp.display_name) <> ''
      and gs.status = 'completed'
      and gs.rounds_completed = 60
      and gs.verified_at is not null
  ) then
    raise exception 'leaderboard entry requires a completed server-verified 60-round session';
  end if;
  return new;
end;
$$;

-- Direct client inserts are no longer a valid path. The trigger remains as a
-- defense-in-depth check for service_role and SQL execution paths.
revoke insert on public.leaderboard_entries from authenticated;
