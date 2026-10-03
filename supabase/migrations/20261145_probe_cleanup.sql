-- 20261145 — housekeeping for a diagnostic that ran against production.
--
-- While wiring the notification emitters, a probe was pushed to confirm that
-- CREATE OR REPLACE followed by REVOKE behaves as expected on this project.
-- The probe created a temporary function and dropped it again, so nothing was
-- left behind; this file exists so the local migration history matches the
-- versions the database has actually recorded.

do $$
declare
  v_probe record;
begin
  for v_probe in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tmp_probe'
  loop
    execute format('drop function if exists %s', v_probe.signature);
    raise notice 'dropped leftover probe %', v_probe.signature;
  end loop;
end;
$$;