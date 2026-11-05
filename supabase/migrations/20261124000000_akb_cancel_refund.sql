-- Cancelling 24 hours or more before gives everything back (Alex, 2026-11-05).
--
-- The general rule for every group class: cancel with at least 24 hours'
-- notice and you get back what you used. A membership credit comes back (as
-- before), a free first class can be booked again (as before), a class paid
-- with a class credit gets that credit back (as before), and a class paid for
-- by card is now refunded in full instead of earning a class credit.
-- Later than 24 hours, or not turning up: nothing back (unchanged).
--
-- 1. akb_class_bookings.refund_due marks a paid booking cancelled in time.
--    The site then asks Stripe for the refund (idempotency key per booking)
--    and records it with akb_class_refund_mark; the refund itself arrives in
--    akb_refunds through the usual signed webhook / reconcile, which also
--    cancels the class fee once it is all back (akb_apply_square_refund).
--    A refund Stripe refuses is retried by the daily job and Alex is told
--    once; a payment Alex recorded by hand (cash, transfer) is his to refund,
--    and he is told.
-- 2. akb_cancel_class_booking / akb_member_cancel_booking: in time, a paid
--    booking gets refund_due (no class credit). Everything else unchanged.
-- 3. akb_class_booking_by_token says whether the booking was paid, so the
--    cancel page can say "refunded" instead of "class credit".
-- Class credits already given keep working until they run out.
-- Safe to run again.

begin;

alter table public.akb_class_bookings add column if not exists refund_due boolean not null default false;
-- When Stripe accepted the refund, and its id.
alter table public.akb_class_bookings add column if not exists refund_requested_at timestamptz;
alter table public.akb_class_bookings add column if not exists refund_provider_id text check (char_length(refund_provider_id) <= 200);
-- Failed tries (the daily job stops after 5) and when Alex was told it needs him.
alter table public.akb_class_bookings add column if not exists refund_attempts integer not null default 0;
alter table public.akb_class_bookings add column if not exists refund_alerted_at timestamptz;
create index if not exists akb_class_bookings_refund_due_idx on public.akb_class_bookings (created_at)
  where refund_due and refund_requested_at is null;

-- The payment behind a paid booking and how much of it is still to refund.
create or replace function public.akb_class_refund_info(p_booking uuid)
returns jsonb language sql stable set search_path = public as $$
  with k as (select * from public.akb_class_bookings where id = p_booking),
  pay as (
    select p.* from k
    join lateral (
      select coalesce(
        (select l.paid_payment_id from public.akb_square_payment_links l where l.charge_id = k.charge_id and l.paid_payment_id is not null limit 1),
        (select a.payment_id from public.akb_payment_allocations a join public.akb_payments x on x.id = a.payment_id
           where a.charge_id = k.charge_id and x.status = 'received' order by a.created_at limit 1)) as payment_id
    ) found on true
    join public.akb_payments p on p.id = found.payment_id
  )
  select jsonb_build_object(
    'booking_id', k.id, 'client_id', k.client_id,
    'due', k.refund_due, 'requested', k.refund_requested_at is not null,
    'attempts', k.refund_attempts, 'alerted', k.refund_alerted_at is not null,
    'payment_id', pay.id, 'provider', pay.provider, 'provider_payment_id', pay.provider_payment_id, 'method', pay.method,
    'remaining_pence', case when pay.id is null then 0
      else greatest(pay.amount_pence - (select coalesce(sum(r.amount_pence), 0) from public.akb_refunds r where r.payment_id = pay.id), 0) end)
  from k left join pay on true;
$$;

-- Stripe accepted the refund (p_refund_id), or the try failed (null). Returns
-- true when Alex should be told now (the first failure, or a manual payment).
create or replace function public.akb_class_refund_mark(p_booking uuid, p_refund_id text, p_manual boolean default false)
returns boolean language plpgsql set search_path = public as $$
declare
  k record;
begin
  select * into k from public.akb_class_bookings where id = p_booking for update;
  if not found or not k.refund_due then return false; end if;
  if p_refund_id is not null then
    if k.refund_requested_at is null then
      update public.akb_class_bookings set refund_requested_at = now(), refund_provider_id = left(p_refund_id, 200), updated_at = now() where id = k.id;
      insert into public.akb_events (client_id, entity, entity_id, action, detail)
        values (k.client_id, 'class_booking', k.id, 'refund_requested', jsonb_build_object('refund_id', left(p_refund_id, 200)));
    end if;
    return false;
  end if;
  update public.akb_class_bookings
    set refund_attempts = refund_attempts + case when p_manual then 0 else 1 end,
        refund_alerted_at = coalesce(refund_alerted_at, now()), updated_at = now()
    where id = k.id;
  if k.refund_alerted_at is null then
    insert into public.akb_events (client_id, entity, entity_id, action, detail)
      values (k.client_id, 'class_booking', k.id, case when p_manual then 'refund_manual' else 'refund_failed' end, '{}'::jsonb);
  end if;
  return k.refund_alerted_at is null;
end $$;

-- Paid bookings still waiting for Stripe to accept their refund (the daily job retries them).
-- A JSON array of booking ids.
create or replace function public.akb_class_refunds_due()
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(d.id order by d.created_at), '[]'::jsonb) from (
    select k.id, k.created_at from public.akb_class_bookings k
    where k.refund_due and k.refund_requested_at is null and k.refund_attempts < 5
      and not public.akb_class_booking_refunded(k.id)
    order by k.created_at limit 50) d;
$$;

create or replace function public.akb_class_booking_by_token(p_token_hash text)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'booking_id', k.id, 'status', k.status, 'place_status', a.status,
    'slot', s.slot, 'class_date', s.class_date, 'starts_at', s.starts_at,
    'class_cancelled', s.cancelled_at is not null,
    'can_cancel', k.status = 'confirmed' and a.status = 'booked' and s.starts_at > now(),
    'refunded', public.akb_class_booking_refunded(k.id),
    'first_class_free', k.first_class_free,
    -- Paid by card (or by hand): cancelled in time, it is refunded, not credited.
    'paid', k.charge_id is not null,
    'refund_due', k.refund_due,
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
  refund boolean;
  credit boolean;
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
  -- In time: a paid booking is refunded; one paid with a class credit gets a credit back.
  refund := in_time and not refunded and k.charge_id is not null;
  credit := in_time and not refunded and k.charge_id is null;
  update public.akb_class_attendance set status = 'cancelled', updated_at = now() where id = k.attendance_id;
  update public.akb_class_bookings set status = 'cancelled', refund_due = refund, updated_at = now() where id = k.id;
  if credit then
    insert into public.akb_class_credits (client_id, source_booking_id, expires_on, token_hash)
      values (k.client_id, k.id, public.akb_london_today() + 28, p_credit_token_hash);
  end if;
  if refunded then perform public.akb_void_charge(k.charge_id, 'Class cancelled and refunded'); end if;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (k.client_id, 'class_booking', k.id, 'cancelled_by_booker', jsonb_build_object('credit', credit, 'refunded', refunded, 'refund_due', refund));
  return jsonb_build_object('credit', credit, 'refunded', refunded, 'refund_due', refund, 'booking_id', k.id);
end $$;

create or replace function public.akb_member_cancel_booking(p_client uuid, p_attendance uuid, p_credit_token_hash text)
returns jsonb language plpgsql set search_path = public as $$
declare
  k record;
  in_time boolean;
  refunded boolean;
  refund boolean;
  credit boolean;
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
  -- In time: a paid booking is refunded; one paid with a class credit gets a credit back.
  refund := in_time and not refunded and k.charge_id is not null;
  credit := in_time and not refunded and k.charge_id is null;
  update public.akb_class_attendance set status = 'cancelled', updated_at = now() where id = k.attendance_id;
  update public.akb_class_bookings set status = 'cancelled', refund_due = refund, updated_at = now() where id = k.id;
  if credit then
    insert into public.akb_class_credits (client_id, source_booking_id, expires_on, token_hash)
      values (k.client_id, k.id, public.akb_london_today() + 28, p_credit_token_hash);
  end if;
  if refunded then perform public.akb_void_charge(k.charge_id, 'Class cancelled and refunded'); end if;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (k.client_id, 'class_booking', k.id, 'cancelled_by_member', jsonb_build_object('credit', credit, 'refunded', refunded, 'refund_due', refund));
  return jsonb_build_object('credit', credit, 'refunded', refunded, 'refund_due', refund, 'booking_id', k.id);
end $$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('akb_class_refund_info', 'akb_class_refund_mark', 'akb_class_refunds_due',
      'akb_class_booking_by_token', 'akb_cancel_class_booking', 'akb_member_cancel_booking')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
