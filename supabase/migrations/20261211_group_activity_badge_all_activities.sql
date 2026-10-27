-- The 90% Activity Squad badge is a group accomplishment, not an individual
-- one.  A group qualifies only when its combined score is at least 90% on
-- the combined total of every published activity from Activity 1 through the
-- latest activity.
-- Missing group-member scores count as zero so an unfinished activity cannot
-- accidentally qualify the group.

-- A zero is a real submitted score.  Absence is deliberately a separate
-- state, so an approved group representative can exclude an absent learner
-- from this activity's possible-score total without disguising that absence as
-- a zero.
alter table public.activity_scores
  add column if not exists is_absent boolean not null default false;

create or replace function public.submit_group_activity_scores(
  p_activity_id uuid,
  p_scores jsonb
)
returns setof public.activity_scores
language plpgsql
security definer
set search_path = public, pg_temp as $$
declare
  v_activity public.activities%rowtype;
  v_account public.group_accounts%rowtype;
  v_entry jsonb;
  v_member_id uuid;
  v_score numeric;
  v_absent boolean;
  v_expected integer;
  v_received integer;
begin
  select * into v_activity from public.activities where id = p_activity_id for update;
  if not found then raise exception 'Activity not found'; end if;

  select * into v_account from public.group_accounts
  where user_id = auth.uid()
    and classroom_id = v_activity.classroom_id
    and is_approved = true
    and is_representative = true
  order by created_date asc
  limit 1;
  if not found then raise exception 'Only the approved group representative can submit activity scores'; end if;
  if jsonb_typeof(p_scores) <> 'array' then raise exception 'Scores must be a list'; end if;

  select count(*) into v_expected
  from public.group_members gm
  where gm.group_id = v_account.group_id and coalesce(gm.is_transferred, false) = false;
  select count(distinct nullif(v.value ->> 'group_member_id', '')::uuid) into v_received
  from jsonb_array_elements(p_scores) v(value);
  if v_expected = 0 or v_received <> v_expected or jsonb_array_length(p_scores) <> v_expected then
    raise exception 'Enter a score, including zero, or mark absent for every active group member';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_scores) v(value)
    left join public.group_members gm on gm.id = nullif(v.value ->> 'group_member_id', '')::uuid
    where gm.id is null or gm.group_id <> v_account.group_id or coalesce(gm.is_transferred, false)
  ) then raise exception 'Every submitted learner must be an active member of your group'; end if;
  if exists (
    select 1 from public.activity_scores s
    where s.activity_id = p_activity_id and s.group_id = v_account.group_id
  ) then raise exception 'This group has already submitted scores for this activity'; end if;
  if not exists (
    select 1 from public.activity_evidence e
    where e.activity_id = p_activity_id and e.group_id = v_account.group_id and e.group_member_id is null
  ) then raise exception 'Upload at least one group proof image before submitting scores'; end if;

  for v_entry in select value from jsonb_array_elements(p_scores) loop
    v_member_id := (v_entry ->> 'group_member_id')::uuid;
    v_absent := coalesce((v_entry ->> 'is_absent')::boolean, false);
    v_score := coalesce((v_entry ->> 'score')::numeric, 0);
    if v_score < 0 or v_score > coalesce(v_activity.max_score, 0) then
      raise exception 'A score must be between zero and %', v_activity.max_score;
    end if;
    if v_absent then v_score := 0; end if;

    return query
    insert into public.activity_scores(
      classroom_id, group_id, group_member_id, activity_id, score, is_absent, encoded_by
    ) values (
      v_activity.classroom_id, v_account.group_id, v_member_id, p_activity_id,
      v_score, v_absent, auth.uid()
    ) returning *;
  end loop;
end;
$$;

revoke all on function public.submit_group_activity_scores(uuid, jsonb) from public;
grant execute on function public.submit_group_activity_scores(uuid, jsonb) to authenticated;

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
  v_activity record;
  v_activity_count integer := 0;
  v_missing_score_cells integer := 0;
  v_all_activity_score numeric := 0;
  v_all_activity_possible numeric := 0;
  v_score numeric;
  v_scored_members integer;
  v_absent_members integer;
  v_activity_possible numeric;
  v_group_activity_pct numeric := 0;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_account from public.group_accounts
    where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then
    raise exception 'Approved classroom account required';
  end if;

  select * into v_group from public.groups where id = p_group_id;
  if not found then raise exception 'Invalid group'; end if;

  -- Keep attendance badge data current while this shared eligibility RPC runs.
  perform public.reconcile_overdue_attendance_absences(v_group.classroom_id);
  v_week := v_today - extract(isodow from v_today)::integer + 1;
  v_week_end := v_week + 6;

  select coalesce(nullif(c.class_days, '{}'::text[]), array['1','2','3','4','5'])
    into v_class_days
  from public.classrooms c where c.id = v_group.classroom_id;

  select count(*) into v_members
  from public.group_members gm
  where gm.group_id = p_group_id and coalesce(gm.is_transferred, false) = false;

  -- Add the group scores across every activity.  This is intentionally not
  -- limited to the current week: Activity 1 through the latest published
  -- activity form one combined group percentage.
  for v_activity in
    select a.id, a.activity_number, coalesce(a.max_score, 0)::numeric as max_score
    from public.activities a
    where a.classroom_id = v_group.classroom_id
      and coalesce(a.is_published, true) = true
      and coalesce(a.activity_number, 0) >= 1
      and a.created_date::date <= v_today
    order by a.activity_number, a.created_date, a.id
  loop
    v_activity_count := v_activity_count + 1;
    select coalesce(sum(s.score) filter (where not coalesce(s.is_absent, false)), 0),
           count(s.id) filter (where not coalesce(s.is_absent, false)),
           count(s.id) filter (where coalesce(s.is_absent, false))
      into v_score, v_scored_members, v_absent_members
    from public.group_members gm
    left join public.activity_scores s
      on s.group_member_id = gm.id and s.activity_id = v_activity.id
    where gm.group_id = p_group_id
      and coalesce(gm.is_transferred, false) = false;

    v_activity_possible := greatest(v_members - v_absent_members, 0) * v_activity.max_score;

    v_all_activity_score := v_all_activity_score + v_score;
    v_all_activity_possible := v_all_activity_possible + v_activity_possible;
    v_missing_score_cells := v_missing_score_cells + greatest(v_members - v_absent_members - v_scored_members, 0);
  end loop;

  if v_all_activity_possible > 0 then
    v_group_activity_pct := (v_all_activity_score / v_all_activity_possible) * 100;
  end if;

  select count(*) into v_expected_per_member
  from generate_series(v_week, least(v_week_end, v_today - 1), interval '1 day') d(day)
  where extract(isodow from d.day)::text = any(v_class_days);
  v_expected := v_members * v_expected_per_member;

  select count(*) filter (where a.status = 'present'), count(*) into v_present, v_marked
  from public.attendances a
  where a.group_id = p_group_id
    and a.attendance_date between v_week and least(v_week_end, v_today - 1);

  select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)), 0)
    into v_group_total
  from public.participation_logs l
  where l.group_id = p_group_id and l.created_date::date between v_week and v_week_end;

  select max(total) into v_max_group_total from (
    select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)), 0) as total
    from public.groups g
    left join public.participation_logs l
      on l.group_id = g.id and l.created_date::date between v_week and v_week_end
    where g.classroom_id = v_group.classroom_id
    group by g.id
  ) totals;

  select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)), 0)
    into v_member_total
  from public.participation_logs l
  where l.group_member_id = v_account.group_member_id
    and l.created_date::date between v_week and v_week_end;

  select max(total) into v_max_member_total from (
    select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)), 0) as total
    from public.group_members gm
    left join public.participation_logs l
      on l.group_member_id = gm.id and l.created_date::date between v_week and v_week_end
    where gm.classroom_id = v_group.classroom_id and coalesce(gm.is_transferred, false) = false
    group by gm.id
  ) totals;

  foreach v_badge_type in array array[
    'weekly_90_activity', 'weekly_full_attendance',
    'weekly_top_group_points', 'weekly_top_individual_points'
  ] loop
    v_eligible := false;
    v_reason := '';
    v_metric := '{}'::jsonb;

    if v_badge_type = 'weekly_90_activity' then
      v_eligible := v_activity_count > 0 and v_group_activity_pct >= 90;
      v_metric := jsonb_build_object(
        'group_activity_pct', round(v_group_activity_pct, 1),
        'activities', v_activity_count,
        'missing_scores', v_missing_score_cells,
        'members', v_members
      );
      v_reason := case
        when v_activity_count = 0 then 'No published activities are available yet.'
        when v_group_activity_pct >= 90 then 'Your group total is ' || round(v_group_activity_pct, 1) || '% across Activities 1–' || v_activity_count || '.'
        when v_missing_score_cells > 0 then v_missing_score_cells || ' group score(s) are still missing. Missing scores count as zero in the group total.'
        else 'Your group total is ' || round(v_group_activity_pct, 1) || '% across Activities 1–' || v_activity_count || '. Reach 90% or higher to qualify.'
      end;
    elsif v_badge_type = 'weekly_full_attendance' then
      v_eligible := v_expected > 0 and v_marked = v_expected and v_present = v_expected;
      v_metric := jsonb_build_object(
        'present', v_present, 'marked', v_marked, 'expected', v_expected,
        'scheduled_days_per_member', v_expected_per_member
      );
      v_reason := case
        when v_expected = 0 then 'No scheduled class day has finished this week yet.'
        when v_marked < v_expected then (v_expected - v_marked) || ' scheduled attendance record(s) are still missing.'
        when v_present < v_expected then (v_expected - v_present) || ' absence(s) recorded this week.'
        else 'Every active group member was present on every finished class day this week.'
      end;
    elsif v_badge_type = 'weekly_top_group_points' then
      v_eligible := v_group_total > 0 and v_group_total = v_max_group_total;
      v_metric := jsonb_build_object('group_points', round(v_group_total, 2), 'top_group_points', round(v_max_group_total, 2));
      v_reason := case
        when v_group_total <= 0 then 'Your group has no points this week yet.'
        when v_eligible then 'Your group is top of the class with ' || round(v_group_total, 2) || ' points this week.'
        else 'Another group is ahead with ' || round(v_max_group_total, 2) || ' points this week.'
      end;
    else
      v_eligible := v_member_total > 0 and v_member_total = v_max_member_total;
      v_metric := jsonb_build_object('your_points', round(v_member_total, 2), 'top_points', round(v_max_member_total, 2));
      v_reason := case
        when v_member_total <= 0 then 'You have no points this week yet.'
        when v_eligible then 'You are top of the class with ' || round(v_member_total, 2) || ' points this week.'
        else 'Someone is ahead with ' || round(v_max_member_total, 2) || ' points this week.'
      end;
    end if;

    select b.approval_status into v_requested
    from public.badges b
    where b.group_id = p_group_id and b.badge_type = v_badge_type and b.week_start_date = v_week;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'badgeType', v_badge_type, 'eligible', v_eligible, 'reason', v_reason,
      'metric', v_metric, 'requested', v_requested, 'weekStart', v_week
    ));
  end loop;
  return v_out;
end;
$$;

revoke all on function public.get_badge_eligibility(uuid) from public;
grant execute on function public.get_badge_eligibility(uuid) to authenticated;
