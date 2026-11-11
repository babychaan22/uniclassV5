-- These request-id based routines belong to an abandoned parallel points and
-- attendance implementation. They reference columns/constraints that no
-- longer exist, are not used by the application or other database routines,
-- and are still callable by authenticated users. Retire them instead of
-- leaving broken public RPC endpoints beside the supported scan_qr,
-- submit_group_attendance, and participation-ledger flows.

drop function if exists public.redeem_qr(uuid, uuid, uuid, uuid);
drop function if exists public.adjust_member_points(uuid, uuid, uuid, integer, text, text, uuid, jsonb);
drop function if exists public.set_attendance(uuid, uuid, uuid, date, text, text);
drop function if exists public.write_audit_event(uuid, text, text, text, uuid, uuid, jsonb, jsonb, text, uuid, text, text, text, text, jsonb);

-- Trigger helpers are not API endpoints. Pin their lookup path so a caller's
-- session settings can never affect their dependency resolution.
alter function public.current_user_id() set search_path = public, pg_temp;
alter function public.prevent_points_ledger_mutation() set search_path = public, pg_temp;

revoke all on function public.current_user_id() from anon;
revoke all on function public.prevent_points_ledger_mutation() from anon;
