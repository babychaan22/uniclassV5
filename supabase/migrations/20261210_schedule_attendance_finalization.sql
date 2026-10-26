-- pg_cron is enabled for this project. Reconcile attendance at 00:01 Manila
-- time (16:01 UTC), after the previous class day has ended.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'uniclass-finalize-attendance') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'uniclass-finalize-attendance'));
  end if;
  perform cron.schedule(
    'uniclass-finalize-attendance',
    '1 16 * * *',
    'select public.reconcile_overdue_attendance_absences()'
  );
end;
$$;
