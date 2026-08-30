-- Migration: 20260828100000_support_corrupted_recovery_status.sql
-- Support technical corrupted game recovery status on game_sessions without polluting cultivation ledger.

alter table public.game_sessions drop constraint if exists game_sessions_status_check;
alter table public.game_sessions add constraint game_sessions_status_check
  check (status in ('started', 'running', 'completed', 'abandoned', 'failed', 'corrupted_recovery'));

alter table public.game_sessions add column if not exists session_revision integer not null default 0;

-- Backfill existing sessions session_revision based on existing game_events
update public.game_sessions s
set session_revision = coalesce((select count(*) from public.game_events e where e.session_id = s.id), 0)
where session_revision = 0;

-- Trigger on game_events: increment session_revision atomically whenever any device writes an event
create or replace function public.sync_game_event_session_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  update public.game_sessions
  set session_revision = session_revision + 1
  where id = new.session_id;
  return new;
end;
$$;

drop trigger if exists trg_game_events_increment_session_revision on public.game_events;
create trigger trg_game_events_increment_session_revision
  after insert on public.game_events
  for each row execute function public.sync_game_event_session_revision();

-- Controlled append-only RPC for game_events: respects append-only permissions and returns updated session_revision.
create or replace function public.append_game_events(
  p_player_id uuid,
  p_events jsonb
)
returns table (
  session_id uuid,
  session_revision integer,
  inserted_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_inserted integer := 0;
begin
  if not exists (
    select 1
    from public.player_identity_links pil
    where pil.player_id = p_player_id
      and pil.auth_user_id = auth.uid()
  ) then
    raise exception 'player does not belong to current user';
  end if;

  if p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0 then
    return;
  end if;

  -- 严格会话归属校验：所有事件必须关联属于当前玩家的合法会话，杜绝跨会话攻击与恶意推进 revision
  if exists (
    select 1
    from jsonb_array_elements(p_events) as e
    where (e->>'session_id') is null
       or not exists (
         select 1
         from public.game_sessions s
         where s.id = (e->>'session_id')::uuid
           and s.player_id = p_player_id
       )
  ) then
    raise exception 'session does not belong to current player';
  end if;

  with raw_events as (
    select
      p_player_id as player_id,
      (e->>'session_id')::uuid as session_id,
      e->>'client_event_id' as client_event_id,
      coalesce((e->>'sequence')::bigint, 0) as sequence,
      coalesce(e->>'event_type', 'unknown') as event_type,
      (e->>'round')::integer as round,
      e->>'season' as season,
      e->>'action' as action,
      coalesce(e->'payload', '{}'::jsonb) as payload,
      coalesce((e->>'occurred_at')::timestamptz, clock_timestamp()) as occurred_at
    from jsonb_array_elements(p_events) as e
    where e->>'session_id' is not null and e->>'client_event_id' is not null
  ),
  ins as (
    insert into public.game_events (
      player_id,
      session_id,
      client_event_id,
      sequence,
      event_type,
      round,
      season,
      action,
      payload,
      occurred_at
    )
    select
      r.player_id,
      r.session_id,
      r.client_event_id,
      r.sequence,
      r.event_type,
      r.round,
      r.season,
      r.action,
      r.payload,
      r.occurred_at
    from raw_events r
    join public.game_sessions s on s.id = r.session_id and s.player_id = r.player_id
    on conflict (player_id, client_event_id) do nothing
    returning session_id
  )
  select count(*)::integer into v_inserted from ins;

  return query
  select
    s.id as session_id,
    s.session_revision,
    v_inserted as inserted_count
  from public.game_sessions s
  where s.id in (
    select distinct (e->>'session_id')::uuid
    from jsonb_array_elements(p_events) as e
    where e->>'session_id' is not null
  );
end;
$$;

revoke all on function public.append_game_events(uuid, jsonb) from public, anon;
grant execute on function public.append_game_events(uuid, jsonb) to authenticated, service_role;

-- Explicitly drop legacy overloads to guarantee a single canonical RPC signature
drop function if exists public.upsert_game_session(uuid, uuid, text, timestamptz, text, integer, numeric, text, text, text, text, timestamptz);
drop function if exists public.upsert_game_session(uuid, uuid, text, timestamptz, text, integer, numeric, text, text, text, text, timestamptz, integer);
drop function if exists private.upsert_game_session_impl(uuid, uuid, text, timestamptz, text, integer, numeric, text, text, text, text, boolean, timestamptz, bigint, jsonb);
drop function if exists private.upsert_game_session_impl(uuid, uuid, text, timestamptz, text, integer, numeric, text, text, text, text, boolean, timestamptz, bigint, jsonb, integer);

-- Generic private session upsert implementation.
-- NOTE: 'corrupted_recovery' is DELIBERATELY EXCLUDED here.
-- corrupted_recovery MUST only be written via private.finalize_corrupted_recovery on started/running sessions.
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
  p_rules_snapshot     jsonb default null,
  p_expected_session_revision integer default null
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

  if p_status not in ('started', 'running', 'completed', 'abandoned', 'failed') then
    raise exception 'invalid session status: %', p_status;
  end if;
  if p_status = 'abandoned' and p_expected_session_revision is null then
    raise exception 'expected_session_revision is required for abandoned status' using errcode = '22000';
  end if;
  if p_client_session_id is null or char_length(p_client_session_id) = 0
     or char_length(p_client_session_id) > 128 then
    raise exception 'invalid client session id';
  end if;
  if p_rounds_completed < 0 or p_final_score < 0 then
    raise exception 'invalid session totals';
  end if;

  -- Serialize all starts for one player.
  perform pg_advisory_xact_lock(
    hashtextextended('jiazi-game-session:' || p_player_id::text, 0)
  );

  select *
  into existing
  from public.game_sessions
  where player_id = p_player_id
    and (
      (p_session_id is not null and id = p_session_id)
      or (p_client_session_id is not null and client_session_id = p_client_session_id)
    )
  order by (case when id = p_session_id then 0 else 1 end)
  limit 1
  for update;

  if existing.id is not null then
    if existing.status in ('completed', 'failed', 'corrupted_recovery') then
      return existing;
    end if;
    if existing.status = 'abandoned' then
      return existing;
    end if;
    if p_status in ('started', 'running') then
      return existing;
    end if;

    -- Concurrency revision check: if client specified an expected session revision,
    -- ensure no newer events were inserted on the server by another device.
    if p_expected_session_revision is not null then
      if existing.session_revision > p_expected_session_revision then
        raise exception 'conflict: newer session revision exists (expected %, actual %)',
          p_expected_session_revision, existing.session_revision
          using errcode = '40900';
      end if;
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
    rules_snapshot,
    session_revision
  ) values (
    coalesce(p_session_id, gen_random_uuid()),
    p_player_id,
    p_client_session_id,
    p_rules_version,
    p_game_mode,
    p_app_version,
    p_consent_version,
    p_status,
    coalesce(p_started_at, clock_timestamp()),
    p_ended_at,
    p_rounds_completed,
    p_final_score,
    p_replay_seed,
    p_rules_snapshot,
    0
  )
  returning * into result;

  return result;
end;
$$;

-- Private atomic finalizer for technical recovery.
-- Only accessible to service_role; strictly verifies that session is started/running
-- and that no concurrent newer events were written before marking corrupted_recovery.
create or replace function private.finalize_corrupted_recovery(
  p_session_id uuid,
  p_player_id uuid,
  p_expected_session_revision integer default null
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_session public.game_sessions;
  v_result public.game_sessions;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('jiazi-game-session:' || p_player_id::text, 0)
  );

  select *
  into v_session
  from public.game_sessions
  where id = p_session_id and player_id = p_player_id
  for update;

  if v_session.id is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  if v_session.status = 'corrupted_recovery' then
    return v_session;
  end if;

  -- P0: Strict guard - only started or running sessions may enter corrupted_recovery.
  -- Abandoned, failed, or completed sessions MUST NEVER be converted to corrupted_recovery.
  if v_session.status not in ('started', 'running') then
    raise exception 'session_already_finalized: current status is %', v_session.status
      using errcode = '40900';
  end if;

  -- P1: Concurrency revision check
  if p_expected_session_revision is not null then
    if v_session.session_revision > p_expected_session_revision then
      raise exception 'conflict: newer session revision exists (expected %, actual %)',
        p_expected_session_revision, v_session.session_revision
        using errcode = '40900';
    end if;
  end if;

  update public.game_sessions
  set
    status = 'corrupted_recovery',
    ended_at = clock_timestamp()
  where id = v_session.id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function private.finalize_corrupted_recovery(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function private.finalize_corrupted_recovery(uuid, uuid, integer) to service_role;

revoke all on function private.upsert_game_session_impl(uuid, uuid, text, timestamptz, text, integer, numeric, text, text, text, text, boolean, timestamptz, bigint, jsonb, integer) from public, anon, authenticated;
grant execute on function private.upsert_game_session_impl(uuid, uuid, text, timestamptz, text, integer, numeric, text, text, text, text, boolean, timestamptz, bigint, jsonb, integer) to service_role;

-- Public RPC: only allowed for standard player transitions.
-- 'corrupted_recovery' is strictly forbidden via public RPC and must go through server-side verification.
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
  p_ended_at           timestamptz default null,
  p_expected_session_revision integer default null
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if p_status not in ('started', 'running', 'completed', 'abandoned', 'failed') then
    raise exception 'invalid session status for public upsert: %', p_status;
  end if;

  return private.upsert_game_session_impl(
    p_player_id         => p_player_id,
    p_session_id        => p_session_id,
    p_client_session_id => p_client_session_id,
    p_started_at        => p_started_at,
    p_status            => p_status,
    p_rounds_completed  => p_rounds_completed,
    p_final_score       => p_final_score,
    p_rules_version     => p_rules_version,
    p_game_mode         => p_game_mode,
    p_app_version       => p_app_version,
    p_consent_version   => p_consent_version,
    p_require_owner     => true,
    p_ended_at          => p_ended_at,
    p_replay_seed       => null,
    p_rules_snapshot    => null,
    p_expected_session_revision => p_expected_session_revision
  );
end;
$$;

revoke all on function public.upsert_game_session(uuid, uuid, text, timestamptz, text, integer, numeric, text, text, text, text, timestamptz, integer) from public, anon;
grant execute on function public.upsert_game_session(uuid, uuid, text, timestamptz, text, integer, numeric, text, text, text, text, timestamptz, integer) to authenticated, service_role;

create or replace function public.sync_game_session_to_cultivation_ledger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.status in ('completed', 'abandoned') then
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
    ) values (
      new.player_id,
      new.id::text,
      new.id,
      case
        when new.rules_version ~ '^[0-9]+$' then new.rules_version::integer
        else 1
      end,
      new.started_at,
      greatest(coalesce(new.ended_at, new.verified_at, new.created_at, clock_timestamp()), new.started_at),
      new.status,
      case
        when new.status = 'completed' then greatest(0, round(new.final_score::numeric, 1))
        else null
      end,
      'verified_session',
      coalesce(new.created_at, new.started_at, now()),
      coalesce(new.verified_at, new.ended_at, now())
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
  elsif new.status = 'corrupted_recovery' then
    delete from public.cultivation_ledger_entries
    where player_id = new.player_id
      and (game_session_id = new.id or local_game_id = new.id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_game_session_to_cultivation_ledger on public.game_sessions;

create trigger trg_sync_game_session_to_cultivation_ledger
  after insert or update of status, ended_at, final_score on public.game_sessions
  for each row execute function public.sync_game_session_to_cultivation_ledger();

notify pgrst, 'reload schema';
