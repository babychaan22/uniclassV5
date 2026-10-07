-- Students may convert any 10-XP increment to one participation point.
-- A 30-XP wallet must be brought below 30 before it can fund another style
-- choice, matching the existing guard that pauses new mission submissions.
create or replace function public.unlock_style_choice(p_choice_type text, p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_account public.group_accounts%rowtype;
  v_reward public.personal_reward_catalog%rowtype; v_earned numeric; v_spent numeric;
  v_claim public.personal_reward_claims%rowtype;
begin
  if p_choice_type not in ('avatar_choice', 'theme_choice') then raise exception 'Unknown style choice'; end if;
  select * into v_account from public.group_accounts where user_id = v_user and classroom_id = p_classroom_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved classroom account required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_classroom_id::text, 0));
  if exists (select 1 from public.personal_reward_claims cl join public.personal_reward_catalog c on c.id = cl.reward_id where cl.user_id = v_user and cl.classroom_id = p_classroom_id and cl.status = 'active' and c.reward_type in ('avatar_choice', 'theme_choice')) then
    raise exception 'Use your current style choice before unlocking another';
  end if;
  select * into v_reward from public.personal_reward_catalog where reward_type = p_choice_type and is_active limit 1;
  if not found then raise exception 'That style choice is unavailable'; end if;
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id;
  select coalesce(sum(xp_spent), 0) into v_spent from public.personal_reward_claims where user_id = v_user and classroom_id = p_classroom_id;
  select v_spent + coalesce(sum(xp_spent), 0) into v_spent from public.participation_logs where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id and event_type = 'mission_redemption';
  if v_earned - v_spent >= 30 then
    raise exception 'Redeem at least 10 XP into participation points before choosing another style';
  end if;
  if v_earned - v_spent < 20 then raise exception 'You need % more XP for a style choice', 20 - (v_earned - v_spent); end if;
  insert into public.personal_reward_claims(reward_id, user_id, group_member_id, classroom_id, xp_spent)
  values (v_reward.id, v_user, v_account.group_member_id, p_classroom_id, 20) returning * into v_claim;
  return jsonb_build_object('claimId', v_claim.id, 'choiceType', p_choice_type, 'xpSpent', 20);
end;
$$;

create or replace function public.enforce_xp_wallet_settlement()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_earned numeric; v_spent numeric;
begin
  if auth_is_teacher_of(new.classroom_id) then return new; end if;
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions where group_member_id = new.group_member_id and classroom_id = new.classroom_id;
  select coalesce(sum(xp_spent), 0) into v_spent from public.personal_reward_claims where user_id = auth.uid() and classroom_id = new.classroom_id;
  select v_spent + coalesce(sum(xp_spent), 0) into v_spent from public.participation_logs where group_member_id = new.group_member_id and classroom_id = new.classroom_id and event_type = 'mission_redemption';
  if v_earned - v_spent >= 30 then
    raise exception 'Redeem at least 10 XP into participation points before starting another mission.';
  end if;
  return new;
end;
$$;

revoke all on function public.unlock_style_choice(text, uuid) from public;
grant execute on function public.unlock_style_choice(text, uuid) to authenticated;
