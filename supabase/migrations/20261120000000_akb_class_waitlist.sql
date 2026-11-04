-- A waitlist for full classes (owner, 2026-11-04).
--
-- How it works (the rules are here, so they can be changed in one place):
-- - Anyone can join the waitlist of a class that is FULL (a class with a free
--   place is just booked). A signed-in member joins from their account; anyone
--   else with their name, email and phone. One place in the queue per person
--   per class; at most 30 waiting per class.
-- - When a place frees (a booking cancelled, a hold that ran out, a coach
--   removing someone, the class made bigger) the next people in the queue, as
--   many as there are free places, are OFFERED it and emailed. Places are NOT
--   held: they go to whoever books first, so the email says to book soon.
-- - An offer nobody took within 24 hours lapses (expired), and the next
--   person is offered it. Booking the class, leaving, or Alex removing
--   someone ends their wait. A class that is cancelled or has started ends
--   every wait for it.
-- Personal details are erased with the rest of a client's (akb_erase_client).
-- Server only. Safe to run again.

begin;

create table if not exists public.akb_class_waitlist (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  class_session_id uuid not null references public.akb_class_sessions (id) on delete cascade,
  client_id uuid not null references public.akb_clients (id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'booked', 'left', 'removed', 'expired')),
  offered_at timestamptz,
  -- When the "a place has opened" email went out for the current offer.
  notified_at timestamptz,
  -- SHA-256 of the private "leave the waitlist" link emailed when they joined.
  leave_token_hash text unique check (leave_token_hash ~ '^[0-9a-f]{64}$'),
  unique (class_session_id, client_id)
);
create index if not exists akb_class_waitlist_queue_idx on public.akb_class_waitlist (class_session_id, status, created_at);
create index if not exists akb_class_waitlist_client_idx on public.akb_class_waitlist (client_id);
alter table public.akb_class_waitlist enable row level security;
revoke all on public.akb_class_waitlist from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Offering freed places
-- ---------------------------------------------------------------------------

-- Offers the next waiting people as many places as are free (not counting
-- offers already out). Returns how many were newly offered.
create or replace function public.akb_waitlist_offer(p_session uuid)
returns integer language plpgsql set search_path = public as $$
declare
  s record;
  cap integer;
  taken integer;
  open_offers integer;
  free integer;
  n integer := 0;
begin
  select * into s from public.akb_class_sessions where id = p_session for update;
  if not found then return 0; end if;
  if s.cancelled_at is not null or s.starts_at <= now() then
    update public.akb_class_waitlist set status = 'expired', updated_at = now()
      where class_session_id = p_session and status in ('waiting', 'offered');
    return 0;
  end if;
  update public.akb_class_waitlist set status = 'expired', updated_at = now()
    where class_session_id = p_session and status = 'offered' and offered_at < now() - interval '24 hours';
  cap := coalesce(s.capacity, public.akb_slot_capacity(s.slot));
  select count(*) into taken from public.akb_class_attendance a
    where a.class_session_id = p_session and a.status in ('booked', 'attended') and (a.hold_expires_at is null or a.hold_expires_at > now());
  select count(*) into open_offers from public.akb_class_waitlist where class_session_id = p_session and status = 'offered';
  free := cap - taken - open_offers;
  if free <= 0 then return 0; end if;
  with next as (
    select id from public.akb_class_waitlist where class_session_id = p_session and status = 'waiting'
      order by created_at limit free for update
  )
  update public.akb_class_waitlist w set status = 'offered', offered_at = now(), notified_at = null, updated_at = now()
    from next where w.id = next.id;
  get diagnostics n = row_count;
  return n;
end $$;

-- Offers on every upcoming class that has people waiting (the daily job, and after a class size changes).
create or replace function public.akb_waitlist_refresh()
returns integer language plpgsql set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in select distinct class_session_id from public.akb_class_waitlist where status in ('waiting', 'offered') loop
    n := n + public.akb_waitlist_offer(r.class_session_id);
  end loop;
  return n;
end $$;

create or replace function public.akb_waitlist_on_attendance() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('booked', 'attended') then perform public.akb_waitlist_offer(old.class_session_id); end if;
    return null;
  end if;
  -- Someone on the list now has the place (or is paying for it): their wait is over.
  if new.status in ('booked', 'attended') and (new.hold_expires_at is null or new.hold_expires_at > now()) then
    update public.akb_class_waitlist set status = 'booked', updated_at = now()
      where class_session_id = new.class_session_id and client_id = new.client_id and status in ('waiting', 'offered');
  end if;
  -- A place came free.
  if tg_op = 'UPDATE' and old.status in ('booked', 'attended') and new.status not in ('booked', 'attended') then
    perform public.akb_waitlist_offer(new.class_session_id);
  end if;
  return null;
end $$;

drop trigger if exists akb_class_attendance_waitlist on public.akb_class_attendance;
create trigger akb_class_attendance_waitlist
  after insert or update of status or delete on public.akb_class_attendance
  for each row execute function public.akb_waitlist_on_attendance();

create or replace function public.akb_waitlist_on_session() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.cancelled_at is not null and old.cancelled_at is null then
    update public.akb_class_waitlist set status = 'expired', updated_at = now()
      where class_session_id = new.id and status in ('waiting', 'offered');
  elsif new.capacity is distinct from old.capacity then
    perform public.akb_waitlist_offer(new.id);
  end if;
  return null;
end $$;

drop trigger if exists akb_class_sessions_waitlist on public.akb_class_sessions;
create trigger akb_class_sessions_waitlist
  after update of capacity, cancelled_at on public.akb_class_sessions
  for each row execute function public.akb_waitlist_on_session();

-- ---------------------------------------------------------------------------
-- Joining and leaving
-- ---------------------------------------------------------------------------

-- The queue position of a row: 1 is next. Counts the waiting and offered people who joined before.
create or replace function public.akb_waitlist_position(p_id uuid)
returns integer language sql stable set search_path = public as $$
  select (select count(*) from public.akb_class_waitlist o
          where o.class_session_id = w.class_session_id and o.status in ('waiting', 'offered') and o.created_at < w.created_at)::integer + 1
  from public.akb_class_waitlist w where w.id = p_id;
$$;

-- Adds a client to a class's waitlist. Raises akb: class_not_found, class_cancelled, class_started,
-- not_full (it has a free place: book it), already_booked, waitlist_full. Returns
-- {status: 'joined' | 'already', position, slot, class_date, starts_at}.
create or replace function public.akb_waitlist_add(p_client uuid, p_slot text, p_date date, p_token_hash text)
returns jsonb language plpgsql set search_path = public as $$
declare
  s record;
  cap integer;
  taken integer;
  w record;
  wid uuid;
  joined boolean := true;
begin
  select * into s from public.akb_class_sessions where slot = p_slot and class_date = p_date for update;
  if not found then raise exception 'akb:class_not_found' using errcode = 'P0001'; end if;
  if s.cancelled_at is not null then raise exception 'akb:class_cancelled' using errcode = 'P0001'; end if;
  if s.starts_at <= now() then raise exception 'akb:class_started' using errcode = 'P0001'; end if;
  if p_token_hash is not null and p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'akb:invalid_token' using errcode = 'P0001'; end if;
  if exists (select 1 from public.akb_class_attendance a where a.class_session_id = s.id and a.client_id = p_client
             and a.status in ('booked', 'attended') and (a.hold_expires_at is null or a.hold_expires_at > now())) then
    raise exception 'akb:already_booked' using errcode = 'P0001';
  end if;
  cap := coalesce(s.capacity, public.akb_slot_capacity(s.slot));
  select count(*) into taken from public.akb_class_attendance a
    where a.class_session_id = s.id and a.status in ('booked', 'attended') and (a.hold_expires_at is null or a.hold_expires_at > now());

  select * into w from public.akb_class_waitlist where class_session_id = s.id and client_id = p_client;
  if found and w.status in ('waiting', 'offered') then
    wid := w.id;
    joined := false;
  else
    if taken < cap then raise exception 'akb:not_full' using errcode = 'P0001'; end if;
    if (select count(*) from public.akb_class_waitlist where class_session_id = s.id and status in ('waiting', 'offered')) >= 30 then
      raise exception 'akb:waitlist_full' using errcode = 'P0001';
    end if;
    if found then
      -- Back in the queue, at the end.
      update public.akb_class_waitlist
        set status = 'waiting', created_at = now(), updated_at = now(), offered_at = null, notified_at = null, leave_token_hash = p_token_hash
        where id = w.id;
      wid := w.id;
    else
      insert into public.akb_class_waitlist (class_session_id, client_id, leave_token_hash)
        values (s.id, p_client, p_token_hash) returning id into wid;
    end if;
    insert into public.akb_events (client_id, entity, entity_id, action, detail)
      values (p_client, 'class_waitlist', wid, 'joined', jsonb_build_object('slot', s.slot, 'class_date', s.class_date));
  end if;
  return jsonb_build_object('status', case when joined then 'joined' else 'already' end, 'id', wid,
    'position', public.akb_waitlist_position(wid), 'slot', s.slot, 'class_date', s.class_date, 'starts_at', s.starts_at);
end $$;

-- A visitor joins with their details (a client is made for a new email, as when booking).
create or replace function public.akb_waitlist_join_public(p_name text, p_email text, p_phone text, p_slot text, p_date date, p_token_hash text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  cid uuid;
begin
  if v_email = '' then raise exception 'akb:invalid_email' using errcode = 'P0001'; end if;
  select c.id into cid from public.akb_clients c where lower(c.email) = v_email for update;
  if cid is null then
    insert into public.akb_clients (full_name, email, phone, status)
      values (left(btrim(p_name), 100), v_email, left(btrim(coalesce(p_phone, '')), 30), 'lead')
      returning id into cid;
  end if;
  return public.akb_waitlist_add(cid, p_slot, p_date, p_token_hash);
end $$;

-- A signed-in member joins as themselves.
create or replace function public.akb_member_waitlist_join(p_client uuid, p_slot text, p_date date)
returns jsonb language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.akb_clients where id = p_client) then raise exception 'akb:not_found' using errcode = 'P0001'; end if;
  return public.akb_waitlist_add(p_client, p_slot, p_date, null);
end $$;

-- A member leaves from their account.
create or replace function public.akb_member_waitlist_leave(p_client uuid, p_id uuid)
returns boolean language plpgsql set search_path = public as $$
declare
  n integer;
begin
  update public.akb_class_waitlist set status = 'left', updated_at = now()
    where id = p_id and client_id = p_client and status in ('waiting', 'offered');
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.akb_events (client_id, entity, entity_id, action, detail) values (p_client, 'class_waitlist', p_id, 'left', '{}'::jsonb);
    -- An offer they leave goes to the next person.
    perform public.akb_waitlist_offer(class_session_id) from public.akb_class_waitlist where id = p_id;
  end if;
  return n > 0;
end $$;

-- Anyone leaves with the private link from their confirmation email.
create or replace function public.akb_waitlist_leave_token(p_token_hash text)
returns jsonb language plpgsql set search_path = public as $$
declare
  w record;
begin
  select * into w from public.akb_class_waitlist where leave_token_hash = p_token_hash for update;
  if not found then return null; end if;
  if w.status in ('waiting', 'offered') then
    update public.akb_class_waitlist set status = 'left', updated_at = now() where id = w.id;
    insert into public.akb_events (client_id, entity, entity_id, action, detail) values (w.client_id, 'class_waitlist', w.id, 'left', '{}'::jsonb);
    perform public.akb_waitlist_offer(w.class_session_id);
  end if;
  return (select jsonb_build_object('slot', s.slot, 'class_date', s.class_date, 'starts_at', s.starts_at, 'was_waiting', w.status in ('waiting', 'offered'))
          from public.akb_class_sessions s where s.id = w.class_session_id);
end $$;

-- A member's own waitlist entries for classes still to come.
create or replace function public.akb_member_waitlist(p_client uuid)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'status', w.status, 'slot', s.slot, 'class_date', s.class_date,
           'starts_at', s.starts_at, 'position', public.akb_waitlist_position(w.id)) order by s.starts_at), '[]'::jsonb)
  from public.akb_class_waitlist w join public.akb_class_sessions s on s.id = w.class_session_id
  where w.client_id = p_client and w.status in ('waiting', 'offered') and s.starts_at > now() and s.cancelled_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Telling people a place opened
-- ---------------------------------------------------------------------------

create or replace function public.akb_waitlist_to_notify()
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'offered_at', w.offered_at, 'name', c.full_name, 'email', c.email,
           'slot', s.slot, 'class_date', s.class_date, 'starts_at', s.starts_at, 'can_sign_in', public.akb_can_sign_in(c.id))
         order by w.offered_at), '[]'::jsonb)
  from public.akb_class_waitlist w
  join public.akb_class_sessions s on s.id = w.class_session_id
  join public.akb_clients c on c.id = w.client_id
  where w.status = 'offered' and w.notified_at is null and c.email <> '' and s.starts_at > now() and s.cancelled_at is null;
$$;

-- Marks one offer as emailed (only if it's still that offer).
create or replace function public.akb_waitlist_notified(p_id uuid, p_offered_at timestamptz)
returns void language sql set search_path = public as $$
  update public.akb_class_waitlist set notified_at = now(), updated_at = now()
    where id = p_id and status = 'offered' and offered_at = p_offered_at;
$$;

-- ---------------------------------------------------------------------------
-- The coach's view
-- ---------------------------------------------------------------------------

create or replace function public.akb_class_waitlist_list(p_session uuid)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'status', w.status, 'created_at', w.created_at, 'offered_at', w.offered_at,
           'client_id', c.id, 'name', c.full_name, 'email', c.email, 'phone', c.phone) order by w.created_at), '[]'::jsonb)
  from public.akb_class_waitlist w join public.akb_clients c on c.id = w.client_id
  where w.class_session_id = p_session and w.status in ('waiting', 'offered');
$$;

create or replace function public.akb_waitlist_remove(p_id uuid)
returns boolean language plpgsql set search_path = public as $$
declare
  w record;
begin
  update public.akb_class_waitlist set status = 'removed', updated_at = now()
    where id = p_id and status in ('waiting', 'offered') returning * into w;
  if not found then return false; end if;
  insert into public.akb_events (client_id, entity, entity_id, action, detail) values (w.client_id, 'class_waitlist', w.id, 'removed', '{}'::jsonb);
  perform public.akb_waitlist_offer(w.class_session_id);
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Erasing a client (20261117000000) also clears their waitlist entries.
-- ---------------------------------------------------------------------------

create or replace function public.akb_erase_client(p_client uuid)
returns void language plpgsql set search_path = public as $$
declare
  c record;
  subs uuid[];
begin
  select * into c from public.akb_clients where id = p_client for update;
  if not found then raise exception 'akb:not_found' using errcode = 'P0001'; end if;
  if c.erased_at is not null then return; end if;
  if exists (select 1 from public.akb_memberships where client_id = p_client and status in ('active', 'paused'))
     or exists (select 1 from public.akb_subscriptions where client_id = p_client and status in ('active', 'paused'))
     or exists (select 1 from public.akb_class_attendance a join public.akb_class_sessions s on s.id = a.class_session_id
                where a.client_id = p_client and a.status = 'booked' and s.starts_at > now())
     or exists (select 1 from public.akb_pt_sessions where client_id = p_client and status = 'scheduled' and starts_at > now()) then
    raise exception 'akb:still_active' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(id), '{}') into subs from public.akb_subscriptions where client_id = p_client;

  delete from public.akb_coaching_messages where subscription_id = any(subs);
  delete from public.akb_coaching_check_ins where subscription_id = any(subs);
  delete from public.akb_coaching_programmes where subscription_id = any(subs);
  delete from public.akb_check_ins where subscription_id = any(subs);

  delete from public.akb_class_waitlist where client_id = p_client;
  delete from public.akb_member_sessions where client_id = p_client;
  delete from public.akb_member_login_links where client_id = p_client;
  delete from public.akb_member_settings where client_id = p_client;
  delete from public.akb_member_calendar_feeds where client_id = p_client;
  delete from public.akb_email_changes where client_id = p_client;
  delete from public.akb_client_consents where client_id = p_client;
  delete from public.akb_follow_ups where client_id = p_client;
  delete from public.akb_class_credits where client_id = p_client and used_booking_id is null;

  update public.akb_class_attendance set notes = '' where client_id = p_client and notes <> '';
  update public.akb_pt_sessions set notes = '', requested = '' where client_id = p_client;
  update public.akb_packages set notes = '' where client_id = p_client and notes <> '';
  update public.akb_memberships set notes = '' where client_id = p_client and notes <> '';
  update public.akb_subscriptions set notes = '' where client_id = p_client and notes <> '';
  update public.akb_booking_requests
    set name = 'Deleted client', email = '', phone = '', message = '', details = '{}'::jsonb,
        decision_note = '', alert_subject = '', alert_text = '', alert_error = ''
    where client_id = p_client or (c.email <> '' and lower(email) = lower(c.email));

  update public.akb_clients
    set full_name = 'Deleted client', email = '', phone = '', instagram = '', preferred_contact = '', notes = '',
        status = 'former', erased_at = now(), updated_at = now()
    where id = p_client;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (p_client, 'client', p_client, 'erased', '{}'::jsonb);
end $$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'akb_waitlist_offer', 'akb_waitlist_refresh', 'akb_waitlist_on_attendance', 'akb_waitlist_on_session',
      'akb_waitlist_position', 'akb_waitlist_add', 'akb_waitlist_join_public', 'akb_member_waitlist_join',
      'akb_member_waitlist_leave', 'akb_waitlist_leave_token', 'akb_member_waitlist',
      'akb_waitlist_to_notify', 'akb_waitlist_notified', 'akb_class_waitlist_list', 'akb_waitlist_remove', 'akb_erase_client')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
