-- Personal XP rewards are deliberately separate from group reward thresholds.
-- XP buys individual learning privileges and collectible profile items; group
-- participation points continue to unlock shared classroom goals.

create table if not exists public.personal_reward_catalog (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  reward_type text not null check (reward_type in ('learning_privilege', 'avatar_frame', 'nova_accessory', 'banner_theme', 'profile_sticker')),
  asset_key text not null unique,
  emoji text not null default '✨',
  xp_cost integer not null check (xp_cost > 0 and xp_cost <= 500),
  is_consumable boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.personal_reward_claims (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.personal_reward_catalog(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  group_member_id uuid references public.group_members(id) on delete set null,
  classroom_id uuid references public.classrooms(id) on delete set null,
  xp_spent integer not null check (xp_spent > 0),
  status text not null default 'active' check (status in ('active', 'used')),
  is_equipped boolean not null default false,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index if not exists personal_reward_claims_student_created
  on public.personal_reward_claims(user_id, created_at desc);

-- Seeded system rewards make the feature useful on first release. Teachers
-- retain control over group goals; these are individual and non-grade-related.
insert into public.personal_reward_catalog(title, description, reward_type, asset_key, emoji, xp_cost, is_consumable)
select seed.title, seed.description, seed.reward_type, seed.asset_key, seed.emoji, seed.xp_cost, seed.is_consumable
from (values
  ('Hint token', 'Ask for one helpful hint during a mission.', 'learning_privilege', 'hint-token', '💡', 15, true),
  ('Retry token', 'Ask your teacher to reopen one finished practice attempt.', 'learning_privilege', 'retry-token', '🔁', 25, true),
  ('Pick a practice topic', 'Choose one practice topic for an upcoming warm-up.', 'learning_privilege', 'practice-topic', '🎯', 30, true),
  ('Warm-up chooser', 'Choose from your teacher’s warm-up options.', 'learning_privilege', 'warmup-chooser', '🧠', 35, true),
  ('Star frame', 'A bright frame for your profile avatar.', 'avatar_frame', 'star-frame', '⭐', 20, false),
  ('Rainbow frame', 'A colourful frame for your profile avatar.', 'avatar_frame', 'rainbow-frame', '🌈', 35, false),
  ('Nova cap', 'A celebratory cap for Nova on your profile.', 'nova_accessory', 'nova-cap', '🧢', 30, false),
  ('Nova sparkle', 'A sparkle effect for Nova on your profile.', 'nova_accessory', 'nova-sparkle', '✨', 40, false),
  ('Sky banner', 'A calm blue banner for your profile.', 'banner_theme', 'sky-banner', '☁️', 25, false),
  ('Sunset banner', 'A warm sunset banner for your profile.', 'banner_theme', 'sunset-banner', '🌅', 35, false),
  ('Curious sticker', 'A sticker that celebrates thoughtful questions.', 'profile_sticker', 'curious-sticker', '🔎', 15, false),
  ('Team player sticker', 'A sticker that celebrates helping others learn.', 'profile_sticker', 'team-player-sticker', '🤝', 15, false)
) as seed(title, description, reward_type, asset_key, emoji, xp_cost, is_consumable)
where not exists (select 1 from public.personal_reward_catalog c where c.asset_key = seed.asset_key);

alter table public.personal_reward_catalog enable row level security;
alter table public.personal_reward_claims enable row level security;

-- Claims only move through the functions below. This prevents client-side XP
-- edits and lets the database atomically check the learner's balance.
create or replace function public.get_personal_reward_dashboard(p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_account public.group_accounts%rowtype;
  v_earned numeric;
  v_spent numeric;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_account from public.group_accounts
    where user_id = v_user and classroom_id = p_classroom_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved classroom account required'; end if;
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions
    where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id;
  select coalesce(sum(xp_spent), 0) into v_spent from public.personal_reward_claims
    where user_id = v_user and classroom_id = p_classroom_id;
  select v_spent + coalesce(sum(xp_spent), 0) into v_spent from public.participation_logs
    where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id
      and event_type = 'mission_redemption';
  return jsonb_build_object(
    'earned', v_earned,
    'spent', v_spent,
    'available', greatest(0, v_earned - v_spent),
    'catalog', coalesce((select jsonb_agg(to_jsonb(c) order by c.xp_cost, c.title) from public.personal_reward_catalog c where c.is_active), '[]'::jsonb),
    'claims', coalesce((select jsonb_agg(jsonb_build_object(
      'id', cl.id, 'reward_id', cl.reward_id, 'title', c.title, 'reward_type', c.reward_type,
      'asset_key', c.asset_key, 'emoji', c.emoji, 'is_consumable', c.is_consumable,
      'status', cl.status, 'is_equipped', cl.is_equipped, 'created_at', cl.created_at
    ) order by cl.created_at desc) from public.personal_reward_claims cl
      join public.personal_reward_catalog c on c.id = cl.reward_id where cl.user_id = v_user), '[]'::jsonb)
  );
end;
$$;

create or replace function public.claim_personal_reward(p_reward_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_account public.group_accounts%rowtype;
  v_reward public.personal_reward_catalog%rowtype; v_claim public.personal_reward_claims%rowtype;
  v_earned numeric; v_spent numeric;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_account from public.group_accounts where user_id = v_user and classroom_id = p_classroom_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved classroom account required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_classroom_id::text, 0));
  select * into v_reward from public.personal_reward_catalog where id = p_reward_id and is_active for update;
  if not found then raise exception 'This personal reward is no longer available'; end if;
  if not v_reward.is_consumable and exists (select 1 from public.personal_reward_claims where reward_id = v_reward.id and user_id = v_user) then
    raise exception 'You already own this collectible';
  end if;
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id;
  select coalesce(sum(xp_spent), 0) into v_spent from public.personal_reward_claims where user_id = v_user and classroom_id = p_classroom_id;
  select v_spent + coalesce(sum(xp_spent), 0) into v_spent from public.participation_logs
    where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id
      and event_type = 'mission_redemption';
  if v_earned - v_spent < v_reward.xp_cost then raise exception 'You need % more XP for this reward', v_reward.xp_cost - (v_earned - v_spent); end if;
  insert into public.personal_reward_claims(reward_id, user_id, group_member_id, classroom_id, xp_spent)
  values(v_reward.id, v_user, v_account.group_member_id, p_classroom_id, v_reward.xp_cost)
  returning * into v_claim;
  return jsonb_build_object('claimId', v_claim.id, 'title', v_reward.title, 'assetKey', v_reward.asset_key, 'rewardType', v_reward.reward_type, 'xpSpent', v_reward.xp_cost);
end;
$$;

create or replace function public.equip_personal_reward(p_claim_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_claim public.personal_reward_claims%rowtype; v_reward public.personal_reward_catalog%rowtype;
begin
  select cl.* into v_claim from public.personal_reward_claims cl where cl.id = p_claim_id and cl.user_id = auth.uid() and cl.status = 'active' for update;
  if not found then raise exception 'That collectible is not available'; end if;
  select * into v_reward from public.personal_reward_catalog where id = v_claim.reward_id;
  if v_reward.is_consumable then raise exception 'Learning privileges are used with your teacher, not equipped'; end if;
  update public.personal_reward_claims cl set is_equipped = false
    from public.personal_reward_catalog c where cl.reward_id = c.id and cl.user_id = auth.uid() and c.reward_type = v_reward.reward_type;
  update public.personal_reward_claims set is_equipped = true where id = v_claim.id;
  return jsonb_build_object('rewardType', v_reward.reward_type, 'assetKey', v_reward.asset_key);
end;
$$;

revoke all on function public.get_personal_reward_dashboard(uuid) from public;
revoke all on function public.claim_personal_reward(uuid, uuid) from public;
revoke all on function public.equip_personal_reward(uuid) from public;
grant execute on function public.get_personal_reward_dashboard(uuid) to authenticated;
grant execute on function public.claim_personal_reward(uuid, uuid) to authenticated;
grant execute on function public.equip_personal_reward(uuid) to authenticated;

-- Keep the legacy XP-to-points RPC safe for deployed older clients. New
-- screens present XP as personal-only, but an old tab must not be able to
-- spend the same XP that a learner used for a collectible.
create or replace function public.redeem_mission_points(p_amount numeric, p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_account public.group_accounts%rowtype;
  v_earned numeric; v_redeemed numeric; v_personal_spent numeric; v_points integer;
begin
  if p_amount is null or p_amount < 10 or mod(p_amount, 10) <> 0 then raise exception 'Redeem XP in multiples of 10'; end if;
  select * into v_account from public.group_accounts where user_id = v_user and classroom_id = p_classroom_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved classroom account required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_classroom_id::text, 0));
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id;
  select coalesce(sum(xp_spent), 0) into v_redeemed from public.participation_logs where group_member_id = v_account.group_member_id and classroom_id = p_classroom_id and event_type = 'mission_redemption';
  select coalesce(sum(xp_spent), 0) into v_personal_spent from public.personal_reward_claims where user_id = v_user and classroom_id = p_classroom_id;
  if p_amount > v_earned - v_redeemed - v_personal_spent then raise exception 'Not enough personal mission XP available'; end if;
  v_points := trunc(p_amount / 10)::integer;
  insert into public.participation_logs(group_member_id, group_id, classroom_id, points_awarded, xp_spent, event_type, multiplier, recipient_type, note)
  values (v_account.group_member_id, v_account.group_id, v_account.classroom_id, v_points, p_amount, 'mission_redemption', 1, 'member', format('%s XP redeemed for %s participation point%s', p_amount::integer, v_points, case when v_points = 1 then '' else 's' end));
  return jsonb_build_object('xpAmount', p_amount::integer, 'pointsAwarded', v_points, 'groupId', v_account.group_id, 'memberId', v_account.group_member_id);
end;
$$;
revoke all on function public.redeem_mission_points(numeric, uuid) from public;
grant execute on function public.redeem_mission_points(numeric, uuid) to authenticated;
