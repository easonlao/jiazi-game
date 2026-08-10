-- Leaderboard eligibility gate.
--
-- Goal: only players who have set an explicit username may appear on the
-- public cloud leaderboard. Auto-provisioned anonymous "players" (placeholder
-- display_name '玩家') must be able to play locally and have sessions/events
-- collected, but their final scores must never be inserted into
-- leaderboard_entries.
--
-- 1) New boolean flag leaderboard_eligible on player_profiles.
--    default false = auto-provisioned / username not set yet.
--    set to true  = a non-empty display name was explicitly saved
--                   (updateDisplayName), or a legacy custom name exists.
--
-- 2) Compatibility backfill for existing rows:
--    provision-player always wrote the placeholder '玩家' and there was no
--    other path that could set display_name, so any historical profile whose
--    display_name is not the placeholder must have had a custom name saved
--    via updateDisplayName -> treat it as eligible.
--    Placeholder-named profiles stay ineligible; the player re-saves a name
--    in-app (updateDisplayName) to become eligible. This avoids silently
--    granting eligibility to never-named players while not revoking it from
--    already-named ones.
--
-- 3) Enforcement at the database layer (defense in depth, not just client):
--    - leaderboard_entries RLS insert policy additionally requires the owning
--      profile to be leaderboard_eligible;
--    - a BEFORE INSERT trigger blocks any path (incl. service_role) that tries
--      to insert a leaderboard entry for an ineligible profile.

alter table public.player_profiles
  add column if not exists leaderboard_eligible boolean not null default false;

-- Compact public code shown below the username. The unique index makes the
-- displayed code unique, rather than merely a truncated UUID prefix.
alter table public.player_profiles
  add column if not exists public_code text;

update public.player_profiles
  set public_code = upper(substr(replace(public_player_id::text, '-', ''), 1, 12))
  where public_code is null;

alter table public.player_profiles
  alter column public_code set not null;

create unique index if not exists player_profiles_public_code_key
  on public.player_profiles (public_code);

update public.player_profiles
  set leaderboard_eligible = true
  where leaderboard_eligible = false
    and display_name is distinct from '玩家';

-- Derive eligibility from the username in the database. The flag is not
-- trusted from browser payloads, including direct PostgREST requests.
create or replace function public.sync_leaderboard_eligibility()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.leaderboard_eligible :=
    btrim(coalesce(new.display_name, '')) <> ''
    and new.display_name is distinct from '玩家';
  return new;
end;
$$;

drop trigger if exists trg_player_profiles_leaderboard_eligibility on public.player_profiles;
create trigger trg_player_profiles_leaderboard_eligibility
  before insert or update on public.player_profiles
  for each row execute function public.sync_leaderboard_eligibility();

-- The browser only needs to update the display name. Public ids, the short
-- code and the derived eligibility flag are not client-writable.
revoke update on public.player_profiles from authenticated;
grant update (display_name) on public.player_profiles to authenticated;

-- RLS: owner insert policy for leaderboard_entries must also verify the
-- profile is eligible (authenticated anon-key path).
drop policy if exists "leaderboard_entries_owner_insert" on public.leaderboard_entries;

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
      and pp.leaderboard_eligible = true
      and pil.auth_user_id = auth.uid()
  ));

-- Hide legacy entries from the public API as well as from the client-side
-- projection. They remain available for internal analytics.
drop policy if exists "leaderboard_entries_public_select" on public.leaderboard_entries;
create policy "leaderboard_entries_public_select"
  on public.leaderboard_entries
  for select
  to anon, authenticated
  using (exists (
    select 1 from public.player_profiles pp
    where pp.public_player_id = leaderboard_entries.public_player_id
      and pp.leaderboard_eligible = true
      and btrim(pp.display_name) <> ''
  ));

-- Trigger: hard gate that applies to every insert path (including
-- service_role / direct SQL), independent of RLS.
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
  ) then
    raise exception 'leaderboard entry requires an eligible profile with a username set';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leaderboard_entries_eligibility on public.leaderboard_entries;
create trigger trg_leaderboard_entries_eligibility
  before insert on public.leaderboard_entries
  for each row execute function public.block_ineligible_leaderboard_entry();

revoke all on function public.block_ineligible_leaderboard_entry() from public;
