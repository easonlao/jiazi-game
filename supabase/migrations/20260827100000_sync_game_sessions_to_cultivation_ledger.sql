-- Synchronize game_sessions status changes (completed, abandoned) into cultivation_ledger_entries.
-- This ensures that whenever a session is abandoned (via upsert_game_session or timeout),
-- the cloud cultivation ledger immediately and reliably reflects the outcome.

-- Update private.upsert_game_session_impl to match existing sessions by either id or client_session_id,
-- preventing primary key collisions when clients send the database session id.
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
    and (
      (p_session_id is not null and id = p_session_id)
      or (p_client_session_id is not null and client_session_id = p_client_session_id)
    )
  order by (case when id = p_session_id then 0 else 1 end)
  limit 1
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
    p_rules_snapshot
  )
  returning * into result;

  return result;
end;
$$;

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
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_game_session_to_cultivation_ledger on public.game_sessions;

create trigger trg_sync_game_session_to_cultivation_ledger
  after insert or update of status, ended_at, final_score on public.game_sessions
  for each row execute function public.sync_game_session_to_cultivation_ledger();

notify pgrst, 'reload schema';
