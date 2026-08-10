-- Keep the public Jiazi ID immutable even when a player uses the publishable key.
create or replace function public.prevent_public_player_id_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.public_player_id is distinct from old.public_player_id then
    raise exception 'public_player_id is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_player_profiles_immutable_public_id on public.player_profiles;
create trigger trg_player_profiles_immutable_public_id
  before update of public_player_id on public.player_profiles
  for each row execute function public.prevent_public_player_id_change();

revoke all on function public.prevent_public_player_id_change() from public;

-- A session can produce at most one leaderboard result. This makes retries
-- idempotent and prevents duplicate rows from inflating the public ranking.
create unique index if not exists leaderboard_entries_session_id_unique_idx
  on public.leaderboard_entries (session_id);
