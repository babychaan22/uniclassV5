-- 20261139 — badge eligibility, and the numbers behind every badge request.
--
-- Two things the badge flow was missing.
--
-- 1. Eligibility was decided with a bare sum(points_awarded). Behavior
--    penalties are stored positive and read as deductions everywhere else, so a
--    penalised group could still win "top group points" and a penalised student
--    could still win "top individual points". The sums below use the same
--    signed convention as the leaderboards and the student history.
--
-- 2. A teacher approving a badge could see who asked and for which badge, but
--    not what the requester looked like at the moment they asked. Points move
--    every day, so by approval time the evidence is gone. request_snapshot
--    records the requester's week at request time, and the teacher queue shows
--    it.
--
-- get_badge_eligibility() is the single source of truth for "can this student
-- ask for this badge right now", with the reason and the numbers behind the
-- answer. The student page renders it and refuses to offer an ineligible badge;
-- redeem_badge() still enforces it, so the rule holds even if the UI is bypassed.

alter table public.badges
  add column if not exists request_snapshot jsonb;

comment on column public.badges.request_snapshot is
  'Week-in-progress stats for the requester, captured when the badge was requested, so approval can see why they believed they qualified.';

-- ── A single definition of "signed points" for the badge maths ────────────
create or replace function public.signed_participation_points(p_event_type text, p_points numeric)
returns numeric
language sql
immutable
as $$
  select case when p_event_type = 'behavior_penalty' then -abs(p_points) else p_points end;
$$;

-- ── The requester's week, captured once ───────────────────────────────────
create or replace function public.badge_request_snapshot(
  p_classroom_id uuid,
  p_group_id uuid,
  p_member_id uuid,
  p_week date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public as $$
declare
  v_week_end date := p_week + 6;
  v_points numeric;
  v_group_points numeric;
  v_present integer;
  v_marked integer;
  v_score numeric;
  v_max_score numeric;
  v_group_score numeric;
  v_group_max numeric;
begin
  select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)), 0)
    into v_points
  from public.participation_logs l
  where l.group_member_id = p_member_id
    and l.created_date::date between p_week and v_week_end;

  select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)), 0)
    into v_group_points
  from public.participation_logs l
  where l.group_id = p_group_id
    and l.created_date::date between p_week and v_week_end;

  select
      count(*) filter (where a.status = 'present'),
      count(*)
    into v_present, v_marked
  from public.attendances a
  where a.group_member_id = p_member_id
    and a.attendance_date between p_week and v_week_end;

  select coalesce(sum(s.score), 0), coalesce(sum(a.max_score), 0)
    into v_score, v_max_score
  from public.activity_scores s
  join public.activities a on a.id = s.activity_id
  where s.group_member_id = p_member_id
    and s.created_date::date between p_week and v_week_end;

  select coalesce(sum(s.score), 0), coalesce(sum(a.max_score), 0)
    into v_group_score, v_group_max
  from public.activity_scores s
  join public.activities a on a.id = s.activity_id
  join public.group_members gm on gm.id = s.group_member_id
  where gm.group_id = p_group_id
    and s.created_date::date between p_week and v_week_end;

  return jsonb_build_object(
    'week_start', p_week,
    'points_week', round(v_points, 2),
    'group_points_week', round(v_group_points, 2),
    'attendance_present', v_present,
    'attendance_marked', v_marked,
    'activity_pct', case when v_max_score > 0 then round((v_score / v_max_score) * 100) else null end,
    'group_activity_pct', case when v_group_max > 0 then round((v_group_score / v_group_max) * 100) else null end
  );
end;
$$;

revoke all on function public.signed_participation_points(text, numeric) from public;
revoke all on function public.badge_request_snapshot(uuid, uuid, uuid, date) from public;
grant execute on function public.badge_request_snapshot(uuid, uuid, uuid, date) to authenticated;

-- ── Eligibility, with the reason and the numbers behind it ────────────────
create or replace function public.get_badge_eligibility(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public as $$
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
  v_unmarked integer;
  v_out jsonb := '[]'::jsonb;
  v_badge_type text;
  v_eligible boolean;
  v_reason text;
  v_metric jsonb;
  v_requested text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_account from public.group_accounts
    where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if not found then raise exception 'Approved classroom account required'; end if;
  if v_account.group_member_id is null then raise exception 'Approved classroom account required'; end if;

  select * into v_group from public.groups where id = p_group_id;
  if not found then raise exception 'Invalid group'; end if;

  v_week := (now() at time zone 'Asia/Manila')::date - extract(isodow from (now() at time zone 'Asia/Manila'))::integer + 1;
  v_week_end := v_week + 6;

  -- 90% activity across the group.
  for v_member in
    select * from public.group_members where group_id = p_group_id
  loop
    select coalesce(sum(s.score), 0), coalesce(sum(a.max_score), 0)
      into v_score, v_max_score
    from public.activity_scores s
    join public.activities a on a.id = s.activity_id
    where s.group_member_id = v_member.id
      and s.created_date::date between v_week and v_week_end;

    if v_max_score = 0 then
      v_failing := v_failing + 1;
      v_weakest := 0;
    else
      v_weakest := least(v_weakest, (v_score / v_max_score) * 100);
      if v_score / v_max_score < 0.9 then v_failing := v_failing + 1; end if;
    end if;
  end loop;

  -- Attendance, both the marked records and any member with none at all.
  select
      count(*) filter (where a.status = 'present'),
      count(*)
    into v_present, v_marked
  from public.attendances a
  where a.group_id = p_group_id
    and a.attendance_date between v_week and v_week_end;

  select count(*) into v_unmarked
  from public.group_members gm
  where gm.group_id = p_group_id
    and not exists (
      select 1 from public.attendances a
      where a.group_member_id = gm.id and a.attendance_date between v_week and v_week_end
    );

  -- Weekly points, penalties counted as deductions.
  select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)), 0) into v_group_total
  from public.participation_logs l
  where l.group_id = p_group_id and l.created_date::date between v_week and v_week_end;

  select max(total) into v_max_group_total
  from (
    select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)), 0) as total
    from public.groups g
    left join public.participation_logs l
      on l.group_id = g.id and l.created_date::date between v_week and v_week_end
    where g.classroom_id = v_group.classroom_id
    group by g.id
  ) totals;

  select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)), 0) into v_member_total
  from public.participation_logs l
  where l.group_member_id = v_account.group_member_id
    and l.created_date::date between v_week and v_week_end;

  select max(total) into v_max_member_total
  from (
    select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)), 0) as total
    from public.group_members gm
    left join public.participation_logs l
      on l.group_member_id = gm.id and l.created_date::date between v_week and v_week_end
    where gm.classroom_id = v_group.classroom_id
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
      v_eligible := v_failing = 0;
      v_metric := jsonb_build_object(
        'weakest_member_pct', round(v_weakest, 1),
        'members_below_90', v_failing,
        'members', (select count(*) from public.group_members where group_id = p_group_id)
      );
      v_reason := case
        when v_failing = 0 then 'Every member is at 90% or higher this week.'
        else v_failing || ' member(s) below 90%. The lowest is at ' || round(v_weakest, 1) || '%.'
      end;
    elsif v_badge_type = 'weekly_full_attendance' then
      v_eligible := v_marked > 0 and v_present = v_marked and v_unmarked = 0;
      v_metric := jsonb_build_object(
        'present', v_present,
        'marked', v_marked,
        'members_without_mark', v_unmarked
      );
      v_reason := case
        when v_marked = 0 then 'No attendance has been marked this week yet.'
        when v_unmarked > 0 then v_unmarked || ' member(s) have no attendance marked this week.'
        when v_present < v_marked then (v_marked - v_present) || ' absence(s) recorded this week.'
        else 'Every marked member was present this week.'
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
      'badgeType', v_badge_type,
      'eligible', v_eligible,
      'reason', v_reason,
      'metric', v_metric,
      'requested', v_requested,
      'weekStart', v_week
    ));
  end loop;

  return v_out;
end;
$$;

revoke all on function public.get_badge_eligibility(uuid) from public;
grant execute on function public.get_badge_eligibility(uuid) to authenticated;

-- ── Requesting records the snapshot ───────────────────────────────────────
create or replace function public.redeem_badge(p_group_id uuid, p_badge_type text)
returns public.badges language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_group public.groups%rowtype; v_account public.group_accounts%rowtype; v_member public.group_members%rowtype;
  v_badge public.badges%rowtype; v_week date; v_week_end date; v_eligible boolean := false;
  v_score numeric; v_max_score numeric; v_group_total numeric; v_max_group_total numeric; v_member_total numeric; v_max_member_total numeric;
  v_present integer; v_marked integer; v_unmarked integer;
  v_snapshot jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_badge_type not in ('weekly_90_activity','weekly_full_attendance','weekly_top_group_points','weekly_top_individual_points') then raise exception 'Invalid badge type'; end if;
  if extract(dow from (now() at time zone 'Asia/Manila')) not in (0, 6) then raise exception 'Badges are only available at the end of the week (Saturday–Sunday).'; end if;
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then raise exception 'Invalid group'; end if;
  select * into v_account from public.group_accounts where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if not found then raise exception 'Approved classroom account required'; end if;
  v_week := (now() at time zone 'Asia/Manila')::date - extract(isodow from (now() at time zone 'Asia/Manila'))::integer + 1;
  v_week_end := v_week + 6;

  if p_badge_type = 'weekly_90_activity' then
    v_eligible := true;
    for v_member in select * from public.group_members where group_id = p_group_id loop
      select coalesce(sum(s.score), 0), coalesce(sum(a.max_score), 0) into v_score, v_max_score from public.activity_scores s join public.activities a on a.id=s.activity_id where s.group_member_id=v_member.id and s.created_date::date between v_week and v_week_end;
      if v_max_score = 0 or v_score / v_max_score < .9 then v_eligible := false; exit; end if;
    end loop;
  elsif p_badge_type = 'weekly_full_attendance' then
    select count(*) filter (where a.status='present'), count(*) into v_present, v_marked from public.attendances a where a.group_id=p_group_id and a.attendance_date between v_week and v_week_end;
    select count(*) into v_unmarked from public.group_members gm where gm.group_id=p_group_id and not exists (select 1 from public.attendances a where a.group_member_id=gm.id and a.attendance_date between v_week and v_week_end);
    v_eligible := v_marked > 0 and v_present = v_marked and v_unmarked = 0;
  elsif p_badge_type = 'weekly_top_group_points' then
    select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)),0) into v_group_total from public.participation_logs l where l.group_id=p_group_id and l.created_date::date between v_week and v_week_end;
    select max(total) into v_max_group_total from (select g.id,coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)),0) total from public.groups g left join public.participation_logs l on l.group_id=g.id and l.created_date::date between v_week and v_week_end where g.classroom_id=v_group.classroom_id group by g.id) totals;
    v_eligible := v_group_total > 0 and v_group_total=v_max_group_total;
  else
    select max(total) into v_max_member_total from (select gm.id,coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)),0) total from public.group_members gm left join public.participation_logs l on l.group_member_id=gm.id and l.created_date::date between v_week and v_week_end where gm.classroom_id=v_group.classroom_id group by gm.id) totals;
    select coalesce(sum(public.signed_participation_points(l.event_type, l.points_awarded)),0) into v_member_total from public.participation_logs l where l.group_member_id=v_account.group_member_id and l.created_date::date between v_week and v_week_end;
    v_eligible := v_member_total > 0 and v_member_total=v_max_member_total;
  end if;
  if not v_eligible then raise exception 'Not eligible for this badge this week.'; end if;

  v_snapshot := public.badge_request_snapshot(v_group.classroom_id, p_group_id, v_account.group_member_id, v_week);

  select * into v_badge from public.badges where group_id=p_group_id and badge_type=p_badge_type and week_start_date=v_week for update;
  if found then
    if v_badge.approval_status in ('pending','approved') then raise exception 'This badge has already been requested this week.'; end if;
    update public.badges set approval_status='pending', redeemed_by=v_user, reviewed_by=null, reviewed_at=null, points_awarded=10, request_snapshot=v_snapshot where id=v_badge.id returning * into v_badge;
  else
    insert into public.badges(group_id,classroom_id,badge_type,week_start_date,points_awarded,redeemed_by,approval_status,request_snapshot)
      values(p_group_id,v_group.classroom_id,p_badge_type,v_week,10,v_user,'pending',v_snapshot) returning * into v_badge;
  end if;
  return v_badge;
end;
$$;

create or replace function public.claim_badge_definition(p_definition_id uuid, p_group_id uuid, p_member_id uuid default null)
returns public.badges language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_def public.badge_definitions%rowtype; v_group public.groups%rowtype; v_account public.group_accounts%rowtype;
  v_result public.badges%rowtype; v_week date; v_badge_type text; v_snapshot jsonb;
begin
  if extract(dow from (now() at time zone 'Asia/Manila')) not in (0,6) then raise exception 'Badges can be claimed on Saturday or Sunday.'; end if;
  select bd.* into v_def from public.badge_definitions bd where bd.id=p_definition_id and bd.is_active=true and (bd.classroom_id=(select classroom_id from public.groups where id=p_group_id) or (bd.applies_to_all_classes and exists (select 1 from public.classrooms c join public.groups g on g.classroom_id=c.id where g.id=p_group_id and c.teacher_id=bd.created_by)));
  if not found then raise exception 'Badge is no longer available for this class'; end if;
  select * into v_group from public.groups where id=p_group_id; if not found then raise exception 'Invalid group'; end if;
  select * into v_account from public.group_accounts where user_id=v_user and group_id=p_group_id and is_approved=true limit 1; if not found then raise exception 'Approved classroom account required'; end if;
  if v_def.badge_scope='personal' and (p_member_id is null or p_member_id<>v_account.group_member_id) then raise exception 'Personal badges can only be claimed for your own student profile'; end if;
  v_week := (now() at time zone 'Asia/Manila')::date-extract(isodow from (now() at time zone 'Asia/Manila'))::integer+1;
  v_badge_type := 'custom:'||v_def.id::text||case when v_def.badge_scope='personal' then ':'||p_member_id::text else '' end;
  v_snapshot := public.badge_request_snapshot(v_group.classroom_id, p_group_id, v_account.group_member_id, v_week);
  select * into v_result from public.badges where group_id=p_group_id and badge_type=v_badge_type and week_start_date=v_week for update;
  if found then
    if v_result.approval_status in ('pending','approved') then raise exception 'This badge has already been requested this week.'; end if;
    update public.badges set approval_status='pending',redeemed_by=v_user,reviewed_by=null,reviewed_at=null,points_awarded=least(10,v_def.points),request_snapshot=v_snapshot where id=v_result.id returning * into v_result;
  else
    insert into public.badges(group_id,classroom_id,badge_type,week_start_date,points_awarded,redeemed_by,badge_definition_id,member_id,approval_status,request_snapshot)
      values(p_group_id,v_group.classroom_id,v_badge_type,v_week,least(10,v_def.points),v_user,p_definition_id,case when v_def.badge_scope='personal' then p_member_id else null end,'pending',v_snapshot) returning * into v_result;
  end if;
  return v_result;
end;
$$;

revoke all on function public.redeem_badge(uuid, text) from public;
revoke all on function public.claim_badge_definition(uuid, uuid, uuid) from public;
grant execute on function public.redeem_badge(uuid, text) to authenticated;
grant execute on function public.claim_badge_definition(uuid, uuid, uuid) to authenticated;

-- ── Verification ─────────────────────────────────────────────────────────

do $$
declare
  v_group_id uuid;
  v_account public.group_accounts%rowtype;
  v_out jsonb;
  v_row jsonb;
  v_types text[];
  v_missing text[] := '{}';
  v_reasons text[] := '{}';
  v_leaks text[] := '{}';
  v_def text;
begin
  -- An approved student with a group, to ask the question as.
  select ga.group_id into v_group_id
  from public.group_accounts ga
  where ga.is_approved and ga.group_member_id is not null
    and extract(dow from (now() at time zone 'Asia/Manila')) in (0, 6)
    and exists (select 1 from public.group_members gm where gm.group_id = ga.group_id)
  order by ga.created_date limit 1;

  if v_group_id is null then
    raise notice 'skipped: no approved student group is available on a weekend to ask about';
    return;
  end if;

  select * into v_account from public.group_accounts
  where group_id = v_group_id and is_approved and group_member_id is not null
  order by created_date limit 1;

  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_account.user_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_account.user_id::text, 'role', 'authenticated')::text);

  v_out := public.get_badge_eligibility(v_group_id);

  if jsonb_typeof(v_out) <> 'array' or jsonb_array_length(v_out) <> 4 then
    raise exception 'get_badge_eligibility returned % rows, expected 4', coalesce(jsonb_array_length(v_out), 0);
  end if;

  for v_row in select * from jsonb_array_elements(v_out)
  loop
    v_types := array_append(v_types, v_row ->> 'badgeType');
    if v_row -> 'metric' is null or jsonb_typeof(v_row -> 'metric') <> 'object' then
      v_missing := array_append(v_missing, coalesce(v_row ->> 'badgeType', '?') || ' has no metric');
    end if;
    if coalesce(btrim(v_row ->> 'reason'), '') = '' then
      v_reasons := array_append(v_reasons, coalesce(v_row ->> 'badgeType', '?') || ' has no reason');
    end if;
  end loop;

  foreach v_def in array array[
    'weekly_90_activity', 'weekly_full_attendance',
    'weekly_top_group_points', 'weekly_top_individual_points'
  ] loop
    if not (v_def = any (v_types)) then
      v_missing := array_append(v_missing, v_def || ' is missing from the answer');
    end if;
  end loop;

  -- A penalty must read as a deduction in the eligibility maths, not a reward.
  if public.signed_participation_points('behavior_penalty', 5) <> -5
     or public.signed_participation_points('scan', 5) <> 5
     or public.signed_participation_points('behavior_penalty', -5) <> -5 then
    v_leaks := array_append(v_leaks, 'a penalty still reads as positive');
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'Badge eligibility incomplete: %', array_to_string(v_missing, '; ');
  end if;
  if array_length(v_reasons, 1) is not null then
    raise exception 'Badge eligibility unexplained: %', array_to_string(v_reasons, '; ');
  end if;
  if array_length(v_leaks, 1) is not null then
    raise exception 'Badge eligibility miscounts: %', array_to_string(v_leaks, '; ');
  end if;

  raise notice
    'verified: all four weekly badges report eligibility, a reason and their numbers, and a penalty counts as a deduction';
end;
$$;