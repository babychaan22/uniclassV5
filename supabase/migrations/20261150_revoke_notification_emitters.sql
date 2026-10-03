-- 20261150 — revoke the notification emitters from signed-in roles.
--
-- The emitters are only ever meant to run from a trigger or another SECURITY
-- DEFINER function. But Supabase pre-grants EXECUTE on new functions to
-- anon, authenticated and service_role, and "revoke ... from public" only
-- removes the implicit PUBLIC grant, not those explicit role grants. So a
-- signed-in student could call notify_classroom or notify_classrooms directly
-- and drop a notification into any teacher's or student's bell, in any
-- classroom, with any title they liked.
--
-- Revoking from the three roles closes that. service_role keeps nothing it
-- needs here: the edge function reads app_notifications directly.
--
-- notify_classroom is the one the emitters call, so it has to stay executable
-- for its owner; the revoke is from anon and authenticated only.

revoke all on function public.notify_classroom(uuid, text, text, text, text, text)
  from anon, authenticated, service_role;
revoke all on function public.notify_classrooms(uuid[], text, text, text, text, text)
  from anon, authenticated, service_role;
revoke all on function public.notify_user(uuid, uuid, text, text, text, text, text)
  from anon, authenticated, service_role;
revoke all on function public.notify_group(uuid, text, text, text, text)
  from anon, authenticated, service_role;
revoke all on function public.notify_member(uuid, text, text, text, text)
  from anon, authenticated, service_role;

do $$
declare
  v_out text;
begin
  select string_agg(
           p.proname || '=' || has_function_privilege('authenticated', p.oid, 'execute')::text,
           ', ' order by p.proname)
    into v_out
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('notify_classroom','notify_classrooms','notify_user','notify_group','notify_member');

  if v_out like '%=true%' then
    raise exception 'a signed-in student can still reach an emitter: %', v_out;
  end if;

  raise notice 'verified: no emitter is reachable from a signed-in student (%s)', v_out;
end;
$$;