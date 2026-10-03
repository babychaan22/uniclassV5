-- 20261142 — a points ledger a teacher can correct, and a way to award points.
--
-- Two gaps in participation_logs, plus one latent outage.
--
-- 1. There was no way to award points by hand. ParticipationLog.create is
--    called exactly once in the whole app, and that call is the behaviour
--    penalty. So "the teacher gave me 5 points for helping" could only be
--    recorded as a scan, a gacha draw, or a badge, which is a lie in the
--    ledger.
--
-- 2. There was no way to take a point back. correct_participation_recipient
--    moves an award to a different student and is limited to four event types;
--    it cannot cancel a penalty or a manual entry, and it rewrites the
--    original row in place with no record of what it used to say.
--
--    participation_points_nonnegative forbids a negative points_awarded, so a
--    reversal cannot be stored as a negative row. Voiding therefore zeroes the
--    award and records what was taken back, on the row itself: reversed_at,
--    reversed_points, reversed_by and reversal_reason. Every existing reader
--    keeps working untouched, because a zeroed row stops counting everywhere,
--    and the amount that was removed stays visible in the ledger instead of
--    being quietly erased.
--
-- 3. get_student_account_history never worked. Its attendance branch put a
--    date into a column that every other branch fills with text, and plpgsql
--    does not analyse the SQL inside a function body until the function is
--    first called. So the function was created happily in 20261107 and has
--    raised "UNION types text and date cannot be matched" on every call ever
--    since. A student's History page has been showing that error instead of
--    their account. The cast below fixes it, and this migration calls the
--    function so the next one cannot ship the same way.
--
-- The ledger also learns the manual award event type and activity score
-- decisions, so a student can see that the correction they asked for was
-- approved or declined.

alter table public.participation_logs
  drop constraint if exists participation_logs_event_type_check;
alter table public.participation_logs
  add constraint participation_logs_event_type_check check (
    event_type in ('scan','gacha_win','gacha_loss','gacha_even','behavior_penalty',
                   'mission_redemption','badge','point_correction','manual_award')
  );

alter table public.participation_logs
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_points numeric,
  add column if not exists reversed_by uuid references auth.users(id) on delete set null,
  add column if not exists reversal_reason text;

comment on column public.participation_logs.reversed_at is
  'Set when a teacher voided this entry. The award is zeroed so it stops counting everywhere; reversed_points keeps the amount that was taken back.';
comment on column public.participation_logs.reversed_points is
  'The points (and XP) this entry was worth before it was removed.';

-- ── A teacher can award points by hand ────────────────────────────────────
create or replace function public.award_participation_points(
  p_group_id uuid,
  p_points numeric,
  p_member_id uuid default null,
  p_note text default null
)
returns public.participation_logs
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_group public.groups%rowtype;
  v_member public.group_members%rowtype;
  v_result public.participation_logs%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_group from public.groups where id = p_group_id;
  if not found then raise exception 'Invalid group'; end if;
  if not auth_is_teacher_of(v_group.classroom_id) then
    raise exception 'Only the classroom teacher may award points';
  end if;

  -- A null member is the whole group, which is how a penalty is recorded too.
  if p_member_id is not null then
    select * into v_member from public.group_members
      where id = p_member_id and group_id = p_group_id;
    if not found then raise exception 'That student is not in the selected group'; end if;
  end if;

  if p_points is null or p_points <= 0 or p_points > 100 then
    raise exception 'Enter between 1 and 100 points';
  end if;

  insert into public.participation_logs(
    group_id, classroom_id, group_member_id, points_awarded,
    event_type, multiplier, recipient_type, note
  ) values (
    p_group_id, v_group.classroom_id, p_member_id, p_points,
    'manual_award', 1,
    case when p_member_id is null then 'group' else 'member' end,
    nullif(trim(coalesce(p_note, '')), '')
  ) returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.award_participation_points(uuid, numeric, uuid, text) from public;
grant execute on function public.award_participation_points(uuid, numeric, uuid, text) to authenticated;

-- ── …and take one back without losing the record of it ─────────────────────
create or replace function public.void_participation_entry(p_log_id uuid, p_reason text default null)
returns public.participation_logs
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_source public.participation_logs%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_source from public.participation_logs where id = p_log_id for update;
  if not found then raise exception 'That entry no longer exists'; end if;
  if not auth_is_teacher_of(v_source.classroom_id) then
    raise exception 'Only the classroom teacher may remove an entry';
  end if;

  if v_source.reversed_at is not null then
    raise exception 'That entry has already been removed';
  end if;
  if v_source.event_type = 'point_correction' then
    raise exception 'That is a correction record, not an award. Nothing to remove.';
  end if;
  if v_source.event_type = 'badge' then
    raise exception 'Badge points follow the badge decision, not a single log entry';
  end if;
  if coalesce(v_source.points_awarded, 0) = 0 and coalesce(v_source.xp_spent, 0) = 0 then
    raise exception 'That entry never awarded anything';
  end if;

  -- Zeroing is what actually takes the points back: every total in the app
  -- sums this column, so no reader needs to learn about removals at all. The
  -- amount is kept beside it so the ledger still shows what happened.
  update public.participation_logs
  set points_awarded = 0,
      xp_spent = 0,
      reversed_at = now(),
      reversed_points = coalesce(v_source.points_awarded, 0),
      reversed_by = v_user,
      reversal_reason = coalesce(
        nullif(trim(coalesce(p_reason, '')), ''),
        'Duplicate entry'
      )
  where id = v_source.id
  returning * into v_source;

  return v_source;
end;
$$;

revoke all on function public.void_participation_entry(uuid, text) from public;
grant execute on function public.void_participation_entry(uuid, text) to authenticated;

-- ── The student ledger: the outage fix, the new event, and score decisions ─
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
        when 'manual_award' then 'manual_award'
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
        when 'manual_award' then 'Points awarded'
        else 'QR scan'
      end as title,
      v.note as detail,
      -- Penalties are stored positive; the ledger presents them negative.
      (case when v.event_type = 'behavior_penalty' then -abs(v.points_awarded) else v.points_awarded end) as points,
      0::numeric as xp_earned,
      v.xp_spent as xp_spent,
      case when v.group_member_id is null then 'group' else 'member' end as scope,
      -- A removed entry keeps its place in the ledger and is flagged, so the
      -- student sees "this was taken back" rather than a silent gap.
      case when v.reversed_at is not null then 'reversed' else null end as status,
      v.created_date as occurred_at
    from visible v
  ), attendance as (
    select
      'attendance-' || a.id as entry_id,
      'attendance' as kind,
      case when a.status = 'present' then 'Marked present' else 'Marked absent' end as title,
      -- Cast to text because every other branch fills detail with text and
      -- attendance_date is a date. See the note at the top of this migration:
      -- without this cast the function raises on every call.
      a.attendance_date::text as detail,
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
  ), score_edits as (
    select
      'score-' || r.id as entry_id,
      'score_edit' as kind,
      case r.status
        when 'approved' then 'Score change approved'
        when 'rejected' then 'Score change declined'
        else 'Score change requested'
      end as title,
      coalesce((select a.title from public.activities a where a.id = r.activity_id), 'Activity')
        || ' · ' || r.current_score::text || ' to ' || r.proposed_score::text as detail,
      0::numeric as points,
      0::numeric as xp_earned,
      0::numeric as xp_spent,
      'member'::text as scope,
      r.status as status,
      r.created_at as occurred_at
    from public.activity_score_edit_requests r
    where r.classroom_id = v_account.classroom_id
      and r.group_member_id = v_account.group_member_id
      and (p_before is null or r.created_at < p_before)
  ), combined as (
    select * from points
    union all select * from attendance
    union all select * from xp
    union all select * from badges
    union all select * from rewards
    union all select * from score_edits
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

-- ── Verification ─────────────────────────────────────────────────────────
-- Award points by hand, confirm the student's ledger and balance both move,
-- remove the entry, confirm the balance returns to where it started and the
-- ledger still shows the entry as removed rather than deleted. Everything the
-- check creates is removed again.

do $$
declare
  v_case record;
  v_award public.participation_logs%rowtype;
  v_voided public.participation_logs%rowtype;
  v_before numeric;
  v_after_award numeric;
  v_after_void numeric;
  v_seen integer;
  v_status text;
  v_points numeric;
  v_refused boolean;
  v_problems text[] := '{}';
begin
  -- A teacher with an approved student who has a group.
  select c.id as classroom_id, c.teacher_id, ga.user_id, ga.group_id, ga.group_member_id
    into v_case
  from public.classrooms c
  join public.group_accounts ga on ga.classroom_id = c.id and ga.is_approved and ga.group_member_id is not null
  order by c.created_date, ga.created_date
  limit 1;

  if v_case.group_id is null then
    raise notice 'skipped: no classroom has an approved student to award points to';
    return;
  end if;

  select coalesce(sum(points_awarded), 0) into v_before
  from public.participation_logs
  where classroom_id = v_case.classroom_id and group_member_id = v_case.group_member_id;

  -- 1. The ledger answers at all. This call raised on every attempt before the
  --    attendance cast above, which is why the student History page was broken.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_case.user_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_case.user_id::text, 'role', 'authenticated')::text);

  perform 1 from public.get_student_account_history(v_case.classroom_id, 500, null) limit 1;

  -- 2. A manual award lands as its own event type and reaches the balance.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_case.teacher_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_case.teacher_id::text, 'role', 'authenticated')::text);

  v_award := public.award_participation_points(
    v_case.group_id, 7, v_case.group_member_id, 'verification award');

  if v_award.id is null then
    v_problems := array_append(v_problems, 'the manual award was not recorded');
  end if;
  if v_award.event_type <> 'manual_award' then
    v_problems := array_append(v_problems, 'the award was not filed as a manual_award');
  end if;

  select coalesce(sum(points_awarded), 0) into v_after_award
  from public.participation_logs
  where classroom_id = v_case.classroom_id and group_member_id = v_case.group_member_id;
  if v_after_award <> v_before + 7 then
    v_problems := array_append(v_problems,
      'the award did not reach the balance: ' || v_after_award || ' instead of ' || (v_before + 7));
  end if;

  -- 3. A student cannot award points.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_case.user_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_case.user_id::text, 'role', 'authenticated')::text);

  v_refused := false;
  begin
    perform public.award_participation_points(v_case.group_id, 50, v_case.group_member_id, 'should not work');
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    v_problems := array_append(v_problems, 'a student was able to award points');
  end if;

  -- 4. The student sees the award, with its points.
  select count(*) into v_seen
  from public.get_student_account_history(v_case.classroom_id, 500, null) h
  where h.entry_id = 'log-' || v_award.id::text
    and h.kind = 'manual_award'
    and h.points = 7
    and h.title = 'Points awarded';

  if v_seen <> 1 then
    v_problems := array_append(v_problems, 'the award is missing from the student''s ledger');
  end if;

  -- 5. Removing it restores the balance and keeps the record.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_case.teacher_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_case.teacher_id::text, 'role', 'authenticated')::text);

  v_voided := public.void_participation_entry(v_award.id, 'verification removal');

  if v_voided.points_awarded <> 0 then
    v_problems := array_append(v_problems, 'the entry still awards points after removal');
  end if;
  if coalesce(v_voided.reversed_points, 0) <> 7 then
    v_problems := array_append(v_problems,
      'the removal did not record that 7 points were taken back, it recorded '
      || coalesce(v_voided.reversed_points::text, 'nothing'));
  end if;
  if v_voided.reversed_at is null or v_voided.reversal_reason is null then
    v_problems := array_append(v_problems, 'the removal was not recorded against the entry');
  end if;
  if v_voided.note is distinct from v_award.note then
    v_problems := array_append(v_problems, 'removal overwrote the original note');
  end if;

  select coalesce(sum(points_awarded), 0) into v_after_void
  from public.participation_logs
  where classroom_id = v_case.classroom_id and group_member_id = v_case.group_member_id;
  if v_after_void <> v_before then
    v_problems := array_append(v_problems,
      'the balance is ' || v_after_void || ' after removal, expected ' || v_before);
  end if;

  -- 6. Removing the same entry twice is refused.
  v_refused := false;
  begin
    perform public.void_participation_entry(v_award.id, 'again');
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    v_problems := array_append(v_problems, 'the same entry could be removed twice');
  end if;

  -- 7. The student sees the entry as removed rather than gone.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_case.user_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_case.user_id::text, 'role', 'authenticated')::text);

  select status, points into v_status, v_points
  from public.get_student_account_history(v_case.classroom_id, 500, null) h
  where h.entry_id = 'log-' || v_award.id::text;

  if v_status <> 'reversed' then
    v_problems := array_append(v_problems,
      'the student''s ledger does not flag the entry as removed');
  end if;
  if coalesce(v_points, 0) <> 0 then
    v_problems := array_append(v_problems, 'the student''s ledger still shows the removed points');
  end if;

  delete from public.participation_logs where id = v_award.id;

  if array_length(v_problems, 1) is not null then
    raise exception 'Points ledger corrections broken: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'verified: the student ledger loads, a teacher can award points by hand and remove them again, the balance returns to where it started, and the removed entry stays visible as removed';
end;
$$;