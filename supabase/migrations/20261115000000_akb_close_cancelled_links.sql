-- Close a cancelled charge's Stripe page (2026-11-03).
--
-- Cancelling a charge marks its open payment link cancelled (akb_void_charge),
-- but Stripe's checkout page stayed payable until it expired by itself (up to
-- 24 hours); a payment made there became credit. The server now closes the page
-- at Stripe and notes when (this column), straight after Alex cancels a charge
-- and in the daily reconcile for anything else. Safe to run again.

begin;

alter table public.akb_square_payment_links
  add column if not exists stripe_closed_at timestamptz;

-- Links already cancelled before this: their pages have expired by now.
update public.akb_square_payment_links set stripe_closed_at = now()
  where status = 'cancelled' and stripe_closed_at is null and created_at < now() - interval '1 day';

notify pgrst, 'reload schema';

commit;
