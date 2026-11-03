-- Supabase's security check flagged public.rls_auto_enable() (a SECURITY DEFINER
-- helper that switches row level security on for new tables) as callable by the
-- anon and signed-in roles through /rest/v1/rpc. Nothing in RAENG calls it; it
-- runs from a database event trigger as its owner, which needs no grant. Taking
-- the grants away changes nothing the app does. Safe to run again.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
