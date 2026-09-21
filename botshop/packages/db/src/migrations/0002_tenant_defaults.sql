-- Tenant-scoped inserts default to the caller's tenant context.
--
-- This removes a whole class of bug: a forgotten `tenant_id` column no longer inserts NULL
-- (which the NOT NULL constraint killed with a confusing error) — it fills in `app.current_tenant()`
-- and is still verified by the RLS WITH CHECK policy. Outside a tenant transaction the default
-- is NULL, so the insert fails loudly instead of creating an orphan row.

alter table users alter column tenant_id set default app.current_tenant();
alter table sessions alter column tenant_id set default app.current_tenant();
alter table shops alter column tenant_id set default app.current_tenant();
alter table bots alter column tenant_id set default app.current_tenant();
alter table customers alter column tenant_id set default app.current_tenant();
alter table telegram_updates alter column tenant_id set default app.current_tenant();
alter table outbound_messages alter column tenant_id set default app.current_tenant();
alter table domain_events alter column tenant_id set default app.current_tenant();
