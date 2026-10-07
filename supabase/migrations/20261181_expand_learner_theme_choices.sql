-- Add three visual-only learner themes. A theme still consumes the existing
-- one-time 20-XP theme choice and cannot bypass the 30-XP settlement rule.
create or replace function public.use_style_choice(p_claim_id uuid, p_asset_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_claim public.personal_reward_claims%rowtype; v_reward public.personal_reward_catalog%rowtype;
begin
  select cl.* into v_claim from public.personal_reward_claims cl where cl.id = p_claim_id and cl.user_id = auth.uid() and cl.status = 'active' for update;
  if not found then raise exception 'That style choice is no longer available'; end if;
  select * into v_reward from public.personal_reward_catalog where id = v_claim.reward_id;
  if (v_reward.reward_type = 'avatar_choice' and p_asset_key !~ '^avatar-([1-9]|[12][0-9]|30)$')
     or (v_reward.reward_type = 'theme_choice' and p_asset_key not in ('sky-banner','sunset-banner','starry-banner','meadow-banner','ocean-banner','candy-banner')) then
    raise exception 'That style is not available';
  end if;
  update public.personal_reward_claims set status = 'used', used_at = now(), is_equipped = true where id = v_claim.id;
  return jsonb_build_object('choiceType', v_reward.reward_type, 'assetKey', p_asset_key);
end;
$$;

revoke all on function public.use_style_choice(uuid, text) from public;
grant execute on function public.use_style_choice(uuid, text) to authenticated;
