-- A usual class size for each timetable slot (owner, 2026-11-04).
--
-- Until now one size covered every class (akb_default_class_capacity) and Alex
-- could override a single date. Now each timetable slot (Monday evening,
-- Wednesday evening, Saturday morning) can have its own usual size; a slot
-- without one uses the all-classes size, and a date's own size still wins.
-- Stored as akb_settings rows keyed 'class_capacity:<slot>'. The capacity
-- check, the class overview and the public places left all follow it.
-- Safe to run again.

begin;

-- Setting names may now hold digits, hyphens and a colon (a slot's name is like "mon-evening").
alter table public.akb_settings drop constraint if exists akb_settings_key_check;
alter table public.akb_settings add constraint akb_settings_key_check check (key ~ '^[a-z0-9_:-]{1,80}$');

-- The usual size for one slot: its own, else the all-classes size.
create or replace function public.akb_slot_capacity(p_slot text)
returns integer language sql stable set search_path = public as $$
  select coalesce(
    (select int_value from public.akb_settings where key = 'class_capacity:' || coalesce(p_slot, '')),
    public.akb_default_class_capacity());
$$;

-- Sets a slot's usual size; null removes it (the slot then uses the all-classes size).
create or replace function public.akb_set_slot_capacity(p_slot text, p_capacity integer)
returns void language plpgsql set search_path = public as $$
begin
  if p_slot is null or p_slot !~ '^[a-z0-9][a-z0-9-]{0,39}$' then raise exception 'akb:invalid_slot' using errcode = 'P0001'; end if;
  if p_capacity is null then
    delete from public.akb_settings where key = 'class_capacity:' || p_slot;
    return;
  end if;
  if p_capacity not between 1 and 200 then raise exception 'akb:invalid_capacity' using errcode = 'P0001'; end if;
  insert into public.akb_settings (key, int_value) values ('class_capacity:' || p_slot, p_capacity)
    on conflict (key) do update set int_value = excluded.int_value, updated_at = now();
end $$;

-- Every slot that has its own size: {"mon-evening": 12, ...}.
create or replace function public.akb_slot_capacities()
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(substr(key, length('class_capacity:') + 1), int_value), '{}'::jsonb)
  from public.akb_settings where key like 'class\_capacity:%' escape '\';
$$;

-- The capacity check: a date's own size, else its slot's, else the all-classes size.
create or replace function public.akb_attendance_capacity() returns trigger
language plpgsql set search_path = public as $$
declare
  cap integer;
  taken integer;
begin
  if new.status not in ('booked', 'attended') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('booked', 'attended') and old.class_session_id = new.class_session_id
     and (old.hold_expires_at is null or old.hold_expires_at > now()) then
    return new;
  end if;
  select coalesce(capacity, public.akb_slot_capacity(slot)) into cap from public.akb_class_sessions where id = new.class_session_id for update;
  if cap is null then return new; end if;
  select count(*) into taken from public.akb_class_attendance
    where class_session_id = new.class_session_id and status in ('booked', 'attended')
      and (hold_expires_at is null or hold_expires_at > now()) and id <> new.id;
  if taken >= cap then
    raise exception 'akb:class_full' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace view public.akb_class_overview with (security_invoker = true) as
  select s.id, s.created_at, s.updated_at, s.slot, s.class_date, s.starts_at, s.duration_minutes,
    coalesce(s.capacity, public.akb_slot_capacity(s.slot)) as capacity, s.notes,
    (select count(*) from public.akb_class_attendance a where a.class_session_id = s.id and a.status in ('booked', 'attended')
       and (a.hold_expires_at is null or a.hold_expires_at > now()))::integer as booked,
    (select count(*) from public.akb_class_attendance a where a.class_session_id = s.id and a.status = 'attended')::integer as attended,
    s.cancelled_at, s.cancel_reason,
    s.capacity as capacity_set
  from public.akb_class_sessions s;
revoke all on public.akb_class_overview from public, anon, authenticated;
grant select on public.akb_class_overview to service_role;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('akb_slot_capacity', 'akb_set_slot_capacity', 'akb_slot_capacities')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
