-- The first 30 supplied 3D avatars are available as one-time 20-XP choices.
-- Avatar and theme choices remain available only while the learner's personal
-- wallet is between 20 and 29 XP; the 30-XP settlement rule is enforced by
-- unlock_style_choice and mission-submission safeguards from 20261179.
alter table public.student_avatar_preferences
  drop constraint if exists student_avatar_preferences_avatar_key_check;
alter table public.student_avatar_preferences
  add constraint student_avatar_preferences_avatar_key_check check (
    avatar_key ~ '^avatar-([1-9]|[12][0-9]|30)$'
  );

create or replace function public.set_my_student_avatar(p_avatar_key text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if p_avatar_key !~ '^avatar-([1-9]|[12][0-9]|30)$' then
    raise exception 'That avatar is not available';
  end if;
  insert into public.student_avatar_preferences (user_id, avatar_key, updated_at)
  values (auth.uid(), p_avatar_key, now())
  on conflict (user_id) do update set avatar_key = excluded.avatar_key, updated_at = excluded.updated_at;
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
     or (v_reward.reward_type = 'theme_choice' and p_asset_key not in ('sky-banner','sunset-banner','starry-banner')) then
    raise exception 'That style is not available';
  end if;
  update public.personal_reward_claims set status = 'used', used_at = now(), is_equipped = true where id = v_claim.id;
  return jsonb_build_object('choiceType', v_reward.reward_type, 'assetKey', p_asset_key);
end;
$$;

revoke all on function public.set_my_student_avatar(text) from public;
revoke all on function public.use_style_choice(uuid, text) from public;
grant execute on function public.set_my_student_avatar(text) to authenticated;
grant execute on function public.use_style_choice(uuid, text) to authenticated;
