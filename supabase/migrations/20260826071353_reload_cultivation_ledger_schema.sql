-- The ledger table is queried by both Edge Functions and the authenticated
-- client. Refresh PostgREST's schema cache so the newly created public table
-- is immediately visible after the paired migration is applied.
notify pgrst, 'reload schema';
