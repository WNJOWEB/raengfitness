-- A sign-in code in the sign-in email, beside the link (owner, 2026-11-03).
--
-- iPhone mail apps open links in their own browser, so a member signed in by
-- the link ends up signed in there, not in Safari. The same email now carries
-- a 6-digit code, typed on the sign-in page in the browser they're using.
-- One code per link (the same row): using either uses both. Only the code's
-- SHA-256 is stored. Like the link it works once, for 15 minutes; after 5
-- wrong codes in 15 minutes no code is accepted for that person until a new
-- email is asked for later (5 emails an hour at most, as before).
-- Safe to run again.

begin;

alter table public.akb_member_login_links
  add column if not exists code_hash text check (code_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists code_attempts integer not null default 0 check (code_attempts >= 0);

-- The link, as akb_member_create_login_link makes it, plus the code. Returns
-- whether an email should go (false for an unknown address or too many asks).
create or replace function public.akb_member_create_sign_in(p_email text, p_token_hash text, p_code_hash text)
returns boolean language plpgsql set search_path = public as $$
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'akb:invalid_code' using errcode = 'P0001'; end if;
  if not public.akb_member_create_login_link(p_email, p_token_hash) then return false; end if;
  update public.akb_member_login_links set code_hash = p_code_hash where token_hash = p_token_hash;
  return true;
end $$;

-- Signs in with the code from the email: the person's newest unused, unexpired
-- link whose code matches. A wrong code counts against the newest link. Returns
-- the client id, or null (wrong, expired, used, too many tries or no account:
-- the caller says the same thing for all of them).
create or replace function public.akb_member_redeem_login_code(p_email text, p_code_hash text, p_session_hash text)
returns uuid language plpgsql set search_path = public as $$
declare
  cid uuid;
  tries integer;
  hit uuid;
begin
  select c.id into cid from public.akb_clients c
    where c.email <> '' and lower(c.email) = lower(btrim(p_email));
  if cid is null then return null; end if;
  select coalesce(sum(code_attempts), 0) into tries from public.akb_member_login_links
    where client_id = cid and created_at > now() - interval '15 minutes';
  if tries >= 5 then return null; end if;
  update public.akb_member_login_links set used_at = now()
    where id = (select id from public.akb_member_login_links
                where client_id = cid and code_hash = p_code_hash and used_at is null and expires_at > now()
                order by created_at desc limit 1)
    returning id into hit;
  if hit is null then
    update public.akb_member_login_links set code_attempts = code_attempts + 1
      where id = (select id from public.akb_member_login_links
                  where client_id = cid and used_at is null and expires_at > now()
                  order by created_at desc limit 1);
    return null;
  end if;
  if not public.akb_can_sign_in(cid) then return null; end if;
  insert into public.akb_member_sessions (client_id, session_hash, expires_at)
    values (cid, p_session_hash, now() + interval '30 days');
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (cid, 'member_session', null, 'signed_in', '{"with": "code"}'::jsonb);
  return cid;
end $$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('akb_member_create_sign_in', 'akb_member_redeem_login_code')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
