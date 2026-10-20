-- Personal styles are earned through sustained classroom engagement, not XP.
-- One completed five-class-day streak earns one choice. A new choice requires
-- a fresh streak after the previous streak reward has been used.

create table if not exists public.personal_style_streak_unlocks (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  group_member_id uuid not null references public.group_members(id) on delete cascade,
  streak_started_on date not null,
  unlocked_at timestamptz not null default now(),
  unique (classroom_id, group_member_id, streak_started_on)
);

alter table public.personal_style_streak_unlocks enable row level security;

create or replace function public.get_personal_style_streak(
  p_classroom_id uuid,
  p_group_member_id uuid
)
returns table(streak_days integer, streak_started_on date)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_class_days text[];
  v_cursor date := (now() at time zone 'Asia/Manila')::date;
  v_streak integer := 0;
  v_start date := null;
  v_weekday text;
begin
  select coalesce(nullif(c.class_days, array[]::text[]), array['1','2','3','4','5']::text[])
    into v_class_days
  from public.classrooms c
  where c.id = p_classroom_id;

  if v_class_days is null then
    return query select 0, null::date;
    return;
  end if;

  loop
    v_weekday := extract(isodow from v_cursor)::text;
    if not (v_weekday = any(v_class_days)) then
      v_cursor := v_cursor - 1;
      continue;
    end if;

    if exists (
      select 1 from public.attendance a
      where a.classroom_id = p_classroom_id
        and a.group_member_id = p_group_member_id
        and a.status = 'present'
        and a.attendance_date = v_cursor
    ) or exists (
      select 1 from public.activity_scores s
      where s.classroom_id = p_classroom_id
        and s.group_member_id = p_group_member_id
        and s.created_date::date = v_cursor
    ) or exists (
      select 1 from public.mission_submissions m
      where m.classroom_id = p_classroom_id
        and m.group_member_id = p_group_member_id
        and m.created_date::date = v_cursor
    ) then
      v_streak := v_streak + 1;
      v_start := v_cursor;
      v_cursor := v_cursor - 1;
    else
      exit;
    end if;
  end loop;

  return query select v_streak, v_start;
end;
$$;

create or replace function public.get_personal_reward_dashboard(p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_account public.group_accounts%rowtype;
  v_earned numeric; v_redeemed numeric; v_style_choices_used integer;
  v_streak_days integer := 0; v_streak_started_on date := null; v_streak_ready boolean := false;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_account from public.group_accounts
    where user_id = v_user and classroom_id = p_classroom_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved classroom account required'; end if;
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions
    where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id;
  select coalesce(sum(xp_spent), 0) into v_redeemed from public.participation_logs
    where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id
      and event_type = 'mission_redemption';
  select streak_days, streak_started_on into v_streak_days, v_streak_started_on
    from public.get_personal_style_streak(p_classroom_id, v_account.group_member_id);
  select count(*) into v_style_choices_used from public.personal_reward_claims cl
    join public.personal_reward_catalog c on c.id = cl.reward_id
    where cl.user_id = v_user and cl.classroom_id = p_classroom_id
      and c.reward_type in ('avatar_choice', 'theme_choice', 'name_effect_choice');
  v_streak_ready := v_streak_days >= 5 and not exists (
    select 1 from public.personal_style_streak_unlocks u
    where u.classroom_id = p_classroom_id and u.group_member_id = v_account.group_member_id
      and u.streak_started_on = v_streak_started_on
  );
  return jsonb_build_object(
    'earned', v_earned, 'spent', v_redeemed, 'available', greatest(0, v_earned - v_redeemed),
    'style_streak_days', v_streak_days, 'style_streak_ready', v_streak_ready,
    'style_choices_used', v_style_choices_used,
    'catalog', coalesce((select jsonb_agg(to_jsonb(c) order by c.xp_cost, c.title)
      from public.personal_reward_catalog c where c.is_active), '[]'::jsonb),
    'claims', coalesce((select jsonb_agg(jsonb_build_object(
      'id', cl.id, 'reward_id', cl.reward_id, 'title', c.title, 'reward_type', c.reward_type,
      'asset_key', c.asset_key, 'emoji', c.emoji, 'is_consumable', c.is_consumable,
      'status', cl.status, 'is_equipped', cl.is_equipped, 'created_at', cl.created_at
    ) order by cl.created_at desc) from public.personal_reward_claims cl
      join public.personal_reward_catalog c on c.id = cl.reward_id where cl.user_id = v_user), '[]'::jsonb)
  );
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
  if exists (select 1 from public.personal_reward_claims cl join public.personal_reward_catalog c on c.id = cl.reward_id
    where cl.user_id = v_user and cl.classroom_id = p_classroom_id and cl.status = 'active'
      and c.reward_type in ('avatar_choice', 'theme_choice', 'name_effect_choice')) then
    raise exception 'Use your current style choice before unlocking another';
  end if;
  select streak_days, streak_started_on into v_streak_days, v_streak_started_on
    from public.get_personal_style_streak(p_classroom_id, v_account.group_member_id);
  if v_streak_days < 5 or v_streak_started_on is null then
    raise exception 'Build a five-day learning streak to unlock a personal style';
  end if;
  if exists (select 1 from public.personal_style_streak_unlocks u
    where u.classroom_id = p_classroom_id and u.group_member_id = v_account.group_member_id
      and u.streak_started_on = v_streak_started_on) then
    raise exception 'This streak reward was already used. Build a fresh five-day streak for another choice';
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

revoke all on table public.personal_style_streak_unlocks from public;
revoke all on function public.get_personal_style_streak(uuid, uuid) from public;
revoke all on function public.get_personal_reward_dashboard(uuid) from public;
revoke all on function public.unlock_style_choice(text, uuid) from public;
grant execute on function public.get_personal_reward_dashboard(uuid) to authenticated;
grant execute on function public.unlock_style_choice(text, uuid) to authenticated;
