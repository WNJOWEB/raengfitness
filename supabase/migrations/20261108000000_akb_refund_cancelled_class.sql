-- A full Stripe refund of a class the member has already cancelled.
--
-- Before: the refund put the class fee back as owed (the coach records why a
-- refund happened), so a member who cancelled, got a class credit and was then
-- refunded in Stripe showed as owing the fee, and still held the credit.
--
-- Now, once a payment for a cancelled online class booking is fully refunded:
-- - an unused class credit from that cancellation is withdrawn (one or the
--   other: the money back or a free class, not both), and
-- - the class fee is cancelled, because nothing is owed for a class not taken.
-- If the credit was already used to book another class, nothing more changes:
-- that class was taken, so its fee stays owed and the coach decides.
-- Partial refunds and refunds of bookings still in place behave as before.
-- Safe to run again.

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

-- create or replace keeps the function's existing grants (service_role only).

notify pgrst, 'reload schema';

commit;
