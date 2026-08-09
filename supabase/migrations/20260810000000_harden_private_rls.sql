-- Private identity material is service-role-only. Enable RLS as a second
-- defense layer even though anon/authenticated have no grants on this schema.
alter table private.recovery_secrets enable row level security;
alter table private.recovery_attempts enable row level security;
