-- 20261143 — a removed entry has to explain itself.
--
-- void_participation_entry zeroes an award and keeps what it took back in
-- reversed_points, reversed_at and reversal_reason. But the student's ledger
-- was still returning the bare note, so a removed row read as a struck-through
-- entry worth nothing with no explanation and no amount. That is the one thing
-- a ledger must never do: silently change a balance.
--
-- The detail line now carries the points that were returned and the teacher's
-- reason. Nothing else moves: totals are unaffected, and every other kind of
-- entry renders exactly as before.
--
-- This is also the first migration to touch the history function since 20261142
-- fixed the type mismatch that had made it raise on every call. It re-sends the
-- whole function and then calls it, because plpgsql does not analyse a body
-- until it runs.

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
      case
        -- A removed entry has to say what it used to be worth and why it went.
        -- Otherwise a student's balance changes and the ledger says nothing.
        when v.reversed_at is not null then
          trim(
            coalesce(v.note, '')
            || case
              when coalesce(v.reversed_points, 0) > 0
                then ' · ' || coalesce(v.reversed_points, 0) || ' pts returned'
              else ' · nothing had been awarded'
            end
            || case
              when v.reversal_reason is not null then ' (' || v.reversal_reason || ')'
              else ''
            end
          )
        else v.note
      end as detail,
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
-- Award points, remove them, then read the student's own ledger and confirm it
-- names the amount returned and the teacher's reason. Everything created here
-- is deleted again.

do $$
declare
  v_case record;
  v_award public.participation_logs%rowtype;
  v_detail text;
  v_problems text[] := '{}';
begin
  select c.id as classroom_id, c.teacher_id, ga.user_id, ga.group_id, ga.group_member_id
    into v_case
  from public.classrooms c
  join public.group_accounts ga
    on ga.classroom_id = c.id and ga.is_approved and ga.group_member_id is not null
  order by c.created_date, ga.created_date
  limit 1;

  if v_case.group_id is null then
    raise notice 'skipped: no classroom has an approved student to check';
    return;
  end if;

  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_case.teacher_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_case.teacher_id::text, 'role', 'authenticated')::text);

  v_award := public.award_participation_points(v_case.group_id, 3, v_case.group_member_id, 'verification award');
  perform public.void_participation_entry(v_award.id, 'duplicate scan');

  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_case.user_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_case.user_id::text, 'role', 'authenticated')::text);

  select h.detail into v_detail
  from public.get_student_account_history(v_case.classroom_id, 500, null) h
  where h.entry_id = 'log-' || v_award.id::text;

  if v_detail is null then
    v_problems := array_append(v_problems, 'the removed entry vanished from the student''s ledger');
  end if;
  if coalesce(v_detail, '') not like '%3 pts returned%' then
    v_problems := array_append(v_problems,
      'the ledger does not say 3 points were returned, it says: ' || coalesce(v_detail, 'nothing'));
  end if;
  if coalesce(v_detail, '') not like '%duplicate scan%' then
    v_problems := array_append(v_problems,
      'the ledger does not carry the teacher''s reason, it says: ' || coalesce(v_detail, 'nothing'));
  end if;

  if not exists (
    select 1 from public.get_student_account_history(v_case.classroom_id, 500, null) h
    where h.entry_id = 'log-' || v_award.id::text and h.status = 'reversed'
  ) then
    v_problems := array_append(v_problems, 'the entry is not flagged as removed');
  end if;

  delete from public.participation_logs where id = v_award.id;

  if array_length(v_problems, 1) is not null then
    raise exception 'Removed entry is unexplained: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'verified: a removed entry stays in the student''s ledger, reports how many points were returned, and carries the teacher''s reason';
end;
$$;