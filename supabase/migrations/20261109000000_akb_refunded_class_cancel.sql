-- A class refunded in Stripe before the member cancels it.
--
-- 20261108000000 handled a refund after cancelling (credit withdrawn, fee
-- cancelled). This handles the other order: once a paid online class booking
-- has been refunded in full, cancelling it gives no class credit (the money is
-- already back) and cancels the class fee (nothing is owed for a class not
-- taken). What each cancel page promises beforehand says the same: both the
-- private link and the account show `refunded` and no credit back.
-- Safe to run again.

begin;

-- Whether a paid online class booking's card payment has been refunded in full.
create or replace function public.akb_class_booking_refunded(p_booking uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.akb_class_bookings k
    join public.akb_square_payment_links l on l.charge_id = k.charge_id and l.paid_payment_id is not null
    join public.akb_payments p on p.id = l.paid_payment_id
    where k.id = p_booking and p.status = 'received' and p.amount_pence > 0
      and (select coalesce(sum(r.amount_pence), 0) from public.akb_refunds r where r.payment_id = p.id) >= p.amount_pence);
$$;

-- What the booking's private link shows (no personal details beyond the class).
create or replace function public.akb_class_booking_by_token(p_token_hash text)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'booking_id', k.id, 'status', k.status, 'place_status', a.status,
    'slot', s.slot, 'class_date', s.class_date, 'starts_at', s.starts_at,
    'class_cancelled', s.cancelled_at is not null,
    'can_cancel', k.status = 'confirmed' and a.status = 'booked' and s.starts_at > now(),
    'refunded', public.akb_class_booking_refunded(k.id),
    'credit_back_if_cancelled', s.starts_at - now() >= interval '24 hours' and not public.akb_class_booking_refunded(k.id))
  from public.akb_class_bookings k
  join public.akb_class_attendance a on a.id = k.attendance_id
  join public.akb_class_sessions s on s.id = a.class_session_id
  where k.manage_token_hash = p_token_hash;
$$;

-- Cancels a confirmed booking by its private link. Returns {credit, refunded}:
-- a credit (p_credit_token_hash, valid for 28 days) when it was 24 hours or
-- more before the class and the payment hasn't been refunded; a refunded
-- booking's fee is cancelled instead.
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

-- Cancels one of the client's own online bookings, by its place. Same rules
-- as the emailed link (akb_cancel_class_booking). Returns {credit, refunded}.
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

-- The account page: as before, plus `refunded` on each place.
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
                    when k.id is not null and k.charge_id is not null then 'paid'
                    when k.id is not null then 'class_credit'
                    else 'other' end,
        'class_cancelled', s.cancelled_at is not null,
        'can_cancel', a.status = 'booked' and s.starts_at > now()
                      and (a.membership_period_id is not null or k.status = 'confirmed'),
        -- A paid place already refunded in full gets nothing more back if cancelled.
        'refunded', k.id is not null and public.akb_class_booking_refunded(k.id),
        'credit_back_if_cancelled', s.starts_at - now() >= interval '24 hours'
                                    and not (k.id is not null and public.akb_class_booking_refunded(k.id)))
        order by s.starts_at)
      from public.akb_class_attendance a
      join public.akb_class_sessions s on s.id = a.class_session_id
      -- The booking that made this place, if it was booked online (the latest one: a place can be re-booked).
      left join lateral (select b.id, b.charge_id, b.status from public.akb_class_bookings b
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

-- create or replace keeps existing grants; the new helper is server only too.
revoke all on function public.akb_class_booking_refunded(uuid) from public, anon, authenticated;
grant execute on function public.akb_class_booking_refunded(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
