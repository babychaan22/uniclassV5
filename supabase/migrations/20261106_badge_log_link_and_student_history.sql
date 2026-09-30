-- Badge approvals could never add points: review_badge_claim stored the badge id
-- in participation_logs.qr_code_id, which references qr_codes(id). That insert
-- always raised a foreign-key violation, so approving a badge rolled the whole
-- transaction back and the request stayed 'pending' forever.
--
-- Give participation_logs a real badge_id link instead, move any existing badge
-- rows off qr_code_id, and guarantee one award log per badge.

alter table public.participation_logs
  add column if not exists badge_id uuid references public.badges(id) on delete set null;

-- Re-point historical badge rows. qr_code_id keeps pointing at qr_codes, so these
-- can only be rows written before the foreign key existed.
update public.participation_logs l
set badge_id = l.qr_code_id
where l.event_type = 'badge'
  and l.badge_id is null
  and l.qr_code_id is not null
  and exists (select 1 from public.badges b where b.id = l.qr_code_id);

update public.participation_logs
set qr_code_id = null
where event_type = 'badge' and badge_id is not null;

-- Duplicate badge awards are corruption from the re-approval race, never real
-- history. Keep the earliest entry per badge so the guard below can be enforced.
delete from public.participation_logs a
using public.participation_logs b
where a.badge_id is not null
  and b.badge_id = a.badge_id
  and (a.created_date, a.id) > (b.created_date, b.id);

create unique index if not exists idx_participation_logs_one_badge_award
  on public.participation_logs(badge_id)
  where badge_id is not null;

create index if not exists idx_participation_logs_badge
  on public.participation_logs(badge_id);

create or replace function public.review_badge_claim(p_badge_id uuid, p_approve boolean)
returns public.badges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_badge public.badges%rowtype;
  v_title text;
  v_points numeric;
begin
  select * into v_badge
  from public.badges
  where id = p_badge_id
  for update;

  if not found then
    raise exception 'Badge request not found';
  end if;

  if not auth_is_teacher_of(v_badge.classroom_id) then
    raise exception 'Only the teacher can review this badge request';
  end if;

  if v_badge.approval_status <> 'pending' then
    raise exception 'This badge request has already been reviewed';
  end if;

  update public.badges
  set approval_status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_badge_id
  returning * into v_badge;

  if p_approve then
    v_points := coalesce(v_badge.points_awarded, 0);

    select coalesce(
      (select bd.title from public.badge_definitions bd where bd.id = v_badge.badge_definition_id),
      nullif(replace(v_badge.badge_type, '_', ' '), ''),
      'Weekly badge'
    ) into v_title;

    insert into public.participation_logs(
      group_member_id,
      group_id,
      classroom_id,
      badge_id,
      points_awarded,
      event_type,
      multiplier,
      recipient_type,
      note
    )
    values(
      v_badge.member_id,
      v_badge.group_id,
      v_badge.classroom_id,
      v_badge.id,
      v_points,
      'badge',
      1,
      case when v_badge.member_id is null then 'group' else 'member' end,
      v_title
    );
  end if;

  return v_badge;
end;
$$;

revoke all on function public.review_badge_claim(uuid, boolean) from public;
grant execute on function public.review_badge_claim(uuid, boolean) to authenticated;

-- A student-facing ledger of everything that touches their account: attendance,
-- QR and manual point awards, group-wide awards, penalties, mission XP, XP
-- redemption, badge claims and reward requests. Points are returned already
-- signed (a penalty is negative) so callers cannot re-derive the convention.
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
      'Badge requested' as title,
      coalesce(bd.title, nullif(regexp_replace(b.badge_type, '^custom:[0-9a-f-]+(:[0-9a-f-]+)?$', 'Badge'), ''),
      replace(b.badge_type, '_', ' ')) as detail,
      -- Points land only on approval; the badge log above reports the award.
      0::numeric as points,
      0::numeric as xp_earned,
      0::numeric as xp_spent,
      case when b.member_id is null then 'group' else 'member' end as scope,
      b.created_date as occurred_at
    from public.badges b
    left join public.badge_definitions bd on bd.id = b.badge_definition_id
    where b.classroom_id = v_account.classroom_id
      and b.group_id = v_account.group_id
      and (b.member_id is null or b.member_id = v_account.group_member_id)
      and (p_before is null or b.created_date < p_before)
  ), rewards as (
    select
      'reward-' || r.id as entry_id,
      'reward_request' as kind,
      'Reward requested' as title,
      r.reward_title || ' · ' ||
        case when r.approval_status = 'approved' then 'approved'
             when r.approval_status = 'rejected' then 'declined'
             else 'awaiting approval' end as detail,
      0::numeric as points,
      0::numeric as xp_earned,
      0::numeric as xp_spent,
      'group'::text as scope,
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
    c.occurred_at
  from combined c
  order by c.occurred_at desc, c.entry_id desc
  limit v_limit;
end;
$$;

revoke all on function public.get_student_account_history(uuid, integer, timestamptz) from public;
grant execute on function public.get_student_account_history(uuid, integer, timestamptz) to authenticated;