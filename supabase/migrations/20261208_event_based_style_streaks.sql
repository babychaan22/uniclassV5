-- Personal-style rewards use a five-event learning streak.  An event is a
-- present attendance record, an activity submitted by its deadline, or a
-- teacher-assigned mission completed by its deadline.  Daily Power-Ups do
-- not participate.  A recorded absence or missed required deadline breaks
-- the current streak.  Claiming a style starts a fresh count.

create or replace function public.get_personal_style_streak(
  p_classroom_id uuid,
  p_group_member_id uuid
)
returns table(streak_days integer, streak_started_on date)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_enrolled_at timestamptz;
  v_last_claimed_at timestamptz;
begin
  select ga.created_date into v_enrolled_at
  from public.group_accounts ga
  where ga.classroom_id = p_classroom_id and ga.group_member_id = p_group_member_id
  order by ga.created_date desc limit 1;
  v_enrolled_at := coalesce(v_enrolled_at, '-infinity'::timestamptz);

  select max(unlocked_at) into v_last_claimed_at
  from public.personal_style_streak_unlocks
  where classroom_id = p_classroom_id and group_member_id = p_group_member_id;

  return query
  with relevant_events as (
    select a.attendance_date::timestamptz as occurred_at, a.attendance_date as occurred_on,
      case when a.status = 'present' then 1 else 0 end as earns_point
    from public.attendances a
    where a.classroom_id = p_classroom_id and a.group_member_id = p_group_member_id
      and a.attendance_date::timestamptz >= v_enrolled_at

    union all

    select coalesce(s.created_date, act.deadline::timestamptz), act.deadline,
      case when s.id is not null and coalesce(s.created_date::date, act.deadline) <= act.deadline then 1 else 0 end
    from public.activities act
    left join public.activity_scores s on s.activity_id = act.id and s.group_member_id = p_group_member_id
    where act.classroom_id = p_classroom_id and act.is_published = true
      and act.deadline is not null and act.deadline <= (now() at time zone 'Asia/Manila')::date
      and act.deadline::timestamptz >= v_enrolled_at

    union all

    select coalesce(ms.created_date, coalesce(m.deadline_at, (m.deadline::timestamp + time '23:59:59') at time zone 'Asia/Manila')),
      m.deadline,
      case when ms.id is not null and ms.created_date <= coalesce(m.deadline_at, (m.deadline::timestamp + time '23:59:59') at time zone 'Asia/Manila') then 1 else 0 end
    from public.missions m
    left join public.mission_submissions ms on ms.mission_id = m.id and ms.group_member_id = p_group_member_id
    where m.is_active = true and m.deadline is not null
      and m.deadline <= (now() at time zone 'Asia/Manila')::date
      and m.deadline::timestamptz >= v_enrolled_at
      and coalesce(m.mission_source, '') <> 'daily_foundation'
      and (m.classroom_id = p_classroom_id or p_classroom_id = any(coalesce(m.target_classroom_ids, '{}'::uuid[])))
  ),
  after_claim as (
    select * from relevant_events where v_last_claimed_at is null or occurred_at > v_last_claimed_at
  ),
  since_last_break as (
    select *, max(case when earns_point = 0 then occurred_at end) over () as last_break_at
    from after_claim
  ),
  current_events as (
    select * from since_last_break where earns_point = 1 and (last_break_at is null or occurred_at > last_break_at)
  )
  select count(*)::integer, min(occurred_on)
  from current_events;
end;
$$;

create or replace function public.unlock_style_choice(p_choice_type text, p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_account public.group_accounts%rowtype;
  v_reward public.personal_reward_catalog%rowtype; v_claim public.personal_reward_claims%rowtype;
  v_streak_days integer := 0; v_streak_started_on date := null;
begin
  if p_choice_type not in ('avatar_choice', 'theme_choice', 'name_effect_choice') then raise exception 'Unknown style choice'; end if;
  select * into v_account from public.group_accounts
    where user_id = v_user and classroom_id = p_classroom_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved classroom account required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_classroom_id::text, 0));
  if exists (
    select 1 from public.personal_reward_claims cl
    join public.personal_reward_catalog c on c.id = cl.reward_id
    where cl.user_id = v_user and cl.classroom_id = p_classroom_id and cl.status = 'active'
      and c.reward_type in ('avatar_choice', 'theme_choice', 'name_effect_choice')
  ) then
    raise exception 'Use your current style choice before unlocking another';
  end if;
  select streak_days, streak_started_on into v_streak_days, v_streak_started_on
    from public.get_personal_style_streak(p_classroom_id, v_account.group_member_id);
  if v_streak_days < 5 or v_streak_started_on is null then
    raise exception 'Build a five-event learning streak to unlock a personal style';
  end if;
  select * into v_reward from public.personal_reward_catalog where reward_type = p_choice_type and is_active limit 1;
  if not found then raise exception 'That style choice is unavailable'; end if;
  insert into public.personal_reward_claims(reward_id, user_id, group_member_id, classroom_id, xp_spent, status)
  values(v_reward.id, v_user, v_account.group_member_id, p_classroom_id, 0, 'active') returning * into v_claim;
  insert into public.personal_style_streak_unlocks(classroom_id, group_member_id, streak_started_on)
  values(p_classroom_id, v_account.group_member_id, v_streak_started_on);
  return jsonb_build_object('claimId', v_claim.id, 'title', v_reward.title, 'rewardType', v_reward.reward_type, 'xpSpent', 0);
end;
$$;
