-- A pause button for members (owner, 2026-11-04).
--
-- The rules (here, so they can be changed in one place):
-- - A member can pause once, for one period (a membership's period_days, 4 weeks).
-- - The pause starts when the period they are in ends: the credits they have
--   stay usable until then, nothing is refunded, and nothing is taken for the
--   paused period. The membership then renews on the day the pause ends.
-- - Once every 6 months: a new pause may not start within 6 months of the
--   start of the last one.
-- - It can be asked for until the next period has been set up (a Direct Debit
--   period is set up 6 days before it starts). After that the pause is too late.
-- - The member can undo a pause that hasn't begun (the renewal date goes back),
--   or end one that is running (the membership restarts today). A pause undone
--   before it begins doesn't count towards the 6 months; one ended early does.
--
-- How it works: the membership stays 'active' and its next_period_on moves on
-- by one period, so the daily renewal jobs, the Direct Debit and card
-- collections and the renewal reminders all just wait (they follow
-- next_period_on). pause_from and pause_until record the pause.
-- Server only. Safe to run again.

begin;

alter table public.akb_memberships add column if not exists pause_from date;
alter table public.akb_memberships add column if not exists pause_until date;

-- Where a member's pause stands. state: none | scheduled | paused. can_pause says whether
-- they could ask now; if not, reason is one of no_membership, pause_active, too_late
-- (the next period is already set up, or due today), too_soon (next_allowed_on says when).
create or replace function public.akb_member_pause_info(p_client uuid)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  m record;
  today date := public.akb_london_today();
  start_on date;
begin
  select * into m from public.akb_memberships where client_id = p_client and status = 'active' order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('state', 'none', 'can_pause', false, 'reason', 'no_membership');
  end if;
  if m.pause_from is not null and m.pause_until > today then
    return jsonb_build_object('state', case when today < m.pause_from then 'scheduled' else 'paused' end,
      'can_pause', false, 'reason', 'pause_active', 'pause_from', m.pause_from, 'pause_until', m.pause_until);
  end if;
  start_on := m.next_period_on;
  if start_on <= today or exists (select 1 from public.akb_membership_periods p where p.membership_id = m.id and p.period_start > today) then
    return jsonb_build_object('state', 'none', 'can_pause', false, 'reason', 'too_late');
  end if;
  if m.pause_from is not null and start_on < (m.pause_from + interval '6 months')::date then
    return jsonb_build_object('state', 'none', 'can_pause', false, 'reason', 'too_soon',
      'next_allowed_on', (m.pause_from + interval '6 months')::date);
  end if;
  return jsonb_build_object('state', 'none', 'can_pause', true, 'pause_from', start_on, 'pause_until', start_on + m.period_days);
end $$;

-- Pauses. Returns {pause_from, pause_until, plan_name}. Raises akb:no_membership, pause_active,
-- pause_too_late, pause_too_soon.
create or replace function public.akb_member_pause(p_client uuid)
returns jsonb language plpgsql set search_path = public as $$
declare
  m record;
  info jsonb;
begin
  -- One at a time per member (a double tap pauses once).
  perform 1 from public.akb_clients where id = p_client for update;
  select * into m from public.akb_memberships where client_id = p_client and status = 'active' order by created_at desc limit 1 for update;
  if not found then raise exception 'akb:no_membership' using errcode = 'P0001'; end if;
  info := public.akb_member_pause_info(p_client);
  if not (info->>'can_pause')::boolean then
    raise exception 'akb:%', case info->>'reason'
      when 'pause_active' then 'pause_active' when 'too_late' then 'pause_too_late' when 'too_soon' then 'pause_too_soon' else 'no_membership' end
      using errcode = 'P0001';
  end if;
  update public.akb_memberships
    set pause_from = (info->>'pause_from')::date, pause_until = (info->>'pause_until')::date,
        next_period_on = (info->>'pause_until')::date, updated_at = now()
    where id = m.id;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (p_client, 'membership', m.id, 'pause_scheduled', jsonb_build_object('pause_from', info->>'pause_from', 'pause_until', info->>'pause_until'));
  return jsonb_build_object('pause_from', info->>'pause_from', 'pause_until', info->>'pause_until', 'plan_name', m.plan_name);
end $$;

-- Undoes a pause that hasn't begun, or ends one that is running (restart today).
-- Returns {renews_on, began} (began: whether the pause had already begun). Raises akb:no_pause.
create or replace function public.akb_member_pause_undo(p_client uuid)
returns jsonb language plpgsql set search_path = public as $$
declare
  m record;
  today date := public.akb_london_today();
begin
  perform 1 from public.akb_clients where id = p_client for update;
  select * into m from public.akb_memberships where client_id = p_client and status = 'active' order by created_at desc limit 1 for update;
  if not found or m.pause_from is null or m.pause_until <= today then raise exception 'akb:no_pause' using errcode = 'P0001'; end if;
  if today < m.pause_from then
    update public.akb_memberships set next_period_on = m.pause_from, pause_from = null, pause_until = null, updated_at = now() where id = m.id;
    insert into public.akb_events (client_id, entity, entity_id, action, detail)
      values (p_client, 'membership', m.id, 'pause_undone', jsonb_build_object('renews_on', m.pause_from));
    return jsonb_build_object('renews_on', m.pause_from, 'began', false);
  end if;
  update public.akb_memberships set next_period_on = today, pause_until = today, updated_at = now() where id = m.id;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (p_client, 'membership', m.id, 'pause_ended_early', jsonb_build_object('renews_on', today));
  return jsonb_build_object('renews_on', today, 'began', true);
end $$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('akb_member_pause_info', 'akb_member_pause', 'akb_member_pause_undo')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
