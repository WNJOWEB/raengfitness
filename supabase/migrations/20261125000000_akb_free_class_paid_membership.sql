-- First class free: only a PAID membership makes someone "not new" (owner, 2026-11-05).
--
-- The email address is the identity. A booking is free only if, for that
-- email (trimmed, case-insensitive):
-- 1. it has never had a place on a class: booked, attended, missed, or
--    cancelled late (an abandoned payment page, i.e. a lapsed hold, and a
--    class cancelled 24 hours or more before don't count);
-- 2. it has never PAID for a membership: a received payment (Stripe or one
--    Alex recorded) for one of its membership periods, refunded later or not.
--    A membership started but never paid for, or cancelled with no payment,
--    doesn't count (it used to: any membership row blocked the offer);
-- 3. it hasn't already used the free class.
-- Only rule 2 changes. Also adds akb_first_class_free_eligible_email(email)
-- (true for an email never seen), for the coach area and tests.
-- No tables or rows change. Safe to run again.

begin;

create or replace function public.akb_first_class_free_eligible(p_client uuid)
returns boolean language sql stable set search_path = public as $$
  select not exists (
      select 1 from public.akb_class_attendance a
      where a.client_id = p_client
        and (a.status in ('attended', 'no_show') or (a.status = 'booked' and a.hold_expires_at is null) or a.late_cancel))
    and not exists (
      select 1 from public.akb_memberships m
      join public.akb_membership_periods p on p.membership_id = m.id
      join public.akb_payments x on x.status = 'received' and (
        x.id in (select al.payment_id from public.akb_payment_allocations al where al.charge_id = p.charge_id)
        or x.id in (select l.paid_payment_id from public.akb_square_payment_links l where l.charge_id = p.charge_id and l.paid_payment_id is not null))
      where m.client_id = p_client)
    and not exists (
      select 1 from public.akb_class_bookings k
      where k.client_id = p_client and k.first_class_free and (k.status <> 'cancelled' or k.free_class_spent));
$$;

create or replace function public.akb_first_class_free_eligible_email(p_email text)
returns boolean language sql stable set search_path = public as $$
  select coalesce(
    (select public.akb_first_class_free_eligible(c.id) from public.akb_clients c
      where lower(btrim(c.email)) = lower(btrim(coalesce(p_email, ''))) limit 1),
    true);
$$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('akb_first_class_free_eligible', 'akb_first_class_free_eligible_email')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
