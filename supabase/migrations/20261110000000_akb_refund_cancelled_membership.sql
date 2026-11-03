-- A full Stripe refund of a membership period, once the membership is cancelled.
--
-- Same rule as a cancelled class (20261108000000; owner, 2026-11-03: the money
-- back or the credits, not both): the period's fee is cancelled, so nothing
-- shows as owed, and its unused credits end (credits already used stay used;
-- logged credits_withdrawn). A refund while the membership is still running,
-- or a partial refund, behaves as before: the fee is owed again for the coach
-- to decide. The class-booking rule is unchanged. Safe to run again.

begin;

create or replace function public.akb_apply_square_refund(
  p_environment text, p_refund_id text, p_payment_id text, p_status text,
  p_amount_pence integer, p_currency text, p_refunded_on date
) returns text language plpgsql set search_path = public as $$
declare
  provider_name text := public.akb_square_provider(p_environment);
  pay record;
  charge uuid;
  key text := left(provider_name || '-refund:' || p_refund_id, 100);
  refunded integer;
  bk record;
  cr record;
  per record;
begin
  if p_status in ('REJECTED', 'FAILED') then return 'not_refunded'; end if;
  if p_status <> 'COMPLETED' then return 'pending'; end if;
  if p_currency is distinct from 'GBP' then raise exception 'akb:currency_mismatch' using errcode = 'P0001'; end if;
  select * into pay from public.akb_payments where provider = provider_name and provider_payment_id = p_payment_id;
  if not found then return 'unknown_payment'; end if;
  if exists (select 1 from public.akb_refunds where idempotency_key = key) then return 'duplicate'; end if;
  select charge_id into charge from public.akb_square_payment_links where paid_payment_id = pay.id limit 1;
  -- The charge is owed again unless the coach cancels it: the reason for a refund is theirs to record.
  perform public.akb_refund_apply(pay.id, p_amount_pence, p_refunded_on, 'Stripe refund', key, charge, false, true);

  -- Except a cancelled class booking paid by this payment, once all of it is back.
  if charge is null then return 'recorded'; end if;
  select coalesce(sum(amount_pence), 0) into refunded from public.akb_refunds where payment_id = pay.id;
  if refunded < pay.amount_pence then return 'recorded'; end if;
  -- A period of a membership already cancelled: the fee is cancelled and its unused credits end,
  -- so the member has the money back or the credits, not both. Credits already used stay used.
  select p.id, p.credits, p.membership_id, m.client_id, b.credits_used into per
    from public.akb_membership_periods p
    join public.akb_memberships m on m.id = p.membership_id
    join public.akb_membership_period_balances b on b.id = p.id
    where p.charge_id = charge and m.status = 'cancelled' for update of p;
  if found then
    if per.credits > per.credits_used then
      update public.akb_membership_periods set credits = per.credits_used where id = per.id;
      insert into public.akb_events (client_id, entity, entity_id, action, detail)
        values (per.client_id, 'membership', per.membership_id, 'credits_withdrawn',
                jsonb_build_object('reason', 'refunded', 'period_id', per.id, 'withdrawn', per.credits - per.credits_used, 'payment_id', pay.id));
    end if;
    perform public.akb_void_charge(charge, 'Membership cancelled and refunded');
    return 'recorded';
  end if;
  select * into bk from public.akb_class_bookings where charge_id = charge and status = 'cancelled' for update;
  if not found then return 'recorded'; end if;
  select * into cr from public.akb_class_credits where source_booking_id = bk.id for update;
  if found and cr.used_booking_id is not null then return 'recorded'; end if;
  if found then
    delete from public.akb_class_credits where id = cr.id;
    insert into public.akb_events (client_id, entity, entity_id, action, detail)
      values (bk.client_id, 'class_booking', bk.id, 'credit_withdrawn',
              jsonb_build_object('reason', 'refunded', 'credit_id', cr.id, 'expires_on', cr.expires_on, 'payment_id', pay.id));
  end if;
  perform public.akb_void_charge(charge, 'Class cancelled and refunded');
  return 'recorded';
end $$;

notify pgrst, 'reload schema';

commit;
