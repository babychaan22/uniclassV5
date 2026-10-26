-- Attendance must be complete before a group can receive a full-attendance
-- badge.  A scheduled class day with no submitted record becomes absent after
-- the day closes.  The reconciliation also runs immediately before badge
-- eligibility is calculated, so a missed record cannot be used to bypass the
-- badge rule.

create or replace function public.reconcile_overdue_attendance_absences(
  p_classroom_id uuid default null,
  p_through_date date default ((now() at time zone 'Asia/Manila')::date - 1)
)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_classroom public.classrooms%rowtype;
  v_start_date date;
  v_inserted integer := 0;
  v_rows integer := 0;
begin
  if auth.uid() is not null and p_classroom_id is null then
    raise exception 'Choose a classroom when reconciling attendance';
  end if;

  for v_classroom in
    select * from public.classrooms c
    where p_classroom_id is null or c.id = p_classroom_id
  loop
    if auth.uid() is not null
      and not public.auth_is_teacher_of(v_classroom.id)
      and not exists (
        select 1 from public.group_accounts ga
        where ga.user_id = auth.uid() and ga.classroom_id = v_classroom.id and ga.is_approved = true
      ) then
      raise exception 'You cannot reconcile attendance for this classroom';
    end if;

    -- Only the current badge week is backfilled.  This prevents a newly
    -- created class or roster entry from being marked absent for old history.
    v_start_date := p_through_date - extract(isodow from p_through_date)::integer + 1;
    if p_through_date < v_start_date then continue; end if;

    perform pg_advisory_xact_lock(hashtextextended(v_classroom.id::text, 0));
    insert into public.attendances(classroom_id, group_id, group_member_id, attendance_date, status)
    select v_classroom.id, gm.group_id, gm.id, d.day::date, 'absent'
    from public.group_members gm
    cross join lateral generate_series(v_start_date, p_through_date, interval '1 day') as d(day)
    where gm.classroom_id = v_classroom.id
      and coalesce(gm.is_transferred, false) = false
      and extract(isodow from d.day)::text = any(coalesce(nullif(v_classroom.class_days, '{}'::text[]), array['1','2','3','4','5']))
      and not exists (
        select 1 from public.attendances a
        where a.classroom_id = v_classroom.id
          and a.group_member_id = gm.id
          and a.attendance_date = d.day::date
      );
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;
  end loop;
  return v_inserted;
end;
$$;

create or replace function public.get_badge_eligibility(p_group_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_account public.group_accounts%rowtype;
  v_group public.groups%rowtype;
  v_week date;
  v_week_end date;
  v_member public.group_members%rowtype;
  v_score numeric;
  v_max_score numeric;
  v_weakest numeric := 100;
  v_failing integer := 0;
  v_group_total numeric;
  v_max_group_total numeric;
  v_member_total numeric;
  v_max_member_total numeric;
  v_present integer;
  v_marked integer;
  v_expected integer;
  v_expected_per_member integer;
  v_members integer;
  v_out jsonb := '[]'::jsonb;
  v_badge_type text;
  v_eligible boolean;
  v_reason text;
  v_metric jsonb;
  v_requested text;
  v_class_days text[];
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_account from public.group_accounts
    where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved classroom account required'; end if;
  select * into v_group from public.groups where id = p_group_id;
  if not found then raise exception 'Invalid group'; end if;

  perform public.reconcile_overdue_attendance_absences(v_group.classroom_id);
  v_week := v_today - extract(isodow from v_today)::integer + 1;
  v_week_end := v_week + 6;
  select coalesce(nullif(c.class_days, '{}'::text[]), array['1','2','3','4','5']) into v_class_days
    from public.classrooms c where c.id = v_group.classroom_id;
  select count(*) into v_members from public.group_members gm
    where gm.group_id = p_group_id and coalesce(gm.is_transferred, false) = false;
  select count(*) into v_expected_per_member
  from generate_series(v_week, least(v_week_end, v_today - 1), interval '1 day') d(day)
  where extract(isodow from d.day)::text = any(v_class_days);
  v_expected := v_members * v_expected_per_member;

  for v_member in select * from public.group_members where group_id = p_group_id and coalesce(is_transferred, false) = false loop
    select coalesce(sum(s.score), 0), coalesce(sum(a.max_score), 0)
      into v_score, v_max_score
    from public.activity_scores s
    join public.activities a on a.id = s.activity_id
    where s.group_member_id = v_member.id and s.created_date::date between v_week and v_week_end;
    if v_max_score = 0 then v_failing := v_failing + 1; v_weakest := 0;
    else
      v_weakest := least(v_weakest, (v_score / v_max_score) * 100);
      if v_score / v_max_score < 0.9 then v_failing := v_failing + 1; end if;
    end if;
  end loop;

  select count(*) filter (where a.status = 'present'), count(*) into v_present, v_marked
  from public.attendances a
  where a.group_id = p_group_id and a.attendance_date between v_week and least(v_week_end, v_today - 1);

  select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)), 0) into v_group_total
  from public.participation_logs l where l.group_id = p_group_id and l.created_date::date between v_week and v_week_end;
  select max(total) into v_max_group_total from (
    select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)), 0) as total
    from public.groups g left join public.participation_logs l on l.group_id = g.id and l.created_date::date between v_week and v_week_end
    where g.classroom_id = v_group.classroom_id group by g.id
  ) totals;
  select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)), 0) into v_member_total
  from public.participation_logs l where l.group_member_id = v_account.group_member_id and l.created_date::date between v_week and v_week_end;
  select max(total) into v_max_member_total from (
    select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)), 0) as total
    from public.group_members gm left join public.participation_logs l on l.group_member_id = gm.id and l.created_date::date between v_week and v_week_end
    where gm.classroom_id = v_group.classroom_id and coalesce(gm.is_transferred, false) = false group by gm.id
  ) totals;

  foreach v_badge_type in array array['weekly_90_activity', 'weekly_full_attendance', 'weekly_top_group_points', 'weekly_top_individual_points'] loop
    v_eligible := false; v_reason := ''; v_metric := '{}'::jsonb;
    if v_badge_type = 'weekly_90_activity' then
      v_eligible := v_failing = 0;
      v_metric := jsonb_build_object('weakest_member_pct', round(v_weakest, 1), 'members_below_90', v_failing, 'members', v_members);
      v_reason := case when v_failing = 0 then 'Every member is at 90% or higher this week.' else v_failing || ' member(s) below 90%. The lowest is at ' || round(v_weakest, 1) || '%.' end;
    elsif v_badge_type = 'weekly_full_attendance' then
      v_eligible := v_expected > 0 and v_marked = v_expected and v_present = v_expected;
      v_metric := jsonb_build_object('present', v_present, 'marked', v_marked, 'expected', v_expected, 'scheduled_days_per_member', v_expected_per_member);
      v_reason := case
        when v_expected = 0 then 'No scheduled class day has finished this week yet.'
        when v_marked < v_expected then (v_expected - v_marked) || ' scheduled attendance record(s) are still missing.'
        when v_present < v_expected then (v_expected - v_present) || ' absence(s) recorded this week.'
        else 'Every active group member was present on every finished class day this week.'
      end;
    elsif v_badge_type = 'weekly_top_group_points' then
      v_eligible := v_group_total > 0 and v_group_total = v_max_group_total;
      v_metric := jsonb_build_object('group_points', round(v_group_total, 2), 'top_group_points', round(v_max_group_total, 2));
      v_reason := case when v_group_total <= 0 then 'Your group has no points this week yet.' when v_eligible then 'Your group is top of the class with ' || round(v_group_total, 2) || ' points this week.' else 'Another group is ahead with ' || round(v_max_group_total, 2) || ' points this week.' end;
    else
      v_eligible := v_member_total > 0 and v_member_total = v_max_member_total;
      v_metric := jsonb_build_object('your_points', round(v_member_total, 2), 'top_points', round(v_max_member_total, 2));
      v_reason := case when v_member_total <= 0 then 'You have no points this week yet.' when v_eligible then 'You are top of the class with ' || round(v_member_total, 2) || ' points this week.' else 'Someone is ahead with ' || round(v_max_member_total, 2) || ' points this week.' end;
    end if;
    select b.approval_status into v_requested from public.badges b where b.group_id = p_group_id and b.badge_type = v_badge_type and b.week_start_date = v_week;
    v_out := v_out || jsonb_build_array(jsonb_build_object('badgeType', v_badge_type, 'eligible', v_eligible, 'reason', v_reason, 'metric', v_metric, 'requested', v_requested, 'weekStart', v_week));
  end loop;
  return v_out;
end;
$$;

-- Reuse the exact eligibility result at the point of request.  This prevents
-- a caller from bypassing the dashboard and claiming a badge through the RPC.
create or replace function public.redeem_badge(p_group_id uuid, p_badge_type text)
returns public.badges language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_group public.groups%rowtype;
  v_account public.group_accounts%rowtype;
  v_badge public.badges%rowtype;
  v_week date;
  v_eligible boolean := false;
  v_snapshot jsonb;
  v_entry jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_badge_type not in ('weekly_90_activity','weekly_full_attendance','weekly_top_group_points','weekly_top_individual_points') then raise exception 'Invalid badge type'; end if;
  if extract(dow from (now() at time zone 'Asia/Manila')) not in (0, 6) then raise exception 'Badges are only available at the end of the week (Saturday–Sunday).'; end if;
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then raise exception 'Invalid group'; end if;
  select * into v_account from public.group_accounts where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if not found then raise exception 'Approved classroom account required'; end if;

  select item into v_entry from jsonb_array_elements(public.get_badge_eligibility(p_group_id)) item
  where item ->> 'badgeType' = p_badge_type;
  v_eligible := coalesce((v_entry ->> 'eligible')::boolean, false);
  if not v_eligible then
    raise exception '%', coalesce(v_entry ->> 'reason', 'Not eligible for this badge this week.');
  end if;

  v_week := (now() at time zone 'Asia/Manila')::date - extract(isodow from (now() at time zone 'Asia/Manila'))::integer + 1;
  v_snapshot := public.badge_request_snapshot(v_group.classroom_id, p_group_id, v_account.group_member_id, v_week);
  select * into v_badge from public.badges where group_id = p_group_id and badge_type = p_badge_type and week_start_date = v_week for update;
  if found then
    if v_badge.approval_status in ('pending','approved') then raise exception 'This badge has already been requested this week.'; end if;
    update public.badges set approval_status = 'pending', redeemed_by = v_user, reviewed_by = null, reviewed_at = null, points_awarded = 10, request_snapshot = v_snapshot
      where id = v_badge.id returning * into v_badge;
  else
    insert into public.badges(group_id, classroom_id, badge_type, week_start_date, points_awarded, redeemed_by, approval_status, request_snapshot)
      values(p_group_id, v_group.classroom_id, p_badge_type, v_week, 10, v_user, 'pending', v_snapshot)
      returning * into v_badge;
  end if;
  return v_badge;
end;
$$;

-- Supabase projects normally include pg_cron.  When it is enabled, reconcile
-- attendance one minute after midnight Manila time.  Badge checks remain a
-- secure fallback if the scheduler is unavailable.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute 'select cron.schedule(''uniclass-finalize-attendance'', ''1 16 * * *'', ''select public.reconcile_overdue_attendance_absences()'')';
  else
    raise notice 'pg_cron is unavailable; badge eligibility will still reconcile overdue attendance.';
  end if;
end;
$$;

revoke all on function public.reconcile_overdue_attendance_absences(uuid, date) from public;
grant execute on function public.reconcile_overdue_attendance_absences(uuid, date) to authenticated;
revoke all on function public.get_badge_eligibility(uuid) from public;
grant execute on function public.get_badge_eligibility(uuid) to authenticated;
