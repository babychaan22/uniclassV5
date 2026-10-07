-- Profile cosmetics are choices, not a permanent inventory. A learner spends
-- 20 XP to make one avatar OR theme choice; using it consumes the choice.
alter table public.personal_reward_catalog
  drop constraint if exists personal_reward_catalog_reward_type_check;
alter table public.personal_reward_catalog
  add constraint personal_reward_catalog_reward_type_check check (reward_type in (
    'learning_privilege', 'avatar_frame', 'nova_accessory', 'banner_theme',
    'profile_sticker', 'avatar_choice', 'theme_choice'
  ));

update public.personal_reward_catalog set is_active = false;
insert into public.personal_reward_catalog(title, description, reward_type, asset_key, emoji, xp_cost, is_consumable, is_active)
values
  ('Choose an avatar', 'Use this one-time style choice to equip one avatar.', 'avatar_choice', 'avatar-choice', '🙂', 20, false, true),
  ('Choose a learner theme', 'Use this one-time style choice to equip Sky, Sunset, or Starry.', 'theme_choice', 'theme-choice', '🎨', 20, false, true)
on conflict (asset_key) do update set title = excluded.title, description = excluded.description,
  reward_type = excluded.reward_type, xp_cost = excluded.xp_cost, is_consumable = false, is_active = true;

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
  if v_earned - v_spent < 20 then raise exception 'You need % more XP for a style choice', 20 - (v_earned - v_spent); end if;
  insert into public.personal_reward_claims(reward_id, user_id, group_member_id, classroom_id, xp_spent)
  values (v_reward.id, v_user, v_account.group_member_id, p_classroom_id, 20) returning * into v_claim;
  return jsonb_build_object('claimId', v_claim.id, 'choiceType', p_choice_type, 'xpSpent', 20);
end;
$$;

create or replace function public.use_style_choice(p_claim_id uuid, p_asset_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_claim public.personal_reward_claims%rowtype; v_reward public.personal_reward_catalog%rowtype;
begin
  select cl.* into v_claim from public.personal_reward_claims cl where cl.id = p_claim_id and cl.user_id = auth.uid() and cl.status = 'active' for update;
  if not found then raise exception 'That style choice is no longer available'; end if;
  select * into v_reward from public.personal_reward_catalog where id = v_claim.reward_id;
  if (v_reward.reward_type = 'avatar_choice' and p_asset_key not in ('avatar-1','avatar-2','avatar-3','avatar-4','avatar-5','avatar-6','avatar-7','avatar-8','avatar-9','avatar-10','avatar-11','avatar-12'))
     or (v_reward.reward_type = 'theme_choice' and p_asset_key not in ('sky-banner','sunset-banner','starry-banner')) then
    raise exception 'That style is not available';
  end if;
  update public.personal_reward_claims set status = 'used', used_at = now(), is_equipped = true where id = v_claim.id;
  return jsonb_build_object('choiceType', v_reward.reward_type, 'assetKey', p_asset_key);
end;
$$;

-- A wallet at 30 XP must be settled through the converter before another
-- mission can add more XP. The trigger also protects direct API calls.
create or replace function public.enforce_xp_wallet_settlement()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_earned numeric; v_spent numeric;
begin
  if auth_is_teacher_of(new.classroom_id) then return new; end if;
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions where group_member_id = new.group_member_id and classroom_id = new.classroom_id;
  select coalesce(sum(xp_spent), 0) into v_spent from public.personal_reward_claims where user_id = auth.uid() and classroom_id = new.classroom_id;
  select v_spent + coalesce(sum(xp_spent), 0) into v_spent from public.participation_logs where group_member_id = new.group_member_id and classroom_id = new.classroom_id and event_type = 'mission_redemption';
  if v_earned - v_spent >= 30 then
    raise exception 'Your XP wallet has 30 or more XP. Redeem XP in Rewards before starting another mission.';
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_xp_wallet_settlement on public.mission_submissions;
create trigger enforce_xp_wallet_settlement before insert on public.mission_submissions
  for each row execute function public.enforce_xp_wallet_settlement();

revoke all on function public.unlock_style_choice(text, uuid) from public;
revoke all on function public.use_style_choice(uuid, text) from public;
grant execute on function public.unlock_style_choice(text, uuid) to authenticated;
grant execute on function public.use_style_choice(uuid, text) to authenticated;
