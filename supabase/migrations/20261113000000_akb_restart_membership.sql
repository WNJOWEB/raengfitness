-- Restart a cancelled membership from the account (owner, 2026-11-03).
--
-- A member who cancelled can change their mind while the period they paid for
-- is still running: the membership becomes active again with the same plan,
-- price and renewal date, and keeps its credits. Nothing is charged now; the
-- next period renews as usual. Not once the period has ended, and not when
-- that period's payment was refunded (its charge cancelled): they join again
-- and pay, as anyone would. Never alongside a running membership.
-- Safe to run again.

begin;

-- The membership the member could restart today, or null.
create or replace function public.akb_member_restartable(p_client uuid)
returns uuid language sql stable set search_path = public as $$
  select m.id from public.akb_memberships m
    join public.akb_membership_periods p on p.membership_id = m.id
    join public.akb_charges c on c.id = p.charge_id
  where m.client_id = p_client and m.status = 'cancelled'
    and public.akb_london_today() between p.period_start and p.period_end
    and c.voided_at is null
    and not exists (select 1 from public.akb_memberships x where x.client_id = p_client and x.status in ('active', 'paused'))
  order by m.created_at desc
  limit 1;
$$;

-- Restarts it. Returns the renewal date. Raises akb:not_restartable otherwise.
create or replace function public.akb_member_restart_membership(p_client uuid)
returns date language plpgsql set search_path = public as $$
declare
  mid uuid;
  m record;
begin
  -- One at a time per member (a double tap restarts once).
  perform 1 from public.akb_clients where id = p_client for update;
  mid := public.akb_member_restartable(p_client);
  if mid is null then raise exception 'akb:not_restartable' using errcode = 'P0001'; end if;
  update public.akb_memberships set status = 'active', cancelled_on = null, updated_at = now()
    where id = mid returning * into m;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (p_client, 'membership', mid, 'restarted_by_member', jsonb_build_object('renews_on', m.next_period_on));
  return m.next_period_on;
end $$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('akb_member_restartable', 'akb_member_restart_membership')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
