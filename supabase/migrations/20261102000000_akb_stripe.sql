-- Stripe card payments for the coach portal (ARCHITECTURE.md → Stripe payments).
-- Replaces the Square integration (20261021000000_akb_square.sql), which is
-- left in place: nothing here deletes a Square table, row or function.
--
-- Flow: the coach creates a Stripe Checkout Session (hosted by Stripe) for a
-- charge's outstanding amount and sends its URL to the client. Stripe tells the
-- site by signed webhook; the site re-reads the session from Stripe's API and
-- only then records the payment here, once, against that charge. Refunds are
-- made in the Stripe Dashboard and mirrored the same way. Nothing a browser
-- sends or a redirect shows ever records a payment.
--
-- Run after 20261021000000_akb_square.sql. Reuses the akb_database_role marker:
-- Stripe test-mode records are refused unless the database is marked 'test'.
-- Creates two tables and functions; creates, changes or deletes no existing
-- rows. One transaction; safe to run again.

begin;

-- Stripe payments are recorded with provider 'stripe' (live) or
-- 'stripe_sandbox' (test mode), so test money is always distinguishable.
-- The guard now understands both providers' names.
create or replace function public.akb_square_environment_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  env text;
begin
  if tg_table_name = 'akb_payments' then
    env := case new.provider
      when 'square_sandbox' then 'sandbox' when 'square' then 'production'
      when 'stripe_sandbox' then 'sandbox' when 'stripe' then 'production'
      else null end;
  else
    env := new.environment;
  end if;
  if env = 'sandbox' and public.akb_database_role() <> 'test' then
    raise exception 'akb:sandbox_in_production' using errcode = 'P0001';
  end if;
  if env = 'production' and public.akb_database_role() <> 'production' then
    raise exception 'akb:live_in_test' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.akb_stripe_provider(p_environment text) returns text
language plpgsql immutable set search_path = public as $$
begin
  if p_environment = 'production' then return 'stripe'; end if;
  if p_environment = 'sandbox' then return 'stripe_sandbox'; end if;
  raise exception 'akb:invalid_environment' using errcode = 'P0001';
end $$;

-- One Stripe Checkout Session per attempt to collect a charge. At most one
-- link per charge is live (creating/open) at a time.
create table if not exists public.akb_stripe_payment_links (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  environment text not null check (environment in ('sandbox', 'production')),
  charge_id uuid not null references public.akb_charges (id) on delete restrict,
  client_id uuid not null references public.akb_clients (id) on delete restrict,
  amount_pence integer not null check (amount_pence between 1 and 1000000),
  -- Sent to Stripe as the Idempotency-Key of the create call, so a retried
  -- create never makes a second session.
  idempotency_key uuid not null unique default gen_random_uuid(),
  stripe_session_id text unique check (char_length(stripe_session_id) <= 200),
  url text not null default '' check (char_length(url) <= 1000),
  status text not null default 'creating' check (status in ('creating', 'open', 'paid', 'cancelled')),
  paid_payment_id uuid references public.akb_payments (id) on delete restrict,
  check (status <> 'open' or (stripe_session_id is not null and url <> ''))
);
create unique index if not exists akb_stripe_payment_links_one_live
  on public.akb_stripe_payment_links (charge_id) where status in ('creating', 'open');
create index if not exists akb_stripe_payment_links_client_idx on public.akb_stripe_payment_links (client_id);

-- Every webhook event received, by Stripe's event id: a repeat delivery is
-- recognised and not processed twice. Only ids, types and outcomes are kept;
-- no card or personal data.
create table if not exists public.akb_stripe_events (
  event_id text primary key check (char_length(event_id) between 1 and 100),
  received_at timestamptz not null default now(),
  environment text not null check (environment in ('sandbox', 'production')),
  type text not null check (char_length(type) <= 80),
  object_id text not null default '' check (char_length(object_id) <= 200),
  attempts integer not null default 1 check (attempts between 1 and 1000),
  processed_at timestamptz,
  outcome text not null default '' check (char_length(outcome) <= 60)
);
create index if not exists akb_stripe_events_unprocessed_idx on public.akb_stripe_events (received_at) where processed_at is null;

create or replace trigger akb_stripe_payment_links_environment before insert or update of environment on public.akb_stripe_payment_links
  for each row execute function public.akb_square_environment_guard();
create or replace trigger akb_stripe_events_environment before insert or update of environment on public.akb_stripe_events
  for each row execute function public.akb_square_environment_guard();

-- Cancelling a charge retires its live link (Square's and Stripe's), so the
-- portal stops offering it. A payment that still arrives through the old
-- session (they expire within 24 hours) is recorded and becomes the client's credit.
create or replace function public.akb_void_charge(p_charge uuid, p_reason text)
returns void language plpgsql set search_path = public as $$
declare
  chg record;
  moved jsonb;
begin
  select * into chg from public.akb_charges where id = p_charge for update;
  if not found then raise exception 'akb:not_found' using errcode = 'P0001'; end if;
  if chg.voided_at is not null then return; end if;
  select coalesce(jsonb_agg(jsonb_build_object('payment_id', payment_id, 'amount_pence', amount_pence)), '[]'::jsonb)
    into moved from public.akb_payment_allocations where charge_id = p_charge;
  delete from public.akb_payment_allocations where charge_id = p_charge;
  update public.akb_charges set voided_at = now(), void_reason = left(coalesce(p_reason, ''), 300) where id = p_charge;
  update public.akb_square_payment_links set status = 'cancelled' where charge_id = p_charge and status in ('creating', 'open');
  update public.akb_stripe_payment_links set status = 'cancelled' where charge_id = p_charge and status in ('creating', 'open');
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (chg.client_id, 'charge', p_charge, 'voided', jsonb_build_object('reason', coalesce(p_reason, ''), 'released', moved));
end $$;

-- ---------------------------------------------------------------------------
-- Applying Stripe's state. Called by the webhook handler and the reconciler
-- only after re-reading the Checkout Session / refund from Stripe's API.
-- Idempotent: the same Stripe payment or refund is recorded at most once.
-- Returns: recorded | duplicate | unknown_session | pending | expired |
--          not_paid | unknown_payment | not_refunded
-- ---------------------------------------------------------------------------

create or replace function public.akb_apply_stripe_session(
  p_environment text, p_session_id text, p_session_status text, p_payment_status text,
  p_payment_intent text, p_amount_pence integer, p_currency text, p_paid_on date
) returns text language plpgsql set search_path = public as $$
declare
  provider_name text := public.akb_stripe_provider(p_environment);
  link record;
  chg record;
  pid uuid;
  owed integer;
begin
  select * into link from public.akb_stripe_payment_links
    where stripe_session_id = p_session_id and environment = p_environment for update;
  -- Not one of our sessions: ignored.
  if not found then return 'unknown_session'; end if;
  if p_session_status = 'expired' then
    if link.status in ('creating', 'open') then
      update public.akb_stripe_payment_links set status = 'cancelled' where id = link.id;
    end if;
    return 'expired';
  end if;
  if p_session_status <> 'complete' then return 'pending'; end if;
  if p_payment_status <> 'paid' then return 'not_paid'; end if;
  if p_currency is distinct from 'gbp' then raise exception 'akb:currency_mismatch' using errcode = 'P0001'; end if;
  if p_payment_intent is null or p_payment_intent = '' then return 'pending'; end if;
  select id into pid from public.akb_payments where provider = provider_name and provider_payment_id = p_payment_intent;
  if pid is not null then return 'duplicate'; end if;

  select * into chg from public.akb_charges where id = link.charge_id for update;
  insert into public.akb_payments (client_id, service, amount_pence, paid_on, method, reference, note, idempotency_key, provider, provider_payment_id)
    values (link.client_id, chg.service, p_amount_pence, p_paid_on, 'card', left(p_payment_intent, 200), 'Stripe card payment',
            left(provider_name || ':' || p_payment_intent, 100), provider_name, p_payment_intent)
    returning id into pid;
  -- Pays what's still owed on the charge; anything more (or a cancelled charge) is credit.
  if chg.voided_at is null then
    select chg.amount_pence - coalesce(sum(amount_pence), 0) into owed from public.akb_payment_allocations where charge_id = chg.id;
    if least(owed, p_amount_pence) > 0 then
      insert into public.akb_payment_allocations (payment_id, charge_id, amount_pence) values (pid, chg.id, least(owed, p_amount_pence));
    end if;
  end if;
  update public.akb_stripe_payment_links set status = 'paid', paid_payment_id = coalesce(paid_payment_id, pid) where id = link.id;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (link.client_id, 'payment', pid, 'recorded',
            jsonb_build_object('amount_pence', p_amount_pence, 'method', 'card', 'provider', provider_name, 'charge_id', chg.id, 'stripe_payment_intent', p_payment_intent));
  return 'recorded';
end $$;

create or replace function public.akb_apply_stripe_refund(
  p_environment text, p_refund_id text, p_payment_intent text, p_status text,
  p_amount_pence integer, p_currency text, p_refunded_on date
) returns text language plpgsql set search_path = public as $$
declare
  provider_name text := public.akb_stripe_provider(p_environment);
  pay record;
  charge uuid;
  key text := left(provider_name || '-refund:' || p_refund_id, 100);
begin
  if p_status in ('failed', 'canceled') then return 'not_refunded'; end if;
  if p_status <> 'succeeded' then return 'pending'; end if;
  if p_currency is distinct from 'gbp' then raise exception 'akb:currency_mismatch' using errcode = 'P0001'; end if;
  select * into pay from public.akb_payments where provider = provider_name and provider_payment_id = p_payment_intent;
  if not found then return 'unknown_payment'; end if;
  if exists (select 1 from public.akb_refunds where idempotency_key = key) then return 'duplicate'; end if;
  select charge_id into charge from public.akb_stripe_payment_links where paid_payment_id = pay.id limit 1;
  -- The charge is owed again unless the coach cancels it: the reason for a refund is theirs to record.
  perform public.akb_refund_apply(pay.id, p_amount_pence, p_refunded_on, 'Stripe refund', key, charge, false, true);
  return 'recorded';
end $$;

-- ---------------------------------------------------------------------------
-- Access: server only, like every akb_ object.
-- ---------------------------------------------------------------------------

alter table public.akb_stripe_payment_links enable row level security;
alter table public.akb_stripe_events enable row level security;
revoke all on public.akb_stripe_payment_links from anon, authenticated;
revoke all on public.akb_stripe_events from anon, authenticated;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'akb\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
