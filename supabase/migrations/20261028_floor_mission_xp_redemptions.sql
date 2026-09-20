-- A student may type any whole XP balance. Only complete blocks of 10 XP are
-- redeemed; the remainder stays in their personal mission XP balance.

create or replace function public.redeem_mission_points(p_amount numeric, p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_account public.group_accounts%rowtype;
  v_earned numeric;
  v_redeemed numeric;
  v_available numeric;
  v_xp_to_redeem integer;
  v_points integer;
begin
  if p_amount is null or p_amount < 10 then raise exception 'Enter at least 10 XP to redeem a participation point'; end if;
  select * into v_account from public.group_accounts
    where user_id = v_user and classroom_id = p_classroom_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved classroom account required'; end if;
  perform 1 from public.group_members where id = v_account.group_member_id for update;
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions where group_member_id = v_account.group_member_id;
  select coalesce(sum(xp_spent), 0) into v_redeemed from public.participation_logs
    where group_member_id = v_account.group_member_id and event_type = 'mission_redemption';
  v_available := greatest(0, v_earned - v_redeemed);
  v_xp_to_redeem := floor(least(p_amount, v_available) / 10)::integer * 10;
  if v_xp_to_redeem < 10 then raise exception 'Not enough personal mission XP available'; end if;
  v_points := v_xp_to_redeem / 10;
  insert into public.participation_logs(
    group_member_id, group_id, classroom_id, points_awarded, xp_spent, event_type, multiplier, recipient_type, note
  ) values (
    v_account.group_member_id, v_account.group_id, v_account.classroom_id, v_points, v_xp_to_redeem,
    'mission_redemption', 1, 'member', format('%s XP redeemed for %s participation point%s', v_xp_to_redeem, v_points, case when v_points = 1 then '' else 's' end)
  );
  return jsonb_build_object('xpAmount', v_xp_to_redeem, 'pointsAwarded', v_points, 'xpRemaining', v_available - v_xp_to_redeem, 'groupId', v_account.group_id, 'memberId', v_account.group_member_id);
end;
$$;

create or replace function public.redeem_mission_points(p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_classroom_id uuid;
begin
  select classroom_id into v_classroom_id from public.group_accounts
  where user_id = auth.uid() and is_approved = true
  order by created_date asc limit 1;
  if v_classroom_id is null then raise exception 'Approved classroom account required'; end if;
  return public.redeem_mission_points(p_amount, v_classroom_id);
end;
$$;

revoke all on function public.redeem_mission_points(numeric,uuid) from public;
revoke all on function public.redeem_mission_points(numeric) from public;
grant execute on function public.redeem_mission_points(numeric,uuid) to authenticated;
grant execute on function public.redeem_mission_points(numeric) to authenticated;
