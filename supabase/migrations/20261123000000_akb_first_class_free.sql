-- First class free (Alex, 2026-11-05).
--
-- A new customer's first group class is free: no card, nothing to pay, booked
-- straight away. One per person, by email address (the same client record the
-- paid booking uses). "New" means the person has never had a place on a class
-- (booked, attended or no-show; an unpaid hold that lapsed doesn't count), has
-- never had a membership, and hasn't already used the offer.
--
-- 1. akb_class_bookings.first_class_free marks the free booking;
--    free_class_spent marks one cancelled less than 24 hours before (used).
-- 2. akb_first_class_free_eligible(client) says whether the offer applies.
-- 3. akb_create_free_first_class_booking(...) books it if it applies, inside
--    one transaction with the client row locked, so two quick submissions
--    can't both be free. Returns {eligible: false} otherwise (the site then
--    sends the person to pay as usual).
-- 4. Cancelling a free class gives no class credit (unlike a paid one): in
--    time, the offer simply comes back to be booked on another date; late,
--    it is used. The cancel pages and the account say so.
-- Safe to run again.

begin;

alter table public.akb_class_bookings add column if not exists first_class_free boolean not null default false;
alter table public.akb_class_bookings add column if not exists free_class_spent boolean not null default false;

create or replace function public.akb_first_class_free_eligible(p_client uuid)
returns boolean language sql stable set search_path = public as $$
  select not exists (
      select 1 from public.akb_class_attendance a
      where a.client_id = p_client
        and (a.status in ('attended', 'no_show') or (a.status = 'booked' and a.hold_expires_at is null) or a.late_cancel))
    and not exists (select 1 from public.akb_memberships m where m.client_id = p_client)
    and not exists (
      select 1 from public.akb_class_bookings k
      where k.client_id = p_client and k.first_class_free and (k.status <> 'cancelled' or k.free_class_spent));
$$;

-- Books a free first class if it applies. Same checks as a paid booking
-- (class started, already booked, full, cancelled), but confirmed at once with
-- no charge. Returns {eligible, booking_id, status}.
create or replace function public.akb_create_free_first_class_booking(
  p_name text, p_email text, p_phone text,
  p_slot text, p_date date, p_starts_at timestamptz, p_duration integer,
  p_idempotency_key text
) returns jsonb language plpgsql set search_path = public as $$
declare
  k record;
  cid uuid;
  sid uuid;
  att record;
  aid uuid;
  bid uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  select * into k from public.akb_class_bookings where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('eligible', k.first_class_free, 'booking_id', k.id, 'charge_id', k.charge_id, 'status', k.status);
  end if;
  if p_starts_at <= now() then raise exception 'akb:class_started' using errcode = 'P0001'; end if;
  if v_email = '' then raise exception 'akb:invalid_email' using errcode = 'P0001'; end if;
  perform public.akb_release_class_holds();

  select c.id into cid from public.akb_clients c where lower(c.email) = v_email for update;
  if cid is null then
    insert into public.akb_clients (full_name, email, phone, status)
      values (left(btrim(p_name), 100), v_email, left(btrim(coalesce(p_phone, '')), 30), 'lead')
      returning id into cid;
  elsif not public.akb_first_class_free_eligible(cid) then
    return jsonb_build_object('eligible', false);
  end if;

  sid := public.akb_ensure_class_session(p_slot, p_date, p_starts_at, p_duration);
  select * into att from public.akb_class_attendance where class_session_id = sid and client_id = cid for update;
  if found and att.status in ('booked', 'attended') and (att.hold_expires_at is null or att.hold_expires_at > now()) then
    raise exception 'akb:already_booked' using errcode = 'P0001';
  end if;
  -- The triggers check capacity (class_full) and cancelled classes (class_cancelled).
  if found then
    update public.akb_class_attendance
      set status = 'booked', membership_period_id = null, late_cancel = false, hold_expires_at = null, updated_at = now()
      where id = att.id;
    aid := att.id;
  else
    insert into public.akb_class_attendance (class_session_id, client_id) values (sid, cid) returning id into aid;
  end if;

  insert into public.akb_class_bookings (client_id, attendance_id, status, idempotency_key, first_class_free)
    values (cid, aid, 'confirmed', p_idempotency_key, true) returning id into bid;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (cid, 'class_booking', bid, 'created',
            jsonb_build_object('class_date', p_date, 'slot', p_slot, 'first_class_free', true));
  return jsonb_build_object('eligible', true, 'booking_id', bid, 'charge_id', null, 'status', 'confirmed');
end $$;

create or replace function public.akb_class_booking_by_token(p_token_hash text)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'booking_id', k.id, 'status', k.status, 'place_status', a.status,
    'slot', s.slot, 'class_date', s.class_date, 'starts_at', s.starts_at,
    'class_cancelled', s.cancelled_at is not null,
    'can_cancel', k.status = 'confirmed' and a.status = 'booked' and s.starts_at > now(),
    'refunded', public.akb_class_booking_refunded(k.id),
    'first_class_free', k.first_class_free,
    -- A free first class gives no class credit: cancelled in time, it can simply be booked again.
    'credit_back_if_cancelled', s.starts_at - now() >= interval '24 hours' and not public.akb_class_booking_refunded(k.id) and not k.first_class_free)
  from public.akb_class_bookings k
  join public.akb_class_attendance a on a.id = k.attendance_id
  join public.akb_class_sessions s on s.id = a.class_session_id
  where k.manage_token_hash = p_token_hash;
$$;

create or replace function public.akb_cancel_class_booking(p_token_hash text, p_credit_token_hash text)
returns jsonb language plpgsql set search_path = public as $$
declare
  k record;
  starts timestamptz;
  in_time boolean;
  refunded boolean;
begin
  select b.*, a.status as place_status into k from public.akb_class_bookings b
    join public.akb_class_attendance a on a.id = b.attendance_id
    where b.manage_token_hash = p_token_hash for update of b;
  if not found then raise exception 'akb:not_found' using errcode = 'P0001'; end if;
  if k.status <> 'confirmed' or k.place_status <> 'booked' then raise exception 'akb:not_booked' using errcode = 'P0001'; end if;
  select s.starts_at into starts from public.akb_class_attendance a join public.akb_class_sessions s on s.id = a.class_session_id where a.id = k.attendance_id;
  if starts <= now() then raise exception 'akb:class_started' using errcode = 'P0001'; end if;
  in_time := starts - now() >= interval '24 hours';
  refunded := public.akb_class_booking_refunded(k.id);
  -- A free first class: no class credit (it can be booked again when cancelled in time); cancelled late, it is used.
  if k.first_class_free then
    update public.akb_class_attendance set status = 'cancelled', updated_at = now() where id = k.attendance_id;
    update public.akb_class_bookings set status = 'cancelled', free_class_spent = not in_time, updated_at = now() where id = k.id;
    insert into public.akb_events (client_id, entity, entity_id, action, detail)
      values (k.client_id, 'class_booking', k.id, 'cancelled_by_booker', jsonb_build_object('credit', false, 'refunded', false, 'first_class_free', true, 'in_time', in_time));
    return jsonb_build_object('credit', false, 'refunded', false, 'first_class_free', true, 'free_class_back', in_time);
  end if;
  update public.akb_class_attendance set status = 'cancelled', updated_at = now() where id = k.attendance_id;
  update public.akb_class_bookings set status = 'cancelled', updated_at = now() where id = k.id;
  if in_time and not refunded then
    insert into public.akb_class_credits (client_id, source_booking_id, expires_on, token_hash)
      values (k.client_id, k.id, public.akb_london_today() + 28, p_credit_token_hash);
  end if;
  if refunded then perform public.akb_void_charge(k.charge_id, 'Class cancelled and refunded'); end if;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (k.client_id, 'class_booking', k.id, 'cancelled_by_booker', jsonb_build_object('credit', in_time and not refunded, 'refunded', refunded));
  return jsonb_build_object('credit', in_time and not refunded, 'refunded', refunded);
end $$;

create or replace function public.akb_member_cancel_booking(p_client uuid, p_attendance uuid, p_credit_token_hash text)
returns jsonb language plpgsql set search_path = public as $$
declare
  k record;
  in_time boolean;
  refunded boolean;
begin
  select b.*, a.status as place_status, s.starts_at into k from public.akb_class_bookings b
    join public.akb_class_attendance a on a.id = b.attendance_id
    join public.akb_class_sessions s on s.id = a.class_session_id
    where b.attendance_id = p_attendance and b.client_id = p_client and a.client_id = p_client
    order by b.created_at desc limit 1
    for update of b;
  if not found then raise exception 'akb:not_found' using errcode = 'P0001'; end if;
  if k.status <> 'confirmed' or k.place_status <> 'booked' then raise exception 'akb:not_booked' using errcode = 'P0001'; end if;
  if k.starts_at <= now() then raise exception 'akb:class_started' using errcode = 'P0001'; end if;
  in_time := k.starts_at - now() >= interval '24 hours';
  refunded := public.akb_class_booking_refunded(k.id);
  -- A free first class: no class credit (it can be booked again when cancelled in time); cancelled late, it is used.
  if k.first_class_free then
    update public.akb_class_attendance set status = 'cancelled', updated_at = now() where id = k.attendance_id;
    update public.akb_class_bookings set status = 'cancelled', free_class_spent = not in_time, updated_at = now() where id = k.id;
    insert into public.akb_events (client_id, entity, entity_id, action, detail)
      values (k.client_id, 'class_booking', k.id, 'cancelled_by_member', jsonb_build_object('credit', false, 'refunded', false, 'first_class_free', true, 'in_time', in_time));
    return jsonb_build_object('credit', false, 'refunded', false, 'first_class_free', true, 'free_class_back', in_time);
  end if;
  update public.akb_class_attendance set status = 'cancelled', updated_at = now() where id = k.attendance_id;
  update public.akb_class_bookings set status = 'cancelled', updated_at = now() where id = k.id;
  if in_time and not refunded then
    insert into public.akb_class_credits (client_id, source_booking_id, expires_on, token_hash)
      values (k.client_id, k.id, public.akb_london_today() + 28, p_credit_token_hash);
  end if;
  if refunded then perform public.akb_void_charge(k.charge_id, 'Class cancelled and refunded'); end if;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (k.client_id, 'class_booking', k.id, 'cancelled_by_member', jsonb_build_object('credit', in_time and not refunded, 'refunded', refunded));
  return jsonb_build_object('credit', in_time and not refunded, 'refunded', refunded);
end $$;

create or replace function public.akb_member_overview(p_client uuid)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  today date := public.akb_london_today();
  c record;
  m record;
  has_m boolean;
  period jsonb;
begin
  select full_name, email, phone into c from public.akb_clients where id = p_client;
  select * into m from public.akb_memberships
    where client_id = p_client order by (status in ('active', 'paused')) desc, start_on desc limit 1;
  has_m := found;
  if has_m then
    select jsonb_build_object('start', b.period_start, 'end', b.period_end, 'credits', b.credits,
                              'used', b.credits_used, 'left', b.credits_left) into period
      from public.akb_membership_period_balances b
      where b.membership_id = m.id and today between b.period_start and b.period_end;
  end if;
  return jsonb_build_object(
    'client', jsonb_build_object('name', c.full_name, 'email', c.email, 'phone', c.phone),
    'membership', case when not has_m then null else jsonb_build_object(
      'plan', m.plan, 'plan_name', m.plan_name, 'status', m.status, 'price_pence', m.price_pence,
      'credits', m.credits, 'start_on', m.start_on, 'cancelled_on', m.cancelled_on,
      -- Renews on this date while active; null when paused or cancelled.
      'renews_on', case when m.status = 'active' then m.next_period_on end) end,
    'period', period,
    'places', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'class_date', s.class_date, 'starts_at', s.starts_at, 'slot', s.slot,
        'status', a.status, 'late_cancel', a.late_cancel, 'with_credit', a.membership_period_id is not null,
        'how', case when a.membership_period_id is not null then 'credit'
                    when k.id is not null and k.first_class_free then 'free'
                    when k.id is not null and k.charge_id is not null then 'paid'
                    when k.id is not null then 'class_credit'
                    else 'other' end,
        'class_cancelled', s.cancelled_at is not null,
        'can_cancel', a.status = 'booked' and s.starts_at > now()
                      and (a.membership_period_id is not null or k.status = 'confirmed'),
        -- A paid place already refunded in full gets nothing more back if cancelled.
        'refunded', k.id is not null and public.akb_class_booking_refunded(k.id),
        'credit_back_if_cancelled', s.starts_at - now() >= interval '24 hours'
                                    and not (k.id is not null and public.akb_class_booking_refunded(k.id))
                                    and not coalesce(k.first_class_free, false))
        order by s.starts_at)
      from public.akb_class_attendance a
      join public.akb_class_sessions s on s.id = a.class_session_id
      -- The booking that made this place, if it was booked online (the latest one: a place can be re-booked).
      left join lateral (select b.id, b.charge_id, b.status, b.first_class_free from public.akb_class_bookings b
                         where b.attendance_id = a.id order by b.created_at desc limit 1) k on true
      where a.client_id = p_client and s.class_date >= today - 28 and a.hold_expires_at is null), '[]'::jsonb),
    'class_credits', coalesce((
      select jsonb_agg(jsonb_build_object('id', cr.id, 'expires_on', cr.expires_on) order by cr.expires_on)
      from public.akb_class_credits cr
      where cr.client_id = p_client and cr.used_booking_id is null and cr.expires_on >= today), '[]'::jsonb),
    -- Classes paid for singly online in the 4 weeks around today (14 days back, 13 ahead), still booked or attended.
    'paid_classes_28d', (
      select count(*) from public.akb_class_bookings k
      join public.akb_class_attendance a on a.id = k.attendance_id
      join public.akb_class_sessions s on s.id = a.class_session_id
      where k.client_id = p_client and k.charge_id is not null and k.status = 'confirmed'
        and a.status in ('booked', 'attended') and s.class_date between today - 14 and today + 13));
end $$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('akb_first_class_free_eligible', 'akb_create_free_first_class_booking')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
