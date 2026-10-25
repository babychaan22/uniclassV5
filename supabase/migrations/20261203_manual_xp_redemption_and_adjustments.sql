-- Preserve independently audited opening-balance corrections without changing
-- mission submissions or past participation point redemptions.
create table if not exists public.personal_xp_adjustments (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id),
  group_member_id uuid not null references public.group_members(id),
  amount numeric not null check (amount <> 0),
  reason text not null,
  reference text not null unique,
  created_at timestamptz not null default now()
);
alter table public.personal_xp_adjustments enable row level security;
revoke all on public.personal_xp_adjustments from public, anon, authenticated;

create or replace function public.get_personal_reward_dashboard(p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_account public.group_accounts%rowtype;
  v_earned numeric; v_redeemed numeric; v_style_choices_used integer;
  v_streak_days integer := 0; v_streak_started_on date := null; v_streak_ready boolean := false;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_account from public.group_accounts where user_id = v_user and classroom_id = p_classroom_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved classroom account required'; end if;
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id;
  select v_earned + coalesce(sum(amount), 0) into v_earned from public.personal_xp_adjustments where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id;
  select coalesce(sum(xp_spent), 0) into v_redeemed from public.participation_logs where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id and event_type = 'mission_redemption';
  select streak_days, streak_started_on into v_streak_days, v_streak_started_on from public.get_personal_style_streak(p_classroom_id, v_account.group_member_id);
  select count(*) into v_style_choices_used from public.personal_reward_claims cl join public.personal_reward_catalog c on c.id = cl.reward_id where cl.user_id = v_user and cl.classroom_id = p_classroom_id and c.reward_type in ('avatar_choice', 'theme_choice', 'name_effect_choice');
  v_streak_ready := v_streak_days >= 5 and not exists (select 1 from public.personal_style_streak_unlocks u where u.classroom_id = p_classroom_id and u.group_member_id = v_account.group_member_id and u.streak_started_on = v_streak_started_on);
  return jsonb_build_object(
    'earned', v_earned, 'spent', v_redeemed, 'available', greatest(0, v_earned - v_redeemed),
    'style_streak_days', v_streak_days, 'style_streak_ready', v_streak_ready, 'style_choices_used', v_style_choices_used,
    'catalog', coalesce((select jsonb_agg(to_jsonb(c) order by c.xp_cost, c.title) from public.personal_reward_catalog c where c.is_active), '[]'::jsonb),
    'claims', coalesce((select jsonb_agg(jsonb_build_object('id', cl.id, 'reward_id', cl.reward_id, 'title', c.title, 'reward_type', c.reward_type, 'asset_key', c.asset_key, 'emoji', c.emoji, 'is_consumable', c.is_consumable, 'status', cl.status, 'is_equipped', cl.is_equipped, 'created_at', cl.created_at) order by cl.created_at desc) from public.personal_reward_claims cl join public.personal_reward_catalog c on c.id = cl.reward_id where cl.user_id = v_user), '[]'::jsonb));
end;
$$;

create or replace function public.redeem_mission_points(p_amount numeric, p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_account public.group_accounts%rowtype;
  v_earned numeric; v_redeemed numeric; v_available numeric; v_points integer;
begin
  if p_amount is null or p_amount < 10 or mod(p_amount, 10) <> 0 then raise exception 'Redeem XP in multiples of 10'; end if;
  select * into v_account from public.group_accounts where user_id = v_user and classroom_id = p_classroom_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved classroom account required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_classroom_id::text, 0));
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id;
  select v_earned + coalesce(sum(amount), 0) into v_earned from public.personal_xp_adjustments where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id;
  select coalesce(sum(xp_spent), 0) into v_redeemed from public.participation_logs where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id and event_type = 'mission_redemption';
  v_available := greatest(0, v_earned - v_redeemed);
  if p_amount > v_available then raise exception 'Not enough personal mission XP available'; end if;
  v_points := trunc(p_amount / 10)::integer;
  insert into public.participation_logs(group_member_id, group_id, classroom_id, points_awarded, xp_spent, event_type, multiplier, recipient_type, note)
  values (v_account.group_member_id, v_account.group_id, v_account.classroom_id, v_points, p_amount, 'mission_redemption', 1, 'member', format('%s XP redeemed for %s participation point%s', p_amount::integer, v_points, case when v_points = 1 then '' else 's' end));
  return jsonb_build_object('xpAmount', p_amount::integer, 'pointsAwarded', v_points, 'xpRemaining', v_available - p_amount, 'groupId', v_account.group_id, 'memberId', v_account.group_member_id);
end;
$$;

-- Students may keep earning XP without being forced to redeem it.
create or replace function public.enforce_xp_wallet_settlement()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin return new; end;
$$;
