-- Account extras (owner, 2026-11-03): a day-before class reminder, payment
-- history with receipts, and changing the account's email (confirmed by a
-- code sent to the new address). Server only, like every member function.
-- Safe to run again.

begin;

-- ---------------------------------------------------------------------------
-- 1. The day-before reminder: its own setting and its own "sent" record.
-- ---------------------------------------------------------------------------

alter table public.akb_member_settings
  add column if not exists reminder_day_before boolean not null default false;

create table if not exists public.akb_class_reminders_day_before (
  attendance_id uuid primary key references public.akb_class_attendance (id) on delete cascade,
  sent_at timestamptz not null default now()
);
alter table public.akb_class_reminders_day_before enable row level security;
revoke all on public.akb_class_reminders_day_before from anon, authenticated;

create or replace function public.akb_member_set_day_before(p_client uuid, p_on boolean)
returns void language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.akb_clients where id = p_client) then
    raise exception 'akb:not_found' using errcode = 'P0001';
  end if;
  insert into public.akb_member_settings (client_id, reminder_day_before) values (p_client, coalesce(p_on, false))
    on conflict (client_id) do update set reminder_day_before = excluded.reminder_day_before, updated_at = now();
end $$;

create or replace function public.akb_member_settings_get(p_client uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'name', c.full_name, 'email', c.email, 'phone', c.phone,
    'class_reminders', coalesce((select s.class_reminders from public.akb_member_settings s where s.client_id = c.id), false),
    'reminder_day_before', coalesce((select s.reminder_day_before from public.akb_member_settings s where s.client_id = c.id), false),
    'calendar_feed', exists (select 1 from public.akb_member_calendar_feeds f where f.client_id = c.id))
  from public.akb_clients c where c.id = p_client;
$$;

-- Classes on the day after p_date, for members who asked to be told the day before.
create or replace function public.akb_class_day_before_due(p_date date)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'attendance_id', a.id, 'name', c.full_name, 'email', c.email,
    'starts_at', s.starts_at, 'slot', s.slot) order by s.starts_at, c.full_name), '[]'::jsonb)
  from public.akb_class_attendance a
  join public.akb_class_sessions s on s.id = a.class_session_id
  join public.akb_clients c on c.id = a.client_id
  join public.akb_member_settings m on m.client_id = c.id and m.reminder_day_before
  where s.class_date = p_date + 1 and s.cancelled_at is null and s.starts_at > now()
    and a.status = 'booked' and a.hold_expires_at is null and c.email <> ''
    and not exists (select 1 from public.akb_class_reminders_day_before r where r.attendance_id = a.id);
$$;

create or replace function public.akb_class_day_before_sent(p_attendance uuid)
returns void language sql set search_path = public as $$
  insert into public.akb_class_reminders_day_before (attendance_id) values (p_attendance) on conflict do nothing;
$$;

-- ---------------------------------------------------------------------------
-- 2. Payment history and receipts: the member's own received payments, what
--    each was for, and any refunds. Nothing about anyone else.
-- ---------------------------------------------------------------------------

create or replace function public.akb_member_payment_rows(p_client uuid)
returns table (id uuid, paid_on date, amount_pence integer, method text, provider text, description text, refunded_pence integer, created_at timestamptz)
language sql stable set search_path = public as $$
  select p.id, p.paid_on, p.amount_pence, p.method, p.provider,
    coalesce(
      (select c.description from public.akb_square_payment_links l join public.akb_charges c on c.id = l.charge_id where l.paid_payment_id = p.id limit 1),
      (select string_agg(c.description, '; ' order by c.due_on) from public.akb_payment_allocations x join public.akb_charges c on c.id = x.charge_id where x.payment_id = p.id),
      case p.service when 'group' then 'Group classes' when 'pt' then '1:1 coaching' when 'online' then 'Online coaching' else 'Payment' end),
    coalesce((select sum(r.amount_pence) from public.akb_refunds r where r.payment_id = p.id), 0)::integer,
    p.created_at
  from public.akb_payments p
  where p.client_id = p_client and p.status = 'received';
$$;

create or replace function public.akb_member_payments(p_client uuid)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r) - 'created_at' order by r.paid_on desc, r.created_at desc), '[]'::jsonb)
  from public.akb_member_payment_rows(p_client) r;
$$;

-- One receipt: the payment, and its refunds by date. Null unless it's theirs.
create or replace function public.akb_member_receipt(p_client uuid, p_payment uuid)
returns jsonb language sql stable set search_path = public as $$
  select to_jsonb(r) - 'created_at' || jsonb_build_object('refunds', coalesce((
      select jsonb_agg(jsonb_build_object('amount_pence', f.amount_pence, 'refunded_on', f.refunded_on) order by f.refunded_on)
      from public.akb_refunds f where f.payment_id = r.id), '[]'::jsonb))
  from public.akb_member_payment_rows(p_client) r where r.id = p_payment;
$$;

-- ---------------------------------------------------------------------------
-- 3. Changing the account's email: a 6-digit code to the new address (only
--    its SHA-256 kept), 15 minutes, 5 wrong tries, 5 asks an hour.
-- ---------------------------------------------------------------------------

create table if not exists public.akb_email_changes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_id uuid not null references public.akb_clients (id) on delete cascade,
  new_email text not null check (char_length(new_email) between 3 and 254),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  used_at timestamptz
);
create index if not exists akb_email_changes_client_idx on public.akb_email_changes (client_id, created_at desc);
alter table public.akb_email_changes enable row level security;
revoke all on public.akb_email_changes from anon, authenticated;

-- Starts a change. Raises akb:same_email, akb:email_taken or akb:too_many.
create or replace function public.akb_member_email_change_start(p_client uuid, p_new_email text, p_code_hash text)
returns void language plpgsql set search_path = public as $$
declare
  v text := lower(btrim(coalesce(p_new_email, '')));
  cur text;
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'akb:invalid_code' using errcode = 'P0001'; end if;
  select lower(email) into cur from public.akb_clients where id = p_client for update;
  if not found then raise exception 'akb:not_found' using errcode = 'P0001'; end if;
  if v = cur then raise exception 'akb:same_email' using errcode = 'P0001'; end if;
  if exists (select 1 from public.akb_clients where lower(email) = v and id <> p_client) then
    raise exception 'akb:email_taken' using errcode = 'P0001';
  end if;
  if (select count(*) from public.akb_email_changes where client_id = p_client and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'akb:too_many' using errcode = 'P0001';
  end if;
  insert into public.akb_email_changes (client_id, new_email, code_hash, expires_at)
    values (p_client, v, p_code_hash, now() + interval '15 minutes');
end $$;

-- Confirms it with the code. Returns {old_email, new_email}, or null for a
-- wrong, expired or used code (a wrong one counts; 5 and that change stops).
-- Raises akb:email_taken if the address was taken meanwhile.
create or replace function public.akb_member_email_change_confirm(p_client uuid, p_code_hash text)
returns jsonb language plpgsql set search_path = public as $$
declare
  ch record;
  old_email text;
begin
  select * into ch from public.akb_email_changes
    where client_id = p_client and used_at is null and expires_at > now()
    order by created_at desc limit 1 for update;
  if not found or ch.attempts >= 5 then return null; end if;
  if ch.code_hash <> p_code_hash then
    update public.akb_email_changes set attempts = attempts + 1 where id = ch.id;
    return null;
  end if;
  select email into old_email from public.akb_clients where id = p_client for update;
  begin
    update public.akb_clients set email = ch.new_email, updated_at = now() where id = p_client;
  exception when unique_violation then
    raise exception 'akb:email_taken' using errcode = 'P0001';
  end;
  update public.akb_email_changes set used_at = now() where id = ch.id;
  -- The addresses themselves aren't copied into the log.
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (p_client, 'client', p_client, 'email_changed', jsonb_build_object('by', 'member'));
  return jsonb_build_object('old_email', old_email, 'new_email', ch.new_email);
end $$;

-- ---------------------------------------------------------------------------
-- Access: server only
-- ---------------------------------------------------------------------------

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'akb_member_set_day_before', 'akb_member_settings_get', 'akb_class_day_before_due', 'akb_class_day_before_sent',
      'akb_member_payment_rows', 'akb_member_payments', 'akb_member_receipt',
      'akb_member_email_change_start', 'akb_member_email_change_confirm')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
