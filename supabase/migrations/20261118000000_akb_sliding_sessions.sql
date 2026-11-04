-- Members stay signed in while they use their account (owner, 2026-11-03).
--
-- A session lasted 30 days from signing in, however often it was used. Now
-- each use (noted at most every 5 minutes, as last_seen_at already was) moves
-- its end to 30 days from then, never more than a year after signing in (the
-- site renews the cookie the same way: proxy.ts). Unused for 30 days, it ends
-- as before. Safe to run again.

begin;

create or replace function public.akb_member_session_client(p_session_hash text)
returns uuid language plpgsql set search_path = public as $$
declare
  s record;
begin
  select * into s from public.akb_member_sessions
    where session_hash = p_session_hash and ended_at is null and expires_at > now();
  if not found then return null; end if;
  if not public.akb_can_sign_in(s.client_id) then
    update public.akb_member_sessions set ended_at = now(), ended_reason = 'no_membership' where id = s.id;
    return null;
  end if;
  if s.last_seen_at < now() - interval '5 minutes' then
    update public.akb_member_sessions
      set last_seen_at = now(),
          expires_at = greatest(expires_at, least(now() + interval '30 days', created_at + interval '365 days'))
      where id = s.id;
  end if;
  return s.client_id;
end $$;

notify pgrst, 'reload schema';

commit;
