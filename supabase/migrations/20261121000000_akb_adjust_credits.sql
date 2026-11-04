-- A credit adjuster for Alex (owner, 2026-11-04): add or take away class
-- credits on a member's current period, with a reason, logged. Credits already
-- used can't be taken away, and a period holds at most 60. Not for a period
-- that has ended. Server only. Safe to run again.

begin;

-- Returns the period's new total. Raises akb: invalid_delta (0, or more than 20 either way),
-- reason_needed, not_found, period_over, invalid_credits (below what's used, or above 60).
create or replace function public.akb_adjust_period_credits(p_period uuid, p_delta integer, p_reason text)
returns integer language plpgsql set search_path = public as $$
declare
  per record;
  used integer;
  newc integer;
  why text := left(btrim(coalesce(p_reason, '')), 200);
begin
  if p_delta is null or p_delta = 0 or p_delta not between -20 and 20 then raise exception 'akb:invalid_delta' using errcode = 'P0001'; end if;
  if why = '' then raise exception 'akb:reason_needed' using errcode = 'P0001'; end if;
  select p.id, p.credits, p.period_end, m.client_id, m.id as membership_id into per
    from public.akb_membership_periods p join public.akb_memberships m on m.id = p.membership_id
    where p.id = p_period for update of p;
  if not found then raise exception 'akb:not_found' using errcode = 'P0001'; end if;
  if per.period_end < public.akb_london_today() then raise exception 'akb:period_over' using errcode = 'P0001'; end if;
  used := public.akb_period_credits_used(p_period);
  newc := per.credits + p_delta;
  if newc < used or newc > 60 then raise exception 'akb:invalid_credits' using errcode = 'P0001'; end if;
  update public.akb_membership_periods set credits = newc where id = p_period;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (per.client_id, 'membership', per.membership_id, 'credits_adjusted',
            jsonb_build_object('period_id', p_period, 'delta', p_delta, 'from', per.credits, 'to', newc, 'reason', why));
  return newc;
end $$;

revoke all on function public.akb_adjust_period_credits(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.akb_adjust_period_credits(uuid, integer, text) to service_role;

notify pgrst, 'reload schema';

commit;
