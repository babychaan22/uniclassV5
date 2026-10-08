-- Keep the Rewards balance, XP converter, and mission guard on one wallet
-- calculation. Older deployments counted redemptions in the converter but not
-- in the displayed balance, so a learner could be offered XP they had already
-- spent and receive a misleading "not enough" error.

create or replace function public.get_personal_reward_dashboard(p_classroom_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_account public.group_accounts%rowtype;
  v_earned numeric;
  v_personal_spent numeric;
  v_redeemed numeric;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_account
  from public.group_accounts
  where user_id = v_user and classroom_id = p_classroom_id and is_approved = true
  limit 1;
  if not found or v_account.group_member_id is null then
    raise exception 'Approved classroom account required';
  end if;

  select coalesce(sum(xp_earned), 0) into v_earned
  from public.mission_submissions
  where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id;

  select coalesce(sum(xp_spent), 0) into v_personal_spent
  from public.personal_reward_claims
  where user_id = v_user and classroom_id = p_classroom_id;

  select coalesce(sum(xp_spent), 0) into v_redeemed
  from public.participation_logs
  where group_member_id = v_account.group_member_id
    and classroom_id = p_classroom_id
    and event_type = 'mission_redemption';

  return jsonb_build_object(
    'earned', v_earned,
    'spent', v_personal_spent + v_redeemed,
    'available', greatest(0, v_earned - v_personal_spent - v_redeemed),
    'catalog', coalesce((select jsonb_agg(to_jsonb(c) order by c.xp_cost, c.title)
      from public.personal_reward_catalog c where c.is_active), '[]'::jsonb),
    'claims', coalesce((select jsonb_agg(jsonb_build_object(
      'id', cl.id, 'reward_id', cl.reward_id, 'title', c.title, 'reward_type', c.reward_type,
      'asset_key', c.asset_key, 'emoji', c.emoji, 'is_consumable', c.is_consumable,
      'status', cl.status, 'is_equipped', cl.is_equipped, 'created_at', cl.created_at
    ) order by cl.created_at desc)
      from public.personal_reward_claims cl
      join public.personal_reward_catalog c on c.id = cl.reward_id
      where cl.user_id = v_user), '[]'::jsonb)
  );
end;
$$;

create or replace function public.redeem_mission_points(p_amount numeric, p_classroom_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_account public.group_accounts%rowtype;
  v_earned numeric;
  v_personal_spent numeric;
  v_redeemed numeric;
  v_available numeric;
  v_points integer;
begin
  if p_amount is null or p_amount < 10 or mod(p_amount, 10) <> 0 then
    raise exception 'Redeem XP in multiples of 10';
  end if;

  select * into v_account
  from public.group_accounts
  where user_id = v_user and classroom_id = p_classroom_id and is_approved = true
  limit 1;
  if not found or v_account.group_member_id is null then
    raise exception 'Approved classroom account required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_classroom_id::text, 0));

  select coalesce(sum(xp_earned), 0) into v_earned
  from public.mission_submissions
  where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id;
  select coalesce(sum(xp_spent), 0) into v_personal_spent
  from public.personal_reward_claims
  where user_id = v_user and classroom_id = p_classroom_id;
  select coalesce(sum(xp_spent), 0) into v_redeemed
  from public.participation_logs
  where group_member_id = v_account.group_member_id
    and classroom_id = p_classroom_id
    and event_type = 'mission_redemption';

  v_available := greatest(0, v_earned - v_personal_spent - v_redeemed);
  if p_amount > v_available then
    raise exception 'Not enough personal mission XP available';
  end if;

  v_points := trunc(p_amount / 10)::integer;
  insert into public.participation_logs(
    group_member_id, group_id, classroom_id, points_awarded, xp_spent,
    event_type, multiplier, recipient_type, note
  ) values (
    v_account.group_member_id, v_account.group_id, v_account.classroom_id,
    v_points, p_amount, 'mission_redemption', 1, 'member',
    format('%s XP redeemed for %s participation point%s', p_amount::integer, v_points,
      case when v_points = 1 then '' else 's' end)
  );

  return jsonb_build_object(
    'xpAmount', p_amount::integer,
    'pointsAwarded', v_points,
    'xpRemaining', v_available - p_amount,
    'groupId', v_account.group_id,
    'memberId', v_account.group_member_id
  );
end;
$$;

revoke all on function public.get_personal_reward_dashboard(uuid) from public;
revoke all on function public.redeem_mission_points(numeric, uuid) from public;
grant execute on function public.get_personal_reward_dashboard(uuid) to authenticated;
grant execute on function public.redeem_mission_points(numeric, uuid) to authenticated;
