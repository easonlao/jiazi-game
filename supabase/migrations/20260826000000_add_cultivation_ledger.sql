create table public.cultivation_ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references public.player_profiles (id) on delete cascade,
  local_game_id   text not null,
  game_session_id uuid references public.game_sessions (id) on delete set null,
  rules_version   integer not null check (rules_version >= 0),
  started_at      timestamptz not null,
  ended_at        timestamptz not null,
  outcome         text not null check (outcome in ('completed', 'abandoned')),
  final_score     numeric(12,1),
  record_source   text not null check (record_source in ('local_claim', 'verified_session')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (btrim(local_game_id) <> ''),
  check (ended_at >= started_at),
  check (
    (outcome = 'completed' and final_score is not null and final_score >= 0)
    or (outcome = 'abandoned' and final_score is null)
  ),
  check (
    (record_source = 'local_claim' and game_session_id is null)
    or (record_source = 'verified_session' and game_session_id is not null)
  ),
  unique (player_id, local_game_id)
);

create index cultivation_ledger_entries_player_id_idx
  on public.cultivation_ledger_entries (player_id);

create index cultivation_ledger_entries_player_started_at_idx
  on public.cultivation_ledger_entries (player_id, started_at desc);

create index cultivation_ledger_entries_player_rules_version_idx
  on public.cultivation_ledger_entries (player_id, rules_version, outcome);

create index cultivation_ledger_entries_game_session_id_idx
  on public.cultivation_ledger_entries (game_session_id)
  where game_session_id is not null;

alter table public.cultivation_ledger_entries enable row level security;

create policy "cultivation_ledger_entries_owner_select"
  on public.cultivation_ledger_entries
  for select
  to authenticated
  using (exists (
    select 1
    from public.player_identity_links pil
    where pil.player_id = cultivation_ledger_entries.player_id
      and pil.auth_user_id = auth.uid()
  ));

revoke all on table public.cultivation_ledger_entries from anon;
revoke insert, update, delete on table public.cultivation_ledger_entries from authenticated;
grant select on table public.cultivation_ledger_entries to authenticated;
grant all on table public.cultivation_ledger_entries to service_role;
