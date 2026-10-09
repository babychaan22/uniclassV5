-- Add a reusable name-style unlock and bring the database validation in line
-- with the six learner themes exposed in Settings.
alter table public.personal_reward_catalog
  drop constraint if exists personal_reward_catalog_reward_type_check;
alter table public.personal_reward_catalog
  add constraint personal_reward_catalog_reward_type_check check (reward_type in (
    'learning_privilege', 'avatar_frame', 'nova_accessory', 'banner_theme',
    'profile_sticker', 'avatar_choice', 'theme_choice', 'name_effect_choice'
  ));

insert into public.personal_reward_catalog(title, description, reward_type, asset_key, emoji, xp_cost, is_consumable, is_active)
values ('Choose a name style', 'Use this one-time style choice to give your name a look that feels like you.', 'name_effect_choice', 'name-effect-choice', '✨', 20, false, true)
on conflict (asset_key) do update set title = excluded.title, description = excluded.description,
  reward_type = excluded.reward_type, xp_cost = excluded.xp_cost, is_consumable = false, is_active = true;

create or replace function public.unlock_style_choice(p_choice_type text, p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_account public.group_accounts%rowtype;
  v_reward public.personal_reward_catalog%rowtype; v_earned numeric; v_spent numeric;
  v_claim public.personal_reward_claims%rowtype;
begin
  if p_choice_type not in ('avatar_choice', 'theme_choice', 'name_effect_choice') then raise exception 'Unknown style choice'; end if;
  select * into v_account from public.group_accounts where user_id = v_user and classroom_id = p_classroom_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved classroom account required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_classroom_id::text, 0));
  if exists (select 1 from public.personal_reward_claims cl join public.personal_reward_catalog c on c.id = cl.reward_id where cl.user_id = v_user and cl.classroom_id = p_classroom_id and cl.status = 'active' and c.reward_type in ('avatar_choice', 'theme_choice', 'name_effect_choice')) then
    raise exception 'Use your current style choice before unlocking another';
  end if;
  select * into v_reward from public.personal_reward_catalog where reward_type = p_choice_type and is_active limit 1;
  if not found then raise exception 'That style choice is unavailable'; end if;
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id;
  select coalesce(sum(xp_spent), 0) into v_spent from public.personal_reward_claims where user_id = v_user and classroom_id = p_classroom_id;
  if v_earned - v_spent >= 30 then raise exception 'Redeem at least 10 XP into participation points before unlocking another style'; end if;
  if v_earned - v_spent < v_reward.xp_cost then raise exception 'Not enough personal XP'; end if;
  insert into public.personal_reward_claims(reward_id, user_id, group_member_id, classroom_id, xp_spent, status)
  values(v_reward.id, v_user, v_account.group_member_id, p_classroom_id, v_reward.xp_cost, 'active') returning * into v_claim;
  return jsonb_build_object('claimId', v_claim.id, 'title', v_reward.title, 'rewardType', v_reward.reward_type, 'xpSpent', v_claim.xp_spent);
end;
$$;

create or replace function public.use_style_choice(p_claim_id uuid, p_asset_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_claim public.personal_reward_claims%rowtype; v_reward public.personal_reward_catalog%rowtype;
begin
  select cl.* into v_claim from public.personal_reward_claims cl where cl.id = p_claim_id and cl.user_id = auth.uid() and cl.status = 'active' for update;
  if not found then raise exception 'That style choice is no longer available'; end if;
  select * into v_reward from public.personal_reward_catalog where id = v_claim.reward_id;
  if (v_reward.reward_type = 'avatar_choice' and p_asset_key !~ '^avatar-([1-9]|[12][0-9]|30)$')
     or (v_reward.reward_type = 'theme_choice' and p_asset_key not in ('sky-banner','sunset-banner','starry-banner','meadow-banner','ocean-banner','candy-banner'))
     or (v_reward.reward_type = 'name_effect_choice' and p_asset_key not in ('neon-violet','neon-sky','soft-glow','opaque-ink')) then
    raise exception 'That style is not available';
  end if;
  update public.personal_reward_claims set status = 'used', used_at = now(), is_equipped = true where id = v_claim.id;
  return jsonb_build_object('choiceType', v_reward.reward_type, 'assetKey', p_asset_key);
end;
$$;

revoke all on function public.unlock_style_choice(text, uuid) from public;
revoke all on function public.use_style_choice(uuid, text) from public;
grant execute on function public.unlock_style_choice(text, uuid) to authenticated;
grant execute on function public.use_style_choice(uuid, text) to authenticated;

-- Name styles are classroom-facing cosmetics, just like avatars. Store them
-- outside private auth metadata so classmates and teachers render the same look.
create table if not exists public.student_name_style_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name_effect text not null default 'opaque-ink' check (name_effect in ('neon-violet','neon-sky','soft-glow','opaque-ink')),
  updated_at timestamptz not null default now()
);

alter table public.group_members add column if not exists name_effect text not null default 'opaque-ink'
  check (name_effect in ('neon-violet','neon-sky','soft-glow','opaque-ink'));

alter table public.student_name_style_preferences enable row level security;
drop policy if exists "student_manage_own_name_style" on public.student_name_style_preferences;
create policy "student_manage_own_name_style" on public.student_name_style_preferences
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.set_my_student_name_effect(p_name_effect text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if p_name_effect not in ('neon-violet','neon-sky','soft-glow','opaque-ink') then raise exception 'That name style is not available'; end if;
  insert into public.student_name_style_preferences (user_id, name_effect, updated_at)
  values (auth.uid(), p_name_effect, now())
  on conflict (user_id) do update set name_effect = excluded.name_effect, updated_at = excluded.updated_at;
  update public.group_members member set name_effect = p_name_effect
  from public.group_accounts account
  where account.user_id = auth.uid() and account.group_member_id = member.id and account.is_approved = true;
end;
$$;

drop function if exists public.get_classroom_student_avatars(uuid);
create function public.get_classroom_student_avatars(p_classroom_id uuid)
returns table (group_member_id uuid, avatar_key text, name_effect text)
language sql security definer set search_path = public stable as $$
  select ga.group_member_id, coalesce(avatar.avatar_key, 'avatar-11'), coalesce(style.name_effect, 'opaque-ink')
  from public.group_accounts ga
  left join public.student_avatar_preferences avatar on avatar.user_id = ga.user_id
  left join public.student_name_style_preferences style on style.user_id = ga.user_id
  where ga.classroom_id = p_classroom_id and ga.is_approved = true and ga.group_member_id is not null
    and (public.auth_is_teacher_of(p_classroom_id) or exists (
      select 1 from public.group_accounts mine
      where mine.classroom_id = p_classroom_id and mine.user_id = auth.uid() and mine.is_approved = true
    ));
$$;

revoke all on function public.set_my_student_name_effect(text) from public;
grant execute on function public.set_my_student_name_effect(text) to authenticated;
revoke all on function public.get_classroom_student_avatars(uuid) from public;
grant execute on function public.get_classroom_student_avatars(uuid) to authenticated;
