-- Prepared locally only: repairs the ambiguous output-column reference in the
-- student ledger totals function. Apply with the next approved Supabase release.

create or replace function public.get_student_account_totals(p_classroom_id uuid default null)
returns table (
  personal_points numeric,
  group_points numeric,
  group_points_earned numeric,
  group_points_deducted numeric,
  xp_earned numeric,
  xp_spent numeric,
  xp_available numeric,
  present_days integer,
  absent_days integer,
  attendance_rate numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_account public.group_accounts%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_account
  from public.group_accounts
  where user_id = v_user and is_approved = true
    and (p_classroom_id is null or classroom_id = p_classroom_id)
  order by created_date asc
  limit 1;

  if not found then raise exception 'Approved classroom account required'; end if;

  return query
  with mine as (
    select l.* from public.participation_logs l
    where l.classroom_id = v_account.classroom_id
      and l.group_id = v_account.group_id
      and l.group_member_id = v_account.group_member_id
  ), whole_group as (
    select l.* from public.participation_logs l
    where l.classroom_id = v_account.classroom_id
      and l.group_id = v_account.group_id
      and l.group_member_id is null
  ), personal as (
    select
      coalesce(sum(case when m.event_type = 'behavior_penalty' then -abs(m.points_awarded) else m.points_awarded end), 0) as points,
      coalesce(sum(m.xp_spent), 0) as spent
    from mine m
  ), group_totals as (
    select
      coalesce(sum(case when g.event_type = 'behavior_penalty' then -abs(g.points_awarded) else g.points_awarded end), 0) as points,
      coalesce(sum(case when g.event_type = 'behavior_penalty' then abs(g.points_awarded) else 0 end), 0) as deducted,
      coalesce(sum(case when g.event_type = 'behavior_penalty' then 0 else g.points_awarded end), 0) as earned
    from whole_group g
  ), earned_xp as (
    select coalesce(sum(s.xp_earned), 0) as xp
    from public.mission_submissions s
    where s.classroom_id = v_account.classroom_id
      and s.group_member_id = v_account.group_member_id
  ), att as (
    select
      count(*) filter (where a.status = 'present')::integer as present_days,
      count(*) filter (where a.status <> 'present')::integer as absent_days,
      count(*)::integer as total_days
    from public.attendances a
    where a.classroom_id = v_account.classroom_id
      and a.group_member_id = v_account.group_member_id
  )
  select
    personal.points,
    personal.points + group_totals.points,
    group_totals.earned,
    group_totals.deducted,
    earned_xp.xp,
    personal.spent,
    greatest(0, earned_xp.xp - personal.spent),
    att.present_days,
    att.absent_days,
    case when att.total_days = 0 then null
         else round((att.present_days::numeric / att.total_days) * 100, 1)
    end
  from personal, group_totals, earned_xp, att;
end;
$$;

revoke all on function public.get_student_account_totals(uuid) from public;
grant execute on function public.get_student_account_totals(uuid) to authenticated;
