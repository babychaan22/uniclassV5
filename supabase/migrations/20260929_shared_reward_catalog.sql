-- Make each teacher's reward catalog available across all of their classes.
-- Redemptions still use the student's selected/active classroom account.

alter table public.rewards
  add column if not exists applies_to_all_classes boolean not null default true;

update public.rewards
set applies_to_all_classes = true
where applies_to_all_classes is distinct from true;

create index if not exists idx_rewards_created_by_active
  on public.rewards(created_by, is_active);

drop policy if exists "student_read_rewards" on public.rewards;
create policy "student_read_rewards"
  on public.rewards for select to authenticated
  using (
    auth_in_classroom(classroom_id)
    or (
      applies_to_all_classes
      and exists (
        select 1
        from public.group_accounts ga
        join public.classrooms c on c.id = ga.classroom_id
        where ga.user_id = auth.uid()
          and ga.is_approved = true
          and c.teacher_id = rewards.created_by
      )
    )
  );

drop function if exists public.redeem_reward(uuid);
create or replace function public.redeem_reward(
  p_reward_id uuid,
  p_classroom_id uuid default null
)
returns public.reward_redemptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_reward public.rewards%rowtype;
  v_group_id uuid;
  v_classroom_id uuid := p_classroom_id;
  v_earned numeric;
  v_spent numeric;
  v_result public.reward_redemptions%rowtype;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if v_classroom_id is null then
    select classroom_id into v_classroom_id
    from public.group_accounts
    where user_id = v_user and is_approved = true
    order by created_date asc
    limit 1;
  end if;

  select group_id into v_group_id
  from public.group_accounts
  where user_id = v_user
    and classroom_id = v_classroom_id
    and is_approved = true
  order by created_date asc
  limit 1;

  if v_group_id is null then
    raise exception 'Approved classroom account required';
  end if;

  select * into v_reward
  from public.rewards
  where id = p_reward_id
    and is_active = true
    and (
      classroom_id = v_classroom_id
      or (
        applies_to_all_classes
        and exists (
          select 1
          from public.group_accounts ga
          join public.classrooms c on c.id = ga.classroom_id
          where ga.user_id = v_user
            and ga.is_approved = true
            and c.teacher_id = rewards.created_by
        )
      )
    )
  for update;

  if not found then
    raise exception 'Reward is no longer available for this class';
  end if;

  perform 1 from public.groups where id = v_group_id for update;
  select coalesce(sum(points_awarded), 0) into v_earned
  from public.participation_logs where group_id = v_group_id;
  select coalesce(sum(points_spent), 0) into v_spent
  from public.reward_redemptions where group_id = v_group_id;

  if v_earned - v_spent < v_reward.cost_points then
    raise exception 'Not enough points';
  end if;

  insert into public.reward_redemptions(
    reward_id, reward_title, group_id, classroom_id, points_spent, redeemed_by
  ) values (
    v_reward.id, v_reward.title, v_group_id, v_classroom_id, v_reward.cost_points, v_user
  ) returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.redeem_reward(uuid, uuid) from public;
grant execute on function public.redeem_reward(uuid, uuid) to authenticated;
