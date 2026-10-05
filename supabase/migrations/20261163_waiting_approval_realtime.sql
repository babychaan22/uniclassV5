-- 20261163 — students waiting for a teacher decision receive their own account
-- update immediately instead of polling the database every five seconds.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_accounts'
  ) then
    alter publication supabase_realtime add table public.group_accounts;
  end if;
end;
$$;
