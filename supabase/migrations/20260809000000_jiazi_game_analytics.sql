create extension if not exists pgcrypto;

create schema if not exists private;

create table public.player_profiles (
  id               uuid primary key default gen_random_uuid(),
  public_player_id uuid not null unique default gen_random_uuid(),
  display_name     text not null check (char_length(display_name) between 1 and 12),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.player_profiles enable row level security;

create table private.recovery_secrets (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.player_profiles (id) on delete cascade,
  secret_hash text not null check (char_length(secret_hash) > 0),
  created_at  timestamptz not null default now()
);

create index recovery_secrets_player_id_idx
  on private.recovery_secrets (player_id);

revoke all on schema private from anon, authenticated;
revoke all on table private.recovery_secrets from anon, authenticated;

create table private.recovery_attempts (
  auth_user_id      uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempt_count     integer not null default 0 check (attempt_count >= 0),
  updated_at        timestamptz not null default now()
);

revoke all on table private.recovery_attempts from anon, authenticated;

grant usage on schema private to service_role;
grant all on table private.recovery_secrets to service_role;
grant all on table private.recovery_attempts to service_role;

create table public.player_identity_links (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references public.player_profiles (id) on delete cascade,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (auth_user_id)
);

create index player_identity_links_player_id_idx
  on public.player_identity_links (player_id);

alter table public.player_identity_links enable row level security;

create policy "player_profiles_public_select"
  on public.player_profiles
  for select
  to anon, authenticated
  using (true);

create policy "player_profiles_owner_update"
  on public.player_profiles
  for update
  to authenticated
  using (exists (
    select 1 from public.player_identity_links pil
    where pil.player_id = player_profiles.id
      and pil.auth_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.player_identity_links pil
    where pil.player_id = player_profiles.id
      and pil.auth_user_id = auth.uid()
  ));

create policy "player_identity_links_owner_select"
  on public.player_identity_links
  for select
  to authenticated
  using (auth_user_id = auth.uid());

create table public.game_sessions (
  id                uuid primary key default gen_random_uuid(),
  player_id         uuid not null references public.player_profiles (id) on delete cascade,
  client_session_id text not null,
  rules_version     text not null,
  game_mode         text not null,
  app_version       text not null,
  consent_version   text not null,
  status            text not null default 'started'
                    check (status in ('started', 'running', 'completed', 'abandoned', 'failed')),
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  rounds_completed  integer not null default 0 check (rounds_completed >= 0),
  final_score       numeric(12,1) not null default 0 check (final_score >= 0),
  created_at        timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  unique (player_id, client_session_id)
);

create index game_sessions_player_id_idx on public.game_sessions (player_id);
create index game_sessions_status_idx on public.game_sessions (status);
create index game_sessions_started_at_idx on public.game_sessions (started_at desc);

alter table public.game_sessions enable row level security;

create policy "game_sessions_owner_insert"
  on public.game_sessions
  for insert
  to authenticated
  with check (exists (
    select 1 from public.player_identity_links pil
    where pil.player_id = game_sessions.player_id
      and pil.auth_user_id = auth.uid()
  ));

create policy "game_sessions_owner_select"
  on public.game_sessions
  for select
  to authenticated
  using (exists (
    select 1 from public.player_identity_links pil
    where pil.player_id = game_sessions.player_id
      and pil.auth_user_id = auth.uid()
  ));

create policy "game_sessions_owner_update"
  on public.game_sessions
  for update
  to authenticated
  using (exists (
    select 1 from public.player_identity_links pil
    where pil.player_id = game_sessions.player_id
      and pil.auth_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.player_identity_links pil
    where pil.player_id = game_sessions.player_id
      and pil.auth_user_id = auth.uid()
  ));

create table public.game_events (
  id              bigint generated always as identity primary key,
  player_id       uuid not null references public.player_profiles (id) on delete cascade,
  session_id      uuid not null references public.game_sessions (id) on delete cascade,
  client_event_id text not null,
  sequence        bigint not null check (sequence >= 0),
  event_type      text not null check (event_type in (
                    'session_start', 'session_end', 'session_abandon',
                    'action_buy', 'action_sell', 'action_wait',
                    'action_lock', 'action_unlock', 'round_settled'
                  )),
  event_version   integer not null default 1 check (event_version >= 0),
  round           integer,
  season          text,
  action          text,
  payload         jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null,
  inserted_at     timestamptz not null default now(),
  unique (player_id, client_event_id)
);

create index game_events_player_id_sequence_idx on public.game_events (player_id, sequence);
create index game_events_session_id_idx on public.game_events (session_id);
create index game_events_occurred_at_idx on public.game_events (occurred_at desc);
create index game_events_type_idx on public.game_events (event_type);

alter table public.game_events enable row level security;

create policy "game_events_owner_insert"
  on public.game_events
  for insert
  to authenticated
  with check (exists (
    select 1 from public.game_sessions gs
    join public.player_identity_links pil on pil.player_id = gs.player_id
    where gs.id = session_id
      and gs.player_id = game_events.player_id
      and pil.auth_user_id = auth.uid()
  ));

create policy "game_events_owner_select"
  on public.game_events
  for select
  to authenticated
  using (exists (
    select 1 from public.game_sessions gs
    join public.player_identity_links pil on pil.player_id = gs.player_id
    where gs.id = session_id
      and pil.auth_user_id = auth.uid()
  ));

create function public.block_game_events_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'public.game_events is append-only; rows may not be updated or deleted';
end;
$$;

create trigger trg_game_events_append_only
  before update or delete on public.game_events
  for each row execute function public.block_game_events_mutation();

revoke all on function public.block_game_events_mutation() from public;

create table public.leaderboard_entries (
  id               uuid primary key default gen_random_uuid(),
  public_player_id uuid not null references public.player_profiles (public_player_id) on delete cascade,
  score            numeric(12,1) not null check (score >= 0),
  rules_version    text not null,
  session_id       uuid not null references public.game_sessions (id) on delete cascade,
  created_at       timestamptz not null default now()
);

create index leaderboard_entries_rank_idx on public.leaderboard_entries (rules_version, score desc);
create index leaderboard_entries_public_player_id_idx on public.leaderboard_entries (public_player_id);
create index leaderboard_entries_session_id_idx on public.leaderboard_entries (session_id);

alter table public.leaderboard_entries enable row level security;

create policy "leaderboard_entries_public_select"
  on public.leaderboard_entries
  for select
  to anon, authenticated
  using (true);

create policy "leaderboard_entries_owner_insert"
  on public.leaderboard_entries
  for insert
  to authenticated
  with check (exists (
    select 1 from public.game_sessions gs
    join public.player_profiles pp on pp.id = gs.player_id
    join public.player_identity_links pil on pil.player_id = gs.player_id
    where gs.id = session_id
      and pp.public_player_id = leaderboard_entries.public_player_id
      and pil.auth_user_id = auth.uid()
  ));

grant usage on schema public to anon, authenticated;

grant select on public.player_profiles to anon, authenticated;
grant update on public.player_profiles to authenticated;

grant select on public.player_identity_links to authenticated;

grant insert, select, update on public.game_sessions to authenticated;

grant insert, select on public.game_events to authenticated;
revoke update, delete on public.game_events from anon, authenticated;

grant select on public.leaderboard_entries to anon, authenticated;
grant insert on public.leaderboard_entries to authenticated;
