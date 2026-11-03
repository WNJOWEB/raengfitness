-- A membership paused for failed payments starts again by itself once what's
-- owed is paid (owner, 2026-11-03).
--
-- Three failed renewal payments pause a membership (akb_dd_mark). The member
-- still sees the period's payment on their Plan page (akb_member_payment_due);
-- once that charge is paid in full, by that link, a card link from Alex or a
-- payment Alex records, the membership is active again (renewals carry on from
-- its next date) and the collection is no longer marked paused. A pause Alex
-- set himself (no paused collection) is left for him. Safe to run again.

begin;

create or replace function public.akb_membership_resume_on_payment() returns trigger
language plpgsql set search_path = public as $$
declare
  per record;
  owed integer;
begin
  select p.id, p.membership_id, m.client_id into per
    from public.akb_membership_periods p
    join public.akb_memberships m on m.id = p.membership_id
    where p.charge_id = new.charge_id and m.status = 'paused'
      and exists (select 1 from public.akb_dd_collections k where k.period_id = p.id and k.paused);
  if not found then return null; end if;
  select outstanding_pence into owed from public.akb_charge_balances where id = new.charge_id;
  if owed > 0 then return null; end if;
  begin
    perform public.akb_set_membership_status(per.membership_id, 'active', public.akb_london_today());
    update public.akb_dd_collections set paused = false, updated_at = now() where period_id = per.id;
    insert into public.akb_events (client_id, entity, entity_id, action, detail)
      values (per.client_id, 'membership', per.membership_id, 'resumed_after_payment', jsonb_build_object('period_id', per.id, 'charge_id', new.charge_id));
  exception when others then
    -- Never lose a payment: it stays recorded; Alex restarts the membership.
    insert into public.akb_events (client_id, entity, entity_id, action, detail)
      values (per.client_id, 'membership', per.membership_id, 'resume_failed', jsonb_build_object('error', left(sqlerrm, 200)));
  end;
  return null;
end $$;

drop trigger if exists akb_payment_allocations_membership_resume on public.akb_payment_allocations;
create trigger akb_payment_allocations_membership_resume
  after insert or update of amount_pence on public.akb_payment_allocations
  for each row execute function public.akb_membership_resume_on_payment();

revoke all on function public.akb_membership_resume_on_payment() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
