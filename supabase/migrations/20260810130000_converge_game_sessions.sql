-- Converge superseded sessions and make session creation idempotent.
--
-- Events remain append-only. An abandoned session is historical telemetry,
-- not a completed game and must not be reused for leaderboard purposes.

create or replace function private.backfill_abandoned_sessions()
returns table (processed bigint, skipped bigint)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  active_count bigint;
  updated_count bigint;
begin
  select count(*)
  into active_count
  from public.game_sessions
  where status in ('started', 'running');

  update public.game_sessions as gs
  set
    status = 'abandoned',
    ended_at = greatest(clock_timestamp(), gs.started_at)
  where gs.status in ('started', 'running')
    and exists (
      select 1
      from public.game_sessions newer
      where newer.player_id = gs.player_id
        and (newer.created_at, newer.id) > (gs.created_at, gs.id)
    );
  get diagnostics updated_count = row_count;

  return query select updated_count, greatest(active_count - updated_count, 0);
end;
$$;

revoke all on function private.backfill_abandoned_sessions() from public, anon, authenticated;
grant execute on function private.backfill_abandoned_sessions() to service_role;

-- Emit a durable-enough migration log entry with processed/skipped counts.
do $$
declare
  processed_count bigint;
  skipped_count bigint;
begin
  select processed, skipped
  into processed_count, skipped_count
  from private.backfill_abandoned_sessions();
  raise notice 'jiazi session backfill: processed=%, skipped=%', processed_count, skipped_count;
end;
$$;

-- The migration above leaves at most one currently active session per player.
-- The partial uniqueness guard prevents races from creating more later.
create unique index if not exists game_sessions_one_active_per_player_idx
  on public.game_sessions (player_id)
  where status in ('started', 'running');

-- Shared implementation. It is intentionally not granted to application
-- roles; the two narrow wrappers below expose different trust boundaries.
create or replace function private.upsert_game_session_impl(
  p_player_id         uuid,
  p_session_id        uuid,
  p_client_session_id text,
  p_started_at        timestamptz,
  p_status             text,
  p_rounds_completed   integer,
  p_final_score        numeric,
  p_rules_version      text,
  p_game_mode          text,
  p_app_version        text,
  p_consent_version    text,
  p_require_owner      boolean,
  p_ended_at           timestamptz default null,
  p_replay_seed        bigint default null,
  p_rules_snapshot     jsonb default null
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  existing public.game_sessions;
  result public.game_sessions;
  effective_ended_at timestamptz;
begin
  if p_require_owner and not exists (
    select 1
    from public.player_identity_links pil
    where pil.player_id = p_player_id
      and pil.auth_user_id = auth.uid()
  ) then
    raise exception 'session player does not belong to current user';
  end if;

  if p_status not in ('started', 'running', 'completed', 'abandoned') then
    raise exception 'invalid session status';
  end if;
  if p_client_session_id is null or char_length(p_client_session_id) = 0
     or char_length(p_client_session_id) > 128 then
    raise exception 'invalid client session id';
  end if;
  if p_rounds_completed < 0 or p_final_score < 0 then
    raise exception 'invalid session totals';
  end if;

  -- Serialize all starts for one player. The lock is transaction-scoped, so
  -- the old-session update and new-session insert are one atomic operation.
  perform pg_advisory_xact_lock(
    hashtextextended('jiazi-game-session:' || p_player_id::text, 0)
  );

  select *
  into existing
  from public.game_sessions
  where player_id = p_player_id
    and client_session_id = p_client_session_id
  for update;

  if existing.id is not null then
    -- A retry of the same start must be idempotent and must not reopen a
    -- completed/abandoned session.
    if existing.status in ('completed', 'abandoned', 'failed') then
      return existing;
    end if;
    if p_status in ('started', 'running') then
      return existing;
    end if;

    effective_ended_at := greatest(
      coalesce(p_ended_at, clock_timestamp()),
      existing.started_at
    );

    update public.game_sessions
    set
      status = p_status,
      rounds_completed = p_rounds_completed,
      final_score = p_final_score,
      ended_at = effective_ended_at,
      replay_seed = coalesce(p_replay_seed, replay_seed),
      rules_snapshot = coalesce(p_rules_snapshot, rules_snapshot)
    where id = existing.id
    returning * into result;
    return result;
  end if;

  if p_status in ('started', 'running') then
    update public.game_sessions
    set
      status = 'abandoned',
      ended_at = greatest(clock_timestamp(), started_at)
    where player_id = p_player_id
      and status in ('started', 'running');
  end if;

  insert into public.game_sessions (
    id,
    player_id,
    client_session_id,
    rules_version,
    game_mode,
    app_version,
    consent_version,
    status,
    started_at,
    ended_at,
    rounds_completed,
    final_score,
    replay_seed,
    rules_snapshot
  ) values (
    p_session_id,
    p_player_id,
    p_client_session_id,
    p_rules_version,
    p_game_mode,
    p_app_version,
    p_consent_version,
    p_status,
    p_started_at,
    case when p_status in ('started', 'running') then null
         else greatest(coalesce(p_ended_at, clock_timestamp()), p_started_at)
    end,
    p_rounds_completed,
    p_final_score,
    p_replay_seed,
    p_rules_snapshot
  )
  returning * into result;

  return result;
end;
$$;

-- Authenticated clients may create/finalize only their own ordinary telemetry
-- sessions. Server-owned replay fields are deliberately not parameters here.
create or replace function public.upsert_game_session(
  p_player_id         uuid,
  p_session_id        uuid,
  p_client_session_id text,
  p_started_at        timestamptz,
  p_status             text,
  p_rounds_completed   integer,
  p_final_score        numeric,
  p_rules_version      text,
  p_game_mode          text,
  p_app_version        text,
  p_consent_version    text,
  p_ended_at           timestamptz default null
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  return private.upsert_game_session_impl(
    p_player_id => p_player_id,
    p_session_id => p_session_id,
    p_client_session_id => p_client_session_id,
    p_started_at => p_started_at,
    p_status => p_status,
    p_rounds_completed => p_rounds_completed,
    p_final_score => p_final_score,
    p_rules_version => p_rules_version,
    p_game_mode => p_game_mode,
    p_app_version => p_app_version,
    p_consent_version => p_consent_version,
    p_require_owner => true,
    p_ended_at => p_ended_at
  );
end;
$$;

-- Only the service role may create a server-verified session with replay
-- inputs. The Edge Function authenticates the player before calling this RPC.
create or replace function private.start_verified_game_session(
  p_player_id         uuid,
  p_session_id        uuid,
  p_client_session_id text,
  p_started_at        timestamptz,
  p_rules_version      text,
  p_game_mode          text,
  p_app_version        text,
  p_consent_version    text,
  p_replay_seed        bigint,
  p_rules_snapshot     jsonb
)
returns public.game_sessions
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
begin
  return private.upsert_game_session_impl(
    p_player_id => p_player_id,
    p_session_id => p_session_id,
    p_client_session_id => p_client_session_id,
    p_started_at => p_started_at,
    p_status => 'started',
    p_rounds_completed => 0,
    p_final_score => 0,
    p_rules_version => p_rules_version,
    p_game_mode => p_game_mode,
    p_app_version => p_app_version,
    p_consent_version => p_consent_version,
    p_require_owner => false,
    p_replay_seed => p_replay_seed,
    p_rules_snapshot => p_rules_snapshot
  );
end;
$$;

revoke all on function private.upsert_game_session_impl(
  uuid, uuid, text, timestamptz, text, integer, numeric, text, text,
  text, text, boolean, timestamptz, bigint, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.upsert_game_session_impl(
  uuid, uuid, text, timestamptz, text, integer, numeric, text, text,
  text, text, boolean, timestamptz, bigint, jsonb
) to service_role;
revoke all on function public.upsert_game_session(
  uuid, uuid, text, timestamptz, text, integer, numeric, text, text,
  text, text, timestamptz
) from public, anon;
grant execute on function public.upsert_game_session(
  uuid, uuid, text, timestamptz, text, integer, numeric, text, text,
  text, text, timestamptz
) to authenticated;
revoke all on function private.start_verified_game_session(
  uuid, uuid, text, timestamptz, text, text, text, text, bigint, jsonb
) from public, anon, authenticated;
grant execute on function private.start_verified_game_session(
  uuid, uuid, text, timestamptz, text, text, text, text, bigint, jsonb
) to service_role;
