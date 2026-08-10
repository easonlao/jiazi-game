-- Keep the append-only trigger function from inheriting a caller-controlled
-- search_path.
alter function public.block_game_events_mutation()
  set search_path = pg_catalog, public;
