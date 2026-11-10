-- Keep the teacher audit trail, the student history, and the XP wallet on the
-- same immutable source records.  In particular, personal_xp_adjustments was
-- added after the history RPCs and therefore changed the wallet balance without
-- appearing in History or its totals.

drop function if exists public.get_student_account_totals(uuid);

create function public.get_student_account_totals(p_classroom_id uuid default null)
returns table (
  personal_points numeric,
  group_points numeric,
  group_points_earned numeric,
  group_points_deducted numeric,
  group_only_points numeric,
  group_only_earned numeric,
  full_group_points numeric,
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
  ), all_group as (
    select l.* from public.participation_logs l
    where l.classroom_id = v_account.classroom_id
      and l.group_id = v_account.group_id
  ), personal as (
    select
      coalesce(sum(case when m.event_type = 'behavior_penalty' then 0 else m.points_awarded end), 0) as points,
      coalesce(sum(case when m.event_type = 'mission_redemption' then m.xp_spent else 0 end), 0) as spent
    from mine m
  ), group_totals as (
    select
      coalesce(sum(case when g.event_type = 'behavior_penalty' then -abs(g.points_awarded) else g.points_awarded end), 0) as points,
      coalesce(sum(case when g.event_type = 'behavior_penalty' then abs(g.points_awarded) else 0 end), 0) as deducted,
      coalesce(sum(case when g.event_type = 'behavior_penalty' then 0 else g.points_awarded end), 0) as earned
    from whole_group g
  ), full_group as (
    select coalesce(sum(case when g.event_type = 'behavior_penalty' then -abs(g.points_awarded) else g.points_awarded end), 0) as points
    from all_group g
  ), earned_xp as (
    select coalesce(sum(s.xp_earned), 0) + coalesce((
      select sum(a.amount) from public.personal_xp_adjustments a
      where a.classroom_id = v_account.classroom_id
        and a.group_member_id = v_account.group_member_id
    ), 0) as xp
    from public.mission_submissions s
    where s.classroom_id = v_account.classroom_id
      and s.group_member_id = v_account.group_member_id
  ), att as (
    select count(*) filter (where a.status = 'present')::integer as present_days,
      count(*) filter (where a.status <> 'present')::integer as absent_days,
      count(*)::integer as total_days
    from public.attendances a
    where a.classroom_id = v_account.classroom_id
      and a.group_member_id = v_account.group_member_id
  )
  select personal.points, full_group.points,
    group_totals.earned, group_totals.deducted,
    group_totals.points, group_totals.earned, full_group.points,
    earned_xp.xp, personal.spent, greatest(0, earned_xp.xp - personal.spent),
    att.present_days, att.absent_days,
    case when att.total_days = 0 then null else round((att.present_days::numeric / att.total_days) * 100, 1) end
  from personal, group_totals, full_group, earned_xp, att;
end;
$$;

create or replace function public.get_teacher_xp_adjustment_history(p_classroom_id uuid)
returns table (id uuid, group_member_id uuid, amount numeric, reason text, reference text, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.auth_is_teacher_of(p_classroom_id) then
    raise exception 'Only the classroom teacher may view XP adjustment history';
  end if;
  return query
  select a.id, a.group_member_id, a.amount, a.reason, a.reference, a.created_at
  from public.personal_xp_adjustments a
  where a.classroom_id = p_classroom_id
  order by a.created_at desc;
end;
$$;

create or replace function public.get_teacher_point_totals(p_classroom_id uuid)
returns table (
  group_id uuid,
  personal_points numeric,
  group_only_points numeric,
  group_only_earned numeric,
  full_group_points numeric
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.auth_is_teacher_of(p_classroom_id) then
    raise exception 'Only the classroom teacher may view point totals';
  end if;
  return query
  select g.id,
    coalesce(sum(case when l.group_member_id is not null and l.event_type <> 'behavior_penalty' then l.points_awarded else 0 end), 0),
    coalesce(sum(case when l.group_member_id is null then case when l.event_type = 'behavior_penalty' then -abs(l.points_awarded) else l.points_awarded end else 0 end), 0),
    coalesce(sum(case when l.group_member_id is null and l.event_type <> 'behavior_penalty' then greatest(l.points_awarded, 0) else 0 end), 0),
    coalesce(sum(case when l.event_type = 'behavior_penalty' then -abs(l.points_awarded) else l.points_awarded end), 0)
  from public.groups g
  left join public.participation_logs l on l.group_id = g.id and l.classroom_id = p_classroom_id
  where g.classroom_id = p_classroom_id
  group by g.id;
end;
$$;

create or replace function public.get_student_xp_adjustment_history(p_classroom_id uuid default null)
returns table (id uuid, amount numeric, reason text, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_account public.group_accounts%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_account
  from public.group_accounts
  where user_id = v_user and is_approved = true
    and (p_classroom_id is null or classroom_id = p_classroom_id)
  order by created_date asc limit 1;
  if not found then raise exception 'Approved classroom account required'; end if;

  return query
  select a.id, a.amount, a.reason, a.created_at
  from public.personal_xp_adjustments a
  where a.classroom_id = v_account.classroom_id
    and a.group_member_id = v_account.group_member_id
  order by a.created_at desc;
end;
$$;

revoke all on function public.get_student_account_totals(uuid) from public;
grant execute on function public.get_student_account_totals(uuid) to authenticated;
revoke all on function public.get_teacher_xp_adjustment_history(uuid) from public;
grant execute on function public.get_teacher_xp_adjustment_history(uuid) to authenticated;
revoke all on function public.get_teacher_point_totals(uuid) from public;
grant execute on function public.get_teacher_point_totals(uuid) to authenticated;
revoke all on function public.get_student_xp_adjustment_history(uuid) from public;
grant execute on function public.get_student_xp_adjustment_history(uuid) to authenticated;
