-- Edge Functions use the service_role PostgREST client to access the
-- recovery tables. The schema is exposed at the API router level, but the
-- existing grants intentionally keep it inaccessible to anon/authenticated.
alter role authenticator set pgrst.db_schemas = 'public,graphql_public,private';

notify pgrst, 'reload config';
