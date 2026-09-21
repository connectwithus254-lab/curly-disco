-- CSRF hardening for embedded / reverse-proxied deployments.
--
-- Problem observed in practice: the panel is sometimes served through an iframe or a proxy that
-- rewrites Host, and some browsers/privacy modes drop the `bs_csrf` cookie while still sending the
-- session cookie. The old double-submit check then rejected *legitimate* panel requests with
-- "CSRF check failed" (and could not be recovered from without a reload).
--
-- Fix: bind a CSRF token to the session itself. A mutation is accepted when EITHER
--   (a) the double-submit cookie matches the X-CSRF-Token header, OR
--   (b) the header token hashes to the CSRF token issued with the authenticated session, OR
--   (c) the request is same-site (Origin host equals the host we were reached on).
-- Cross-site form posts have none of these: they cannot set a header, carry the attacker's Origin,
-- and SameSite=Lax keeps the session cookie out of cross-site POSTs.

alter table sessions add column if not exists csrf_token_hash text not null default '';
create index if not exists sessions_expires_idx on sessions (expires_at);

-- Return type changes, so the function must be replaced rather than altered.
drop function if exists app.authenticate_session(text);

create function app.authenticate_session(p_token_hash text)
returns table (
  session_id uuid,
  user_id uuid,
  tenant_id uuid,
  role text,
  email text,
  tenant_status text,
  user_status text,
  csrf_token_hash text
)
  language sql security definer set search_path = public, pg_temp as $$
    select s.id, u.id, u.tenant_id, u.role, u.email, t.status, u.status, s.csrf_token_hash
    from sessions s
    join users u on u.id = s.user_id
    join tenants t on t.id = u.tenant_id
    where s.token_hash = p_token_hash
      and s.expires_at > now()
  $$;

grant execute on function app.authenticate_session(text) to botshop_app;
