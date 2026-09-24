-- Activity score corrections are requests: representatives propose, teachers decide.
create table if not exists public.activity_score_edit_requests (
  id uuid primary key default gen_random_uuid(),
  activity_score_id uuid not null references public.activity_scores(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  group_member_id uuid not null references public.group_members(id) on delete cascade,
  current_score numeric not null,
  proposed_score numeric not null check (proposed_score >= 0),
  requested_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_one_pending_activity_score_edit
  on public.activity_score_edit_requests(activity_score_id) where status = 'pending';
create index if not exists idx_activity_score_edits_teacher_queue
  on public.activity_score_edit_requests(classroom_id, status, created_at desc);

alter table public.activity_score_edit_requests enable row level security;
drop policy if exists teacher_read_activity_score_edits on public.activity_score_edit_requests;
create policy teacher_read_activity_score_edits on public.activity_score_edit_requests for select to authenticated
  using (auth_is_teacher_of(classroom_id));
drop policy if exists student_read_own_group_activity_score_edits on public.activity_score_edit_requests;
create policy student_read_own_group_activity_score_edits on public.activity_score_edit_requests for select to authenticated
  using (auth_rep_group_id(classroom_id) = group_id or exists (
    select 1 from public.group_accounts ga
    where ga.user_id = auth.uid() and ga.is_approved = true and ga.group_id = activity_score_edit_requests.group_id
  ));

-- A representative cannot alter an already-submitted score directly.
drop policy if exists rep_update_activity_scores on public.activity_scores;

create or replace function public.request_activity_score_edit(p_activity_score_id uuid, p_proposed_score numeric)
returns public.activity_score_edit_requests
language plpgsql security definer set search_path = public as $$
declare
  v_score public.activity_scores%rowtype;
  v_max numeric;
  v_result public.activity_score_edit_requests%rowtype;
begin
  select s.* into v_score
  from public.activity_scores s
  where s.id = p_activity_score_id for update;
  if not found then raise exception 'Saved activity score not found'; end if;
  select max_score into v_max from public.activities where id = v_score.activity_id;
  if auth_rep_group_id(v_score.classroom_id) is distinct from v_score.group_id then
    raise exception 'Only the approved representative may request a score edit';
  end if;
  if p_proposed_score is null or p_proposed_score < 0 or p_proposed_score > v_max then
    raise exception 'The proposed score must be between 0 and %', v_max;
  end if;
  if p_proposed_score = v_score.score then raise exception 'Choose a different score before requesting an edit'; end if;

  select * into v_result from public.activity_score_edit_requests
  where activity_score_id = v_score.id and status = 'pending' for update;
  if found then
    update public.activity_score_edit_requests
    set proposed_score = p_proposed_score, requested_by = auth.uid(), created_at = now()
    where id = v_result.id returning * into v_result;
  else
    insert into public.activity_score_edit_requests(
      activity_score_id, activity_id, classroom_id, group_id, group_member_id,
      current_score, proposed_score, requested_by
    ) values (
      v_score.id, v_score.activity_id, v_score.classroom_id, v_score.group_id, v_score.group_member_id,
      v_score.score, p_proposed_score, auth.uid()
    ) returning * into v_result;
  end if;
  return v_result;
end;
$$;

create or replace function public.review_activity_score_edit(p_request_id uuid, p_approve boolean)
returns public.activity_score_edit_requests
language plpgsql security definer set search_path = public as $$
declare v_result public.activity_score_edit_requests%rowtype;
begin
  select * into v_result from public.activity_score_edit_requests where id = p_request_id for update;
  if not found then raise exception 'Score edit request not found'; end if;
  if not auth_is_teacher_of(v_result.classroom_id) then raise exception 'Only the classroom teacher may review a score edit'; end if;
  if v_result.status <> 'pending' then raise exception 'This score edit has already been reviewed'; end if;
  if p_approve then
    update public.activity_scores set score = v_result.proposed_score where id = v_result.activity_score_id;
  end if;
  update public.activity_score_edit_requests
  set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = auth.uid(), reviewed_at = now()
  where id = v_result.id returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.request_activity_score_edit(uuid, numeric) from public;
revoke all on function public.review_activity_score_edit(uuid, boolean) from public;
grant execute on function public.request_activity_score_edit(uuid, numeric) to authenticated;
grant execute on function public.review_activity_score_edit(uuid, boolean) to authenticated;

-- Rewards are unlocked by a points threshold; approval never deducts earned points.
create or replace function public.redeem_reward(p_reward_id uuid, p_classroom_id uuid default null)
returns public.reward_redemptions language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_reward public.rewards%rowtype; v_group_id uuid; v_classroom_id uuid := p_classroom_id;
  v_earned numeric; v_result public.reward_redemptions%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if v_classroom_id is null then select classroom_id into v_classroom_id from public.group_accounts where user_id = v_user and is_approved = true order by created_date asc limit 1; end if;
  select group_id into v_group_id from public.group_accounts where user_id = v_user and classroom_id = v_classroom_id and is_approved = true order by created_date asc limit 1;
  if v_group_id is null then raise exception 'Approved classroom account required'; end if;
  select * into v_reward from public.rewards where id = p_reward_id and is_active = true and (classroom_id = v_classroom_id or (applies_to_all_classes and exists(select 1 from public.classrooms c where c.id = v_classroom_id and c.teacher_id = rewards.created_by))) for update;
  if not found then raise exception 'Reward is no longer available for this class'; end if;
  if exists(select 1 from public.reward_redemptions where group_id = v_group_id and reward_id = v_reward.id and approval_status in ('pending', 'approved')) then raise exception 'This reward has already been requested by your group'; end if;
  select coalesce(sum(case when event_type = 'behavior_penalty' then -abs(points_awarded) else points_awarded end), 0) into v_earned from public.participation_logs where group_id = v_group_id;
  if v_earned < v_reward.cost_points then raise exception 'Your group needs % points to request this reward', v_reward.cost_points; end if;
  insert into public.reward_redemptions(reward_id, reward_title, group_id, classroom_id, points_spent, redeemed_by, approval_status)
  values(v_reward.id, v_reward.title, v_group_id, v_classroom_id, 0, v_user, 'pending') returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.redeem_reward(uuid, uuid) from public;
grant execute on function public.redeem_reward(uuid, uuid) to authenticated;
