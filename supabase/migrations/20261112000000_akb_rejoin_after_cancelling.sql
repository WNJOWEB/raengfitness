-- Rejoining after cancelling (owner, 2026-11-03: a member who cancelled couldn't join again).
--
-- 1. Joining online was refused while a cancelled membership's paid period ran
--    (akb_is_member). Now only a running (active or paused) membership blocks
--    it, or a cancelled one whose current paid period still has credits to use
--    (akb:membership_running: they'd be stranded). Used up, refunded or ended:
--    they can join again at once. akb_is_member itself (sign-in) is unchanged.
-- 2. With an old cancelled membership and a new one, a credit booking used the
--    period that started latest, which on the day of rejoining could be the old
--    one. The running membership's period now comes first.
-- Safe to run again.

begin;

create or replace function public.akb_create_membership_signup(
  p_name text, p_email text, p_phone text,
  p_plan text, p_plan_name text, p_price_pence integer, p_credits integer,
  p_class_slot text, p_class_date date, p_class_starts_at timestamptz, p_class_duration integer,
  p_terms_agreed_at timestamptz, p_idempotency_key text
) returns jsonb language plpgsql set search_path = public as $$
declare
  s record;
  cid uuid;
  chg uuid;
  sid uuid;
  old record;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  select * into s from public.akb_membership_signups where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('signup_id', s.id, 'charge_id', s.charge_id, 'status', s.status);
  end if;
  if v_email = '' then raise exception 'akb:invalid_email' using errcode = 'P0001'; end if;

  select c.id into cid from public.akb_clients c where lower(c.email) = v_email for update;
  if cid is null then
    insert into public.akb_clients (full_name, email, phone, status)
      values (left(btrim(p_name), 100), v_email, left(btrim(coalesce(p_phone, '')), 30), 'lead')
      returning id into cid;
  end if;
  -- A running membership blocks a second one. A cancelled one only does while its paid period
  -- still has credits to use (they would be stranded); once used, refunded or ended, they can rejoin.
  if exists (select 1 from public.akb_memberships where client_id = cid and status in ('active', 'paused')) then
    raise exception 'akb:already_member' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.akb_membership_period_balances b
             join public.akb_charges c on c.id = b.charge_id
             where b.client_id = cid and public.akb_london_today() between b.period_start and b.period_end
               and b.credits_left > 0 and c.voided_at is null) then
    raise exception 'akb:membership_running' using errcode = 'P0001';
  end if;

  -- A sign-up they started before and didn't pay is replaced (its charge and link are retired).
  select * into old from public.akb_membership_signups where client_id = cid and status = 'awaiting_payment' for update;
  if found then
    if exists (select 1 from public.akb_payment_allocations where charge_id = old.charge_id) then
      raise exception 'akb:payment_in_progress' using errcode = 'P0001';
    end if;
    perform public.akb_void_charge(old.charge_id, 'Replaced by a new online sign-up');
    update public.akb_membership_signups set status = 'replaced', updated_at = now() where id = old.id;
  end if;

  insert into public.akb_charges (client_id, service, description, amount_pence, due_on)
    values (cid, 'group', left(format('%s membership, first 4 weeks', p_plan_name), 200), p_price_pence, public.akb_london_today())
    returning id into chg;
  insert into public.akb_membership_signups (
    client_id, plan, plan_name, price_pence, credits, charge_id,
    class_slot, class_date, class_starts_at, class_duration, terms_agreed_at,
    first_class, idempotency_key)
  values (
    cid, p_plan, p_plan_name, p_price_pence, p_credits, chg,
    p_class_slot, p_class_date, p_class_starts_at, p_class_duration, p_terms_agreed_at,
    case when p_class_date is null then 'none' else 'requested' end, p_idempotency_key)
  returning id into sid;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (cid, 'membership_signup', sid, 'created',
            jsonb_build_object('plan', p_plan, 'price_pence', p_price_pence, 'charge_id', chg, 'first_class', p_class_date));
  return jsonb_build_object('signup_id', sid, 'charge_id', chg, 'status', 'awaiting_payment');
end $$;

create or replace function public.akb_member_book_class(
  p_client uuid, p_slot text, p_date date, p_starts_at timestamptz, p_duration integer
) returns uuid language plpgsql set search_path = public as $$
declare
  pid uuid;
  sid uuid;
  a record;
  aid uuid;
begin
  if not public.akb_is_member(p_client) then raise exception 'akb:no_membership' using errcode = 'P0001'; end if;
  if p_starts_at <= now() then raise exception 'akb:class_started' using errcode = 'P0001'; end if;
  select p.id into pid from public.akb_membership_periods p
    join public.akb_memberships m on m.id = p.membership_id
    where m.client_id = p_client and p_date between p.period_start and p.period_end
    order by (m.status in ('active', 'paused')) desc, p.period_start desc, p.created_at desc limit 1;
  if pid is null then raise exception 'akb:no_membership' using errcode = 'P0001'; end if;
  sid := public.akb_ensure_class_session(p_slot, p_date, p_starts_at, p_duration);
  select * into a from public.akb_class_attendance where class_session_id = sid and client_id = p_client for update;
  if found then
    if a.status <> 'cancelled' then raise exception 'akb:already_booked' using errcode = 'P0001'; end if;
    -- Re-booking a place they cancelled: one place per person per class, so the old row comes back.
    update public.akb_class_attendance
      set status = 'booked', membership_period_id = pid, late_cancel = false, updated_at = now()
      where id = a.id;
    aid := a.id;
  else
    insert into public.akb_class_attendance (class_session_id, client_id, membership_period_id)
      values (sid, p_client, pid) returning id into aid;
  end if;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (p_client, 'attendance', aid, 'booked_by_member', jsonb_build_object('class_date', p_date, 'slot', p_slot, 'period_id', pid));
  return aid;
end $$;

create or replace function public.akb_use_membership_credit(p_attendance uuid)
returns uuid language plpgsql set search_path = public as $$
declare
  a record;
  pid uuid;
  chg uuid;
begin
  select att.*, s.class_date into a from public.akb_class_attendance att
    join public.akb_class_sessions s on s.id = att.class_session_id
    where att.id = p_attendance for update of att;
  if not found then raise exception 'akb:not_found' using errcode = 'P0001'; end if;
  if a.membership_period_id is not null then return a.membership_period_id; end if;
  select p.id into pid from public.akb_membership_periods p
    join public.akb_memberships m on m.id = p.membership_id
    where m.client_id = a.client_id and a.class_date between p.period_start and p.period_end
    order by (m.status in ('active', 'paused')) desc, p.period_start desc, p.created_at desc limit 1;
  if pid is null then raise exception 'akb:no_membership' using errcode = 'P0001'; end if;
  -- The trigger checks the credits (and raises no_credits).
  update public.akb_class_attendance set membership_period_id = pid, updated_at = now() where id = p_attendance;
  -- A pay-as-you-go charge for this place, if one was raised and nothing is paid against it, is cancelled.
  select c.id into chg from public.akb_charges c
    where c.attendance_id = p_attendance and c.voided_at is null
      and not exists (select 1 from public.akb_payment_allocations x where x.charge_id = c.id);
  if chg is not null then
    update public.akb_charges set voided_at = now(), void_reason = 'Paid with a membership credit' where id = chg;
  end if;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (a.client_id, 'attendance', p_attendance, 'credit_used', jsonb_build_object('period_id', pid));
  return pid;
end $$;

-- create or replace keeps each function's existing grants (service_role only).

notify pgrst, 'reload schema';

commit;
