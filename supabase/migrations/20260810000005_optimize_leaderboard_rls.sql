-- Keep the leaderboard owner policy from re-evaluating auth.uid() per row.
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
      and pil.auth_user_id = (select auth.uid())
  ));
