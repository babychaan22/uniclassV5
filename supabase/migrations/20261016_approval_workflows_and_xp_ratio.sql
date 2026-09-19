-- Badge and reward requests must be reviewed by the teacher before they take effect.
alter table public.badges
  add column if not exists approval_status text not null default 'approved',
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;

alter table public.reward_redemptions
  add column if not exists approval_status text not null default 'approved',
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;

alter table public.participation_logs
  add column if not exists xp_spent numeric not null default 0;

update public.badges set approval_status = 'approved' where approval_status is null;
update public.reward_redemptions set approval_status = 'approved' where approval_status is null;
-- Prior mission-redemption records stored their XP input in points_awarded.
update public.participation_logs
set xp_spent = points_awarded
where event_type = 'mission_redemption' and xp_spent = 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'badges_approval_status_check') then
    alter table public.badges add constraint badges_approval_status_check check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reward_redemptions_approval_status_check') then
    alter table public.reward_redemptions add constraint reward_redemptions_approval_status_check check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

create index if not exists idx_badges_pending_review on public.badges(classroom_id, approval_status, created_date desc);
create index if not exists idx_reward_redemptions_pending_review on public.reward_redemptions(classroom_id, approval_status, created_date desc);

-- A weekend badge is a request first. Approval adds the points later.
create or replace function public.redeem_badge(p_group_id uuid, p_badge_type text)
returns public.badges language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_group public.groups%rowtype; v_account public.group_accounts%rowtype; v_member public.group_members%rowtype;
  v_badge public.badges%rowtype; v_week date; v_week_end date; v_eligible boolean := false;
  v_score numeric; v_max_score numeric; v_group_total numeric; v_max_group_total numeric; v_member_total numeric; v_max_member_total numeric;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_badge_type not in ('weekly_90_activity','weekly_full_attendance','weekly_top_group_points','weekly_top_individual_points') then raise exception 'Invalid badge type'; end if;
  if extract(dow from (now() at time zone 'Asia/Manila')) not in (0, 6) then raise exception 'Badges are only available at the end of the week (Saturday–Sunday).'; end if;
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then raise exception 'Invalid group'; end if;
  select * into v_account from public.group_accounts where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if not found then raise exception 'Approved classroom account required'; end if;
  v_week := (now() at time zone 'Asia/Manila')::date - extract(isodow from (now() at time zone 'Asia/Manila'))::integer + 1;
  v_week_end := v_week + 6;
  if p_badge_type = 'weekly_90_activity' then
    v_eligible := true;
    for v_member in select * from public.group_members where group_id = p_group_id loop
      select coalesce(sum(s.score), 0), coalesce(sum(a.max_score), 0) into v_score, v_max_score from public.activity_scores s join public.activities a on a.id=s.activity_id where s.group_member_id=v_member.id and s.created_date::date between v_week and v_week_end;
      if v_max_score = 0 or v_score / v_max_score < .9 then v_eligible := false; exit; end if;
    end loop;
  elsif p_badge_type = 'weekly_full_attendance' then
    select count(*) = count(*) filter (where a.status = 'present') and count(*) > 0 into v_eligible from public.attendances a where a.group_id=p_group_id and a.attendance_date between v_week and v_week_end;
    v_eligible := v_eligible and not exists (select 1 from public.group_members gm where gm.group_id=p_group_id and not exists (select 1 from public.attendances a where a.group_member_id=gm.id and a.attendance_date between v_week and v_week_end));
  elsif p_badge_type = 'weekly_top_group_points' then
    select coalesce(sum(points_awarded),0) into v_group_total from public.participation_logs where group_id=p_group_id and created_date::date between v_week and v_week_end;
    select max(total) into v_max_group_total from (select g.id,coalesce(sum(l.points_awarded),0) total from public.groups g left join public.participation_logs l on l.group_id=g.id and l.created_date::date between v_week and v_week_end where g.classroom_id=v_group.classroom_id group by g.id) totals;
    v_eligible := v_group_total > 0 and v_group_total=v_max_group_total;
  else
    select max(total) into v_max_member_total from (select gm.id,coalesce(sum(l.points_awarded),0) total from public.group_members gm left join public.participation_logs l on l.group_member_id=gm.id and l.created_date::date between v_week and v_week_end where gm.classroom_id=v_group.classroom_id group by gm.id) totals;
    select coalesce(sum(points_awarded),0) into v_member_total from public.participation_logs where group_member_id=v_account.group_member_id and created_date::date between v_week and v_week_end;
    v_eligible := v_member_total > 0 and v_member_total=v_max_member_total;
  end if;
  if not v_eligible then raise exception 'Not eligible for this badge this week.'; end if;
  select * into v_badge from public.badges where group_id=p_group_id and badge_type=p_badge_type and week_start_date=v_week for update;
  if found then
    if v_badge.approval_status in ('pending','approved') then raise exception 'This badge has already been requested this week.'; end if;
    update public.badges set approval_status='pending', redeemed_by=v_user, reviewed_by=null, reviewed_at=null, points_awarded=10 where id=v_badge.id returning * into v_badge;
  else
    insert into public.badges(group_id,classroom_id,badge_type,week_start_date,points_awarded,redeemed_by,approval_status) values(p_group_id,v_group.classroom_id,p_badge_type,v_week,10,v_user,'pending') returning * into v_badge;
  end if;
  return v_badge;
end;
$$;

-- Teacher-created badge requests follow the same approval flow.
create or replace function public.claim_badge_definition(p_definition_id uuid, p_group_id uuid, p_member_id uuid default null)
returns public.badges language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_def public.badge_definitions%rowtype; v_group public.groups%rowtype; v_account public.group_accounts%rowtype;
  v_result public.badges%rowtype; v_week date; v_badge_type text;
begin
  if extract(dow from (now() at time zone 'Asia/Manila')) not in (0,6) then raise exception 'Badges can be claimed on Saturday or Sunday.'; end if;
  select bd.* into v_def from public.badge_definitions bd where bd.id=p_definition_id and bd.is_active=true and (bd.classroom_id=(select classroom_id from public.groups where id=p_group_id) or (bd.applies_to_all_classes and exists (select 1 from public.classrooms c join public.groups g on g.classroom_id=c.id where g.id=p_group_id and c.teacher_id=bd.created_by)));
  if not found then raise exception 'Badge is no longer available for this class'; end if;
  select * into v_group from public.groups where id=p_group_id; if not found then raise exception 'Invalid group'; end if;
  select * into v_account from public.group_accounts where user_id=v_user and group_id=p_group_id and is_approved=true limit 1; if not found then raise exception 'Approved classroom account required'; end if;
  if v_def.badge_scope='personal' and (p_member_id is null or p_member_id<>v_account.group_member_id) then raise exception 'Personal badges can only be claimed for your own student profile'; end if;
  v_week := (now() at time zone 'Asia/Manila')::date-extract(isodow from (now() at time zone 'Asia/Manila'))::integer+1;
  v_badge_type := 'custom:'||v_def.id::text||case when v_def.badge_scope='personal' then ':'||p_member_id::text else '' end;
  select * into v_result from public.badges where group_id=p_group_id and badge_type=v_badge_type and week_start_date=v_week for update;
  if found then
    if v_result.approval_status in ('pending','approved') then raise exception 'This badge has already been requested this week.'; end if;
    update public.badges set approval_status='pending',redeemed_by=v_user,reviewed_by=null,reviewed_at=null,points_awarded=least(10,v_def.points) where id=v_result.id returning * into v_result;
  else
    insert into public.badges(group_id,classroom_id,badge_type,week_start_date,points_awarded,redeemed_by,badge_definition_id,member_id,approval_status) values(p_group_id,v_group.classroom_id,v_badge_type,v_week,least(10,v_def.points),v_user,p_definition_id,case when v_def.badge_scope='personal' then p_member_id else null end,'pending') returning * into v_result;
  end if;
  return v_result;
end;
$$;

create or replace function public.review_badge_claim(p_badge_id uuid, p_approve boolean)
returns public.badges language plpgsql security definer set search_path = public as $$
declare v_badge public.badges%rowtype; v_title text;
begin
  select * into v_badge from public.badges where id=p_badge_id for update;
  if not found then raise exception 'Badge request not found'; end if;
  if not auth_is_teacher_of(v_badge.classroom_id) then raise exception 'Only the teacher can review this badge request'; end if;
  if v_badge.approval_status <> 'pending' then raise exception 'This badge request has already been reviewed'; end if;
  update public.badges set approval_status=case when p_approve then 'approved' else 'rejected' end, reviewed_by=auth.uid(), reviewed_at=now() where id=p_badge_id returning * into v_badge;
  if p_approve then
    select coalesce(title, replace(v_badge.badge_type,'_',' ')) into v_title from public.badge_definitions where id=v_badge.badge_definition_id;
    insert into public.participation_logs(group_member_id,group_id,classroom_id,qr_code_id,points_awarded,event_type,multiplier,recipient_type,note)
      values(v_badge.member_id,v_badge.group_id,v_badge.classroom_id,v_badge.id,v_badge.points_awarded,'badge',1,case when v_badge.member_id is null then 'group' else 'member' end,coalesce(v_title,'Weekly badge'));
  end if;
  return v_badge;
end;
$$;

-- Reward requests reserve points while pending but do not deliver the reward until approval.
create or replace function public.redeem_reward(p_reward_id uuid, p_classroom_id uuid default null)
returns public.reward_redemptions language plpgsql security definer set search_path = public as $$
declare v_user uuid:=auth.uid(); v_reward public.rewards%rowtype; v_group_id uuid; v_classroom_id uuid:=p_classroom_id; v_earned numeric; v_reserved numeric; v_result public.reward_redemptions%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if v_classroom_id is null then select classroom_id into v_classroom_id from public.group_accounts where user_id=v_user and is_approved=true order by created_date asc limit 1; end if;
  select group_id into v_group_id from public.group_accounts where user_id=v_user and classroom_id=v_classroom_id and is_approved=true order by created_date asc limit 1;
  if v_group_id is null then raise exception 'Approved classroom account required'; end if;
  select * into v_reward from public.rewards where id=p_reward_id and is_active=true and (classroom_id=v_classroom_id or (applies_to_all_classes and exists(select 1 from public.classrooms c where c.id=v_classroom_id and c.teacher_id=rewards.created_by))) for update;
  if not found then raise exception 'Reward is no longer available for this class'; end if;
  perform 1 from public.groups where id=v_group_id for update;
  if exists(select 1 from public.reward_redemptions where group_id=v_group_id and reward_id=v_reward.id and approval_status='pending') then raise exception 'This reward is already awaiting teacher approval'; end if;
  select coalesce(sum(points_awarded),0) into v_earned from public.participation_logs where group_id=v_group_id;
  select coalesce(sum(points_spent),0) into v_reserved from public.reward_redemptions where group_id=v_group_id and approval_status in ('pending','approved');
  if v_earned-v_reserved < v_reward.cost_points then raise exception 'Not enough available points'; end if;
  insert into public.reward_redemptions(reward_id,reward_title,group_id,classroom_id,points_spent,redeemed_by,approval_status) values(v_reward.id,v_reward.title,v_group_id,v_classroom_id,v_reward.cost_points,v_user,'pending') returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.review_reward_redemption(p_redemption_id uuid, p_approve boolean)
returns public.reward_redemptions language plpgsql security definer set search_path = public as $$
declare v_result public.reward_redemptions%rowtype;
begin
  select * into v_result from public.reward_redemptions where id=p_redemption_id for update;
  if not found then raise exception 'Reward request not found'; end if;
  if not auth_is_teacher_of(v_result.classroom_id) then raise exception 'Only the teacher can review this reward request'; end if;
  if v_result.approval_status <> 'pending' then raise exception 'This reward request has already been reviewed'; end if;
  update public.reward_redemptions set approval_status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now() where id=p_redemption_id returning * into v_result;
  return v_result;
end;
$$;

-- 10 XP = 1 participation point. XP is stored separately from credited points.
create or replace function public.redeem_mission_points(p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid:=auth.uid(); v_group_id uuid; v_classroom_id uuid; v_earned numeric; v_redeemed numeric; v_points numeric;
begin
  if p_amount is null or p_amount < 10 or mod(p_amount,10) <> 0 then raise exception 'Redeem XP in groups of 10 (10 XP = 1 participation point)'; end if;
  select group_id,classroom_id into v_group_id,v_classroom_id from public.group_accounts where user_id=v_user and is_approved=true order by created_date asc limit 1;
  if v_group_id is null then raise exception 'Approved classroom account required'; end if;
  perform 1 from public.groups where id=v_group_id for update;
  select coalesce(sum(xp_earned),0) into v_earned from public.mission_submissions where group_id=v_group_id;
  select coalesce(sum(xp_spent),0) into v_redeemed from public.participation_logs where group_id=v_group_id and event_type='mission_redemption';
  if v_earned-v_redeemed < p_amount then raise exception 'Not enough XP'; end if;
  v_points := p_amount / 10;
  insert into public.participation_logs(group_member_id,group_id,classroom_id,points_awarded,xp_spent,event_type,multiplier,recipient_type,note) values(null,v_group_id,v_classroom_id,v_points,p_amount,'mission_redemption',1,'group',format('%s XP redeemed for %s participation point%s',p_amount,v_points,case when v_points=1 then '' else 's' end));
  return jsonb_build_object('xpAmount',p_amount,'pointsAwarded',v_points,'groupId',v_group_id);
end;
$$;

revoke all on function public.redeem_badge(uuid,text) from public;
revoke all on function public.claim_badge_definition(uuid,uuid,uuid) from public;
revoke all on function public.review_badge_claim(uuid,boolean) from public;
revoke all on function public.redeem_reward(uuid,uuid) from public;
revoke all on function public.review_reward_redemption(uuid,boolean) from public;
revoke all on function public.redeem_mission_points(numeric) from public;
grant execute on function public.redeem_badge(uuid,text) to authenticated;
grant execute on function public.claim_badge_definition(uuid,uuid,uuid) to authenticated;
grant execute on function public.review_badge_claim(uuid,boolean) to authenticated;
grant execute on function public.redeem_reward(uuid,uuid) to authenticated;
grant execute on function public.review_reward_redemption(uuid,boolean) to authenticated;
grant execute on function public.redeem_mission_points(numeric) to authenticated;
