-- The legacy rewards migration was assigned a later version to resolve a
-- historical timestamp collision. Reapply the earned-style rules afterwards.

alter table public.personal_reward_claims
  drop constraint if exists personal_reward_claims_xp_spent_check;
alter table public.personal_reward_claims
  add constraint personal_reward_claims_xp_spent_check check (xp_spent >= 0);

create or replace function public.get_personal_reward_dashboard(p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_account public.group_accounts%rowtype;
  v_earned numeric; v_redeemed numeric; v_style_choices_used integer;
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
  select count(*) into v_style_choices_used from public.personal_reward_claims cl
    join public.personal_reward_catalog c on c.id = cl.reward_id
    where cl.user_id = v_user and cl.classroom_id = p_classroom_id
      and c.reward_type in ('avatar_choice', 'theme_choice', 'name_effect_choice');
  return jsonb_build_object(
    'earned', v_earned, 'spent', v_redeemed, 'available', greatest(0, v_earned - v_redeemed),
    'style_choices_earned', floor(v_earned / 20), 'style_choices_used', v_style_choices_used,
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
  v_reward public.personal_reward_catalog%rowtype; v_earned numeric; v_used integer;
  v_claim public.personal_reward_claims%rowtype;
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
  select * into v_reward from public.personal_reward_catalog where reward_type = p_choice_type and is_active limit 1;
  if not found then raise exception 'That style choice is unavailable'; end if;
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions
    where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id;
  select count(*) into v_used from public.personal_reward_claims cl join public.personal_reward_catalog c on c.id = cl.reward_id
    where cl.user_id = v_user and cl.classroom_id = p_classroom_id
      and c.reward_type in ('avatar_choice', 'theme_choice', 'name_effect_choice');
  if v_earned < (v_used + 1) * v_reward.xp_cost then
    raise exception 'Earn % more XP for another style choice', (v_used + 1) * v_reward.xp_cost - v_earned;
  end if;
  insert into public.personal_reward_claims(reward_id, user_id, group_member_id, classroom_id, xp_spent, status)
  values(v_reward.id, v_user, v_account.group_member_id, p_classroom_id, 0, 'active') returning * into v_claim;
  return jsonb_build_object('claimId', v_claim.id, 'title', v_reward.title, 'rewardType', v_reward.reward_type, 'xpSpent', 0);
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
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions
    where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id;
  select coalesce(sum(xp_spent), 0) into v_redeemed from public.participation_logs
    where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id
      and event_type = 'mission_redemption';
  v_available := greatest(0, v_earned - v_redeemed);
  if p_amount > v_available then raise exception 'Not enough personal mission XP available'; end if;
  v_points := trunc(p_amount / 10)::integer;
  insert into public.participation_logs(group_member_id, group_id, classroom_id, points_awarded, xp_spent, event_type, multiplier, recipient_type, note)
  values (v_account.group_member_id, v_account.group_id, v_account.classroom_id, v_points, p_amount,
    'mission_redemption', 1, 'member', format('%s XP redeemed for %s participation point%s', p_amount::integer, v_points, case when v_points = 1 then '' else 's' end));
  return jsonb_build_object('xpAmount', p_amount::integer, 'pointsAwarded', v_points,
    'xpRemaining', v_available - p_amount, 'groupId', v_account.group_id, 'memberId', v_account.group_member_id);
end;
$$;

create or replace function public.enforce_xp_wallet_settlement()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_earned numeric; v_redeemed numeric;
begin
  if auth_is_teacher_of(new.classroom_id) then return new; end if;
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions
    where group_member_id = new.group_member_id and classroom_id = new.classroom_id;
  select coalesce(sum(xp_spent), 0) into v_redeemed from public.participation_logs
    where group_member_id = new.group_member_id and classroom_id = new.classroom_id
      and event_type = 'mission_redemption';
  if v_earned - v_redeemed >= 30 then
    raise exception 'Your XP wallet has 30 or more XP. Redeem XP in Rewards before starting another mission.';
  end if;
  return new;
end;
$$;

revoke all on function public.get_personal_reward_dashboard(uuid) from public;
revoke all on function public.unlock_style_choice(text, uuid) from public;
revoke all on function public.redeem_mission_points(numeric, uuid) from public;
grant execute on function public.get_personal_reward_dashboard(uuid) to authenticated;
grant execute on function public.unlock_style_choice(text, uuid) to authenticated;
grant execute on function public.redeem_mission_points(numeric, uuid) to authenticated;
