-- Memberships renew by saved card (owner, 2026-11-02, like Spotify): the first
-- 4 weeks are paid by card on Stripe's page, which (with the member's consent,
-- shown there) saves the card; each later 4 weeks is charged to it on the day
-- the period starts, until the member cancels. A Direct Debit, once Stripe
-- approves Bacs, does the same job with its own timing.
--
-- It reuses the Direct Debit tables and functions (20261105000000):
-- - akb_stripe_customers gets "method" (card or bacs) and a label for the card
--   (e.g. "Visa ending 4242") to show on the member's plan page. Its dd_status
--   column keeps its name: 'active' now means "a method is on file".
-- - akb_card_set_method saves the card (from the first payment or the "update
--   card" page). A Direct Debit already set up is not replaced by a card that
--   was only saved from a payment (p_replace false).
-- - akb_dd_due: a card is charged on the day its period starts (a Direct
--   Debit is submitted 6 days ahead, as before); a failed try is retried 3 days
--   after the first and 4 days after the second (day 3, day 7); three failures
--   pause the membership (akb_dd_mark, unchanged).
-- - akb_renew_dd_memberships follows the same lead per method.
-- - Renewal reminders (5 days ahead) and "renewed" receipts are sent once each:
--   akb_stripe_customers.reminded_for names the renewal date last reminded, and
--   akb_dd_collections.paid_notified_at the receipt.
--
-- Adds columns and functions; replaces akb_dd_set_method, akb_renew_dd_memberships
-- and akb_dd_due (same arguments, so the code deployed before this still works).
-- Changes no existing row. Safe to run again. Tests: src/lib/stripe/card-renewals.test.ts.

begin;

alter table public.akb_stripe_customers add column if not exists method text not null default 'bacs' check (method in ('bacs', 'card'));
alter table public.akb_stripe_customers add column if not exists card_label text not null default '' check (char_length(card_label) <= 60);
alter table public.akb_stripe_customers add column if not exists reminded_for date;
alter table public.akb_dd_collections add column if not exists paid_notified_at timestamptz;

-- Rows made before this: succeeded collections have already been paid and need no receipt.
update public.akb_dd_collections set paid_notified_at = coalesce(paid_notified_at, now()) where status = 'succeeded' and paid_notified_at is null;

-- A Direct Debit set up (Stripe's page finished): it replaces any saved card.
create or replace function public.akb_dd_set_method(p_client uuid, p_environment text, p_customer text, p_method text, p_mandate text)
returns text language plpgsql set search_path = public as $$
declare
  row record;
begin
  select * into row from public.akb_stripe_customers where client_id = p_client for update;
  if not found then return 'unknown_client'; end if;
  if row.environment <> p_environment or row.customer_id <> p_customer then return 'mismatch'; end if;
  update public.akb_stripe_customers
    set payment_method_id = p_method, mandate_id = p_mandate, dd_status = 'active', method = 'bacs', card_label = '', updated_at = now()
    where client_id = p_client;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (p_client, 'membership', p_client, 'direct_debit_set_up', jsonb_build_object('mandate', p_mandate));
  return 'active';
end $$;

-- A card saved for renewals. p_replace: the member chose to change their card
-- (true) or it was saved while paying (false: an active Direct Debit stays).
create or replace function public.akb_card_set_method(p_client uuid, p_environment text, p_customer text, p_method text, p_label text, p_replace boolean)
returns text language plpgsql set search_path = public as $$
declare
  row record;
begin
  select * into row from public.akb_stripe_customers where client_id = p_client for update;
  if not found then return 'unknown_client'; end if;
  if row.environment <> p_environment or row.customer_id <> p_customer then return 'mismatch'; end if;
  if row.method = 'bacs' and row.dd_status = 'active' and not p_replace then return 'kept_direct_debit'; end if;
  if row.method = 'card' and row.dd_status = 'active' and row.payment_method_id = p_method then return 'active'; end if;
  update public.akb_stripe_customers
    set payment_method_id = p_method, mandate_id = null, dd_status = 'active', method = 'card', card_label = left(coalesce(p_label, ''), 60), updated_at = now()
    where client_id = p_client;
  -- A new card: a payment that failed (and isn't paused) is tried again at the next daily run.
  update public.akb_dd_collections k set last_attempt_on = public.akb_london_today() - 10
    from public.akb_membership_periods per
    join public.akb_memberships m on m.id = per.membership_id
    where per.id = k.period_id and m.client_id = p_client and k.status = 'failed' and not k.paused;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (p_client, 'membership', p_client, 'card_saved', jsonb_build_object('card', left(coalesce(p_label, ''), 60)));
  return 'active';
end $$;

-- What the member's account page shows: the method on file and, for a card, its label.
create or replace function public.akb_payment_method_info(p_client uuid)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('status', dd_status, 'method', method, 'label', card_label) from public.akb_stripe_customers where client_id = p_client),
    jsonb_build_object('status', 'none', 'method', '', 'label', ''));
$$;

-- Early periods follow each member's lead: a card renews on the day, a Direct Debit 6 days ahead.
create or replace function public.akb_renew_dd_memberships(p_today date, p_lead_days integer default 6)
returns integer language plpgsql set search_path = public as $$
declare
  r record;
  made integer := 0;
begin
  for r in
    select m.id, case d.method when 'bacs' then p_lead_days else 0 end as lead
    from public.akb_memberships m
    join public.akb_stripe_customers d on d.client_id = m.client_id and d.dd_status = 'active'
    where m.status = 'active' and m.next_period_on <= p_today + case d.method when 'bacs' then p_lead_days else 0 end
    order by m.next_period_on
  loop
    made := made + public.akb_membership_ensure_periods(r.id, p_today + r.lead);
  end loop;
  return made;
end $$;

-- Periods to collect now: an active membership with a method on file, a period
-- starting within the lead (a card: today; a Direct Debit: 6 days) or already
-- begun, with money owed, and nothing in flight. A failed try is retried 3 days
-- after the first and (cards) 4 days after the second, up to p_max tries.
create or replace function public.akb_dd_due(p_today date, p_lead_days integer default 6, p_max integer default 3)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.period_start), '[]'::jsonb) from (
    select p.id as period_id, p.charge_id, m.client_id, c.email, c.full_name, m.plan_name,
           p.period_start, p.period_end, b.outstanding_pence,
           d.customer_id, d.payment_method_id, d.environment, d.method,
           coalesce(k.attempts, 0) as attempts
    from public.akb_membership_periods p
    join public.akb_memberships m on m.id = p.membership_id
    join public.akb_clients c on c.id = m.client_id
    join public.akb_charge_balances b on b.id = p.charge_id
    join public.akb_stripe_customers d on d.client_id = m.client_id and d.dd_status = 'active' and d.payment_method_id is not null
    left join public.akb_dd_collections k on k.period_id = p.id
    where m.status = 'active' and b.outstanding_pence > 0 and b.voided_at is null
      and p.period_start <= p_today + case d.method when 'bacs' then p_lead_days else 0 end and p.period_end >= p_today
      and (k.period_id is null
           or (k.status = 'failed' and not k.paused and k.attempts < p_max
               and k.last_attempt_on <= p_today - case when d.method = 'card' and k.attempts >= 2 then 4 else 3 end))
    order by p.period_start
    limit 100
  ) x;
$$;

-- Card members to remind that a renewal is coming (once per renewal date). A Direct
-- Debit is submitted to the bank 6 days ahead, so its notice is Stripe's own mandate email.
create or replace function public.akb_renewal_reminders_due(p_today date, p_days integer default 5)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.renews_on), '[]'::jsonb) from (
    select m.client_id, c.email, c.full_name, m.plan_name, m.price_pence, m.next_period_on as renews_on, d.method, d.card_label, d.environment
    from public.akb_memberships m
    join public.akb_clients c on c.id = m.client_id
    join public.akb_stripe_customers d on d.client_id = m.client_id and d.dd_status = 'active' and d.payment_method_id is not null
    where m.status = 'active' and d.method = 'card' and m.next_period_on > p_today and m.next_period_on <= p_today + p_days
      and d.reminded_for is distinct from m.next_period_on and c.email <> ''
    order by m.next_period_on
    limit 100
  ) x;
$$;

create or replace function public.akb_renewal_reminder_sent(p_client uuid, p_for date)
returns void language sql set search_path = public as $$
  update public.akb_stripe_customers set reminded_for = p_for where client_id = p_client;
$$;

-- Server only.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'akb_dd_set_method', 'akb_card_set_method', 'akb_payment_method_info', 'akb_renew_dd_memberships', 'akb_dd_due',
      'akb_renewal_reminders_due', 'akb_renewal_reminder_sent')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
