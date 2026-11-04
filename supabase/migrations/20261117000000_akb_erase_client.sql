-- Deleting a former client's personal details on request (UK GDPR right to
-- erasure; owner, 2026-11-03).
--
-- Alex can erase a client who has nothing running (no active or paused
-- membership or coaching, no class or 1:1 session still to come). Their name
-- becomes "Deleted client" and their contact details, notes, booking-request
-- messages, coaching programmes, logs, check-ins and messages (which can hold
-- health details), sign-ins, settings, calendar links, consents and unused
-- class credits are removed. Payments, charges and refunds stay, with dates,
-- amounts and what they were for: UK tax rules require them to be kept (the
-- privacy notice says 6 years). Their Stripe customer record is in Stripe, not
-- here; Alex deletes it there if asked. Server only. Safe to run again.

begin;

alter table public.akb_clients add column if not exists erased_at timestamptz;

-- Raises akb:still_active while something is running, akb:not_found otherwise.
create or replace function public.akb_erase_client(p_client uuid)
returns void language plpgsql set search_path = public as $$
declare
  c record;
  subs uuid[];
begin
  select * into c from public.akb_clients where id = p_client for update;
  if not found then raise exception 'akb:not_found' using errcode = 'P0001'; end if;
  if c.erased_at is not null then return; end if;
  if exists (select 1 from public.akb_memberships where client_id = p_client and status in ('active', 'paused'))
     or exists (select 1 from public.akb_subscriptions where client_id = p_client and status in ('active', 'paused'))
     or exists (select 1 from public.akb_class_attendance a join public.akb_class_sessions s on s.id = a.class_session_id
                where a.client_id = p_client and a.status = 'booked' and s.starts_at > now())
     or exists (select 1 from public.akb_pt_sessions where client_id = p_client and status = 'scheduled' and starts_at > now()) then
    raise exception 'akb:still_active' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(id), '{}') into subs from public.akb_subscriptions where client_id = p_client;

  -- Coaching content (can hold health details).
  delete from public.akb_coaching_messages where subscription_id = any(subs);
  delete from public.akb_coaching_check_ins where subscription_id = any(subs);
  delete from public.akb_coaching_programmes where subscription_id = any(subs);
  delete from public.akb_check_ins where subscription_id = any(subs);

  -- Account access and preferences.
  delete from public.akb_member_sessions where client_id = p_client;
  delete from public.akb_member_login_links where client_id = p_client;
  delete from public.akb_member_settings where client_id = p_client;
  delete from public.akb_member_calendar_feeds where client_id = p_client;
  delete from public.akb_email_changes where client_id = p_client;
  delete from public.akb_client_consents where client_id = p_client;
  delete from public.akb_follow_ups where client_id = p_client;
  delete from public.akb_class_credits where client_id = p_client and used_booking_id is null;

  -- Free text that may name or describe them.
  update public.akb_class_attendance set notes = '' where client_id = p_client and notes <> '';
  update public.akb_pt_sessions set notes = '', requested = '' where client_id = p_client;
  update public.akb_packages set notes = '' where client_id = p_client and notes <> '';
  update public.akb_memberships set notes = '' where client_id = p_client and notes <> '';
  update public.akb_subscriptions set notes = '' where client_id = p_client and notes <> '';
  update public.akb_booking_requests
    set name = 'Deleted client', email = '', phone = '', message = '', details = '{}'::jsonb,
        decision_note = '', alert_subject = '', alert_text = '', alert_error = ''
    where client_id = p_client or (c.email <> '' and lower(email) = lower(c.email));

  update public.akb_clients
    set full_name = 'Deleted client', email = '', phone = '', instagram = '', preferred_contact = '', notes = '',
        status = 'former', erased_at = now(), updated_at = now()
    where id = p_client;
  insert into public.akb_events (client_id, entity, entity_id, action, detail)
    values (p_client, 'client', p_client, 'erased', '{}'::jsonb);
end $$;

revoke all on function public.akb_erase_client(uuid) from public, anon, authenticated;
grant execute on function public.akb_erase_client(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
