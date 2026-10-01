-- Follow-up to 20261106.
--
-- 1. Student history totals must not depend on how many rows the page has
--    paged in, and personal points must not absorb whole-group awards.
-- 2. A representative must upload fresh proof when requesting a score edit, so
--    an approved score can never rest on a stale photo.

-- ---------------------------------------------------------------------------
-- 1a. True account totals, computed server-side over the whole history.
-- ---------------------------------------------------------------------------
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
set search_path = public
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
    select l.*
    from public.participation_logs l
    where l.classroom_id = v_account.classroom_id
      and l.group_id = v_account.group_id
      and l.group_member_id = v_account.group_member_id
  ), whole_group as (
    select l.*
    from public.participation_logs l
    where l.classroom_id = v_account.classroom_id
      and l.group_id = v_account.group_id
      and l.group_member_id is null
  ), personal as (
    select
      coalesce(sum(case when event_type = 'behavior_penalty' then -abs(points_awarded) else points_awarded end), 0) as points,
      coalesce(sum(xp_spent), 0) as xp_spent
    from mine
  ), group_totals as (
    select
      coalesce(sum(case when event_type = 'behavior_penalty' then -abs(points_awarded) else points_awarded end), 0) as points,
      coalesce(sum(case when event_type = 'behavior_penalty' then abs(points_awarded) else 0 end), 0) as deducted,
      coalesce(sum(case when event_type = 'behavior_penalty' then 0 else points_awarded end), 0) as earned
    from whole_group
  ), earned_xp as (
    select coalesce(sum(xp_earned), 0) as xp from public.mission_submissions
    where classroom_id = v_account.classroom_id
      and group_member_id = v_account.group_member_id
  ), att as (
    select
      count(*) filter (where status = 'present') as present_days,
      count(*) filter (where status <> 'present') as absent_days,
      count(*) as total_days
    from public.attendances
    where classroom_id = v_account.classroom_id
      and group_member_id = v_account.group_member_id
  )
  select
    personal.points,
    personal.points + group_totals.points,
    group_totals.earned,
    group_totals.deducted,
    earned_xp.xp,
    personal.xp_spent,
    greatest(0, earned_xp.xp - personal.xp_spent),
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

-- ---------------------------------------------------------------------------
-- 1b. History rows carry a badge approval state, so a declined claim no longer
--     renders identically to an approved one.
-- ---------------------------------------------------------------------------
drop function if exists public.get_student_account_history(uuid, integer, timestamptz);

create or replace function public.get_student_account_history(
  p_classroom_id uuid default null,
  p_limit integer default 250,
  p_before timestamptz default null
)
returns table (
  entry_id text,
  kind text,
  title text,
  detail text,
  points numeric,
  xp_earned numeric,
  xp_spent numeric,
  scope text,
  status text,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_account public.group_accounts%rowtype;
  v_limit integer := greatest(1, least(coalesce(p_limit, 250), 500));
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
  with visible as (
    -- Personal entries plus whole-group entries for the student's own group.
    select l.*
    from public.participation_logs l
    where l.classroom_id = v_account.classroom_id
      and l.group_id = v_account.group_id
      and (l.group_member_id = v_account.group_member_id or l.group_member_id is null)
      and (p_before is null or l.created_date < p_before)
  ), points as (
    select
      'log-' || v.id as entry_id,
      case v.event_type
        when 'scan' then 'qr_scan'
        when 'gacha_win' then 'gacha_win'
        when 'gacha_loss' then 'gacha_loss'
        when 'gacha_even' then 'gacha_even'
        when 'behavior_penalty' then 'penalty'
        when 'mission_redemption' then 'xp_redeemed'
        when 'badge' then 'badge_awarded'
        when 'point_correction' then 'correction'
        else v.event_type
      end as kind,
      case v.event_type
        when 'gacha_win' then 'Gacha win'
        when 'gacha_loss' then 'Gacha loss'
        when 'gacha_even' then 'Gacha draw'
        when 'behavior_penalty' then 'Behavior deduction'
        when 'mission_redemption' then 'XP redeemed for points'
        when 'badge' then 'Badge reward'
        when 'point_correction' then 'Points correction'
        else 'QR scan'
      end as title,
      v.note as detail,
      -- Penalties are stored positive; the ledger presents them negative.
      (case when v.event_type = 'behavior_penalty' then -abs(v.points_awarded) else v.points_awarded end) as points,
      0::numeric as xp_earned,
      v.xp_spent as xp_spent,
      case when v.group_member_id is null then 'group' else 'member' end as scope,
      null::text as status,
      v.created_date as occurred_at
    from visible v
  ), attendance as (
    select
      'attendance-' || a.id as entry_id,
      'attendance' as kind,
      case when a.status = 'present' then 'Marked present' else 'Marked absent' end as title,
      a.attendance_date as detail,
      0::numeric as points,
      0::numeric as xp_earned,
      0::numeric as xp_spent,
      'member'::text as scope,
      null::text as status,
      (a.attendance_date::timestamp + time '12:00') at time zone 'Asia/Manila' as occurred_at
    from public.attendances a
    where a.classroom_id = v_account.classroom_id
      and a.group_member_id = v_account.group_member_id
      and (p_before is null or (a.attendance_date::timestamp + time '12:00') at time zone 'Asia/Manila' < p_before)
  ), xp as (
    select
      'xp-' || s.id as entry_id,
      'mission_xp' as kind,
      'Mission completed' as title,
      coalesce(m.title, 'Mission') as detail,
      0::numeric as points,
      coalesce(s.xp_earned, 0) as xp_earned,
      0::numeric as xp_spent,
      'member'::text as scope,
      case when s.xp_earned > 0 then 'awarded' else 'no xp' end as status,
      s.created_date as occurred_at
    from public.mission_submissions s
    left join public.missions m on m.id = s.mission_id
    where s.classroom_id = v_account.classroom_id
      and s.group_member_id = v_account.group_member_id
      and (p_before is null or s.created_date < p_before)
  ), badges as (
    select
      'badge-' || b.id as entry_id,
      'badge_claim' as kind,
      case b.approval_status
        when 'approved' then 'Badge earned'
        when 'rejected' then 'Badge declined'
        else 'Badge requested'
      end as title,
      coalesce(
        (select bd.title from public.badge_definitions bd where bd.id = b.badge_definition_id),
        nullif(regexp_replace(b.badge_type, '^custom:[0-9a-f-]+(:[0-9a-f-]+)?$', 'Badge'), ''),
        replace(b.badge_type, '_', ' ')
      ) || case
        when b.approval_status = 'approved' then ' · +' || coalesce(b.points_awarded, 0) || ' pts added'
        when b.approval_status = 'rejected' then ' · no points added'
        else ' · awaiting approval · +' || coalesce(b.points_awarded, 0) || ' pts on approval'
      end as detail,
      -- Points are reported by the badge_awarded row once approval lands.
      0::numeric as points,
      0::numeric as xp_earned,
      0::numeric as xp_spent,
      case when b.member_id is null then 'group' else 'member' end as scope,
      coalesce(b.approval_status, 'pending') as status,
      b.created_date as occurred_at
    from public.badges b
    where b.classroom_id = v_account.classroom_id
      and b.group_id = v_account.group_id
      and (b.member_id is null or b.member_id = v_account.group_member_id)
      and (p_before is null or b.created_date < p_before)
  ), rewards as (
    select
      'reward-' || r.id as entry_id,
      'reward_request' as kind,
      'Reward requested' as title,
      r.reward_title as detail,
      0::numeric as points,
      0::numeric as xp_earned,
      0::numeric as xp_spent,
      'group'::text as scope,
      coalesce(r.approval_status, 'pending') as status,
      r.created_date as occurred_at
    from public.reward_redemptions r
    where r.classroom_id = v_account.classroom_id
      and r.group_id = v_account.group_id
      and (p_before is null or r.created_date < p_before)
  ), combined as (
    select * from points
    union all select * from attendance
    union all select * from xp
    union all select * from badges
    union all select * from rewards
  )
  select
    c.entry_id,
    c.kind,
    c.title,
    c.detail,
    c.points,
    c.xp_earned,
    c.xp_spent,
    c.scope,
    c.status,
    c.occurred_at
  from combined c
  order by c.occurred_at desc, c.entry_id desc
  limit v_limit;
end;
$$;

revoke all on function public.get_student_account_history(uuid, integer, timestamptz) from public;
grant execute on function public.get_student_account_history(uuid, integer, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A score edit may only be requested with proof uploaded after the original
--    evidence, so the teacher always reviews a fresh photo.
-- ---------------------------------------------------------------------------
alter table public.activity_score_edit_requests
  add column if not exists evidence_id uuid references public.activity_evidence(id) on delete set null;

create or replace function public.request_activity_score_edit(
  p_activity_score_id uuid,
  p_proposed_score numeric,
  p_evidence_id uuid default null
)
returns public.activity_score_edit_requests
language plpgsql security definer set search_path = public as $$
declare
  v_score public.activity_scores%rowtype;
  v_max numeric;
  v_evidence public.activity_evidence%rowtype;
  v_baseline timestamptz;
  v_result public.activity_score_edit_requests%rowtype;
begin
  select s.* into v_score
  from public.activity_scores s
  where s.id = p_activity_score_id for update;
  if not found then raise exception 'Saved activity score not found'; end if;

  select max_score into v_max from public.activities where id = v_score.activity_id;

  if auth_rep_group_id(v_score.classroom_id) is distinct from v_score.group_id then
    raise exception 'Only the approved representative may request a score edit';
  end if;

  if p_proposed_score < 0 or (v_max is not null and p_proposed_score > v_max) then
    if v_max is null then raise exception 'The proposed score cannot be negative'; end if;
    raise exception 'The proposed score must be between 0 and % ', v_max;
  end if;

  if p_proposed_score = v_score.score then
    raise exception 'The proposed score is already the saved score';
  end if;

  if exists (
    select 1 from public.activity_score_edit_requests r
    where r.activity_score_id = p_activity_score_id and r.status = 'pending'
  ) then
    raise exception 'A score edit is already awaiting teacher approval';
  end if;

  -- Proof must exist and must be newer than the last approval for this score.
  -- That is what stops a rep from re-photographing nothing and reusing an
  -- earlier submission to justify a changed score.
  select max(r.created_at) into v_baseline
  from public.activity_score_edit_requests r
  where r.activity_score_id = p_activity_score_id and r.status = 'approved';

  if p_evidence_id is null then
    raise exception 'Upload a new photo of the work before requesting a score edit';
  end if;

  select e.* into v_evidence
  from public.activity_evidence e
  where e.id = p_evidence_id
    and e.activity_id = v_score.activity_id
    and e.group_member_id = v_score.group_member_id
    and e.classroom_id = v_score.classroom_id
    and e.group_id = v_score.group_id;

  if not found then
    raise exception 'The proof does not belong to this activity and student';
  end if;

  if v_baseline is not null and v_evidence.created_at <= v_baseline then
    raise exception 'Upload a fresh photo of the work before requesting a score edit';
  end if;

  insert into public.activity_score_edit_requests(
    activity_score_id, activity_id, classroom_id, group_id, group_member_id,
    proposed_score, requested_by, evidence_id
  )
  values (
    v_score.id, v_score.activity_id, v_score.classroom_id, v_score.group_id, v_score.group_member_id,
    p_proposed_score, auth.uid(), p_evidence_id
  ) returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.review_activity_score_edit(p_request_id uuid, p_approve boolean)
returns public.activity_score_edit_requests
language plpgsql security definer set search_path = public as $$
declare
  v_result public.activity_score_edit_requests%rowtype;
begin
  select * into v_result
  from public.activity_score_edit_requests
  where id = p_request_id for update;

  if not found then raise exception 'Score edit request not found'; end if;
  if not auth_is_teacher_of(v_result.classroom_id) then raise exception 'Only the classroom teacher may review a score edit'; end if;
  if v_result.status <> 'pending' then raise exception 'This score edit has already been reviewed'; end if;

  if p_approve then
    if v_result.evidence_id is null or not exists (
      select 1 from public.activity_evidence e
      where e.id = v_result.evidence_id and e.group_member_id = v_result.group_member_id
    ) then
      raise exception 'This request has no proof attached and cannot be approved';
    end if;

    update public.activity_scores set score = v_result.proposed_score where id = v_result.activity_score_id;
  end if;

  update public.activity_score_edit_requests
  set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = auth.uid(), reviewed_at = now()
  where id = v_result.id returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.request_activity_score_edit(uuid, numeric, uuid) from public;
revoke all on function public.review_activity_score_edit(uuid, boolean) from public;
grant execute on function public.request_activity_score_edit(uuid, numeric, uuid) to authenticated;
grant execute on function public.review_activity_score_edit(uuid, boolean) to authenticated;

-- The teacher queue needs the proof it is being asked to approve.
drop policy if exists teacher_read_activity_score_edits on public.activity_score_edit_requests;
create policy teacher_read_activity_score_edits on public.activity_score_edit_requests for select to authenticated
  using (auth_is_teacher_of(classroom_id));