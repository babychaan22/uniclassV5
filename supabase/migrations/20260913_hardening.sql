-- UniClass production hardening
-- Run after 20260802_rls_tighten.sql.

set search_path = public;

-- Force student mutations through the transactional functions below. The
-- teacher policies remain unchanged.
drop policy if exists "student_insert_own_account" on group_accounts;
drop policy if exists "student_update_own_account" on group_accounts;
drop policy if exists "student_scan_qr_code" on qr_codes;
drop policy if exists "student_insert_participation_log" on participation_logs;
drop policy if exists "student_submit_mission" on mission_submissions;
drop policy if exists "student_redeem_reward" on reward_redemptions;

-- Prevent duplicate submissions and duplicate accounts in one classroom.
-- Preserve the newest existing submission before enforcing uniqueness.
with ranked as (
  select id, row_number() over (
    partition by mission_id, group_id
    order by created_date desc, id desc
  ) as row_number
  from mission_submissions
)
delete from mission_submissions s
using ranked r
where s.id = r.id and r.row_number > 1;

create unique index if not exists idx_one_submission_per_group_mission
  on mission_submissions(mission_id, group_id);
create unique index if not exists idx_one_account_per_user_classroom
  on group_accounts(user_id, classroom_id);

create table if not exists public.learning_reviews (
  id uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  classroom_id uuid not null references classrooms(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  mission_id uuid not null references missions(id) on delete cascade,
  prompt_key text not null,
  prompt_text text not null,
  next_review_at timestamptz not null default now(),
  interval_days integer not null default 1 check (interval_days between 1 and 60),
  review_count integer not null default 0 check (review_count >= 0),
  last_result boolean,
  unique(user_id, mission_id, prompt_key)
);

create index if not exists idx_learning_reviews_due
  on learning_reviews(user_id, next_review_at);

alter table learning_reviews enable row level security;
create policy "student_read_own_learning_reviews"
  on learning_reviews for select to authenticated using (user_id = auth.uid());
create policy "teacher_read_learning_reviews"
  on learning_reviews for select to authenticated using (auth_is_teacher_of(classroom_id));

create or replace function public.complete_learning_review(p_review_id uuid, p_correct boolean)
returns learning_reviews
language plpgsql security definer set search_path = public as $$
declare v_review learning_reviews%rowtype; v_days integer;
begin
  select * into v_review from learning_reviews where id=p_review_id and user_id=auth.uid() for update;
  if not found then raise exception 'Review item not found'; end if;
  v_days := case when p_correct then least(greatest(v_review.interval_days * 2, 2), 60) else 1 end;
  update learning_reviews set last_result=p_correct, review_count=review_count+1,
    interval_days=v_days, next_review_at=now() + make_interval(days => v_days)
    where id=v_review.id returning * into v_review;
  return v_review;
end;
$$;

revoke all on function public.complete_learning_review(uuid,boolean) from public;
grant execute on function public.complete_learning_review(uuid,boolean) to authenticated;

create or replace function public.prevent_student_identity_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not exists (
    select 1 from classrooms where id=old.classroom_id and teacher_id=auth.uid()
  ) then
    if new.user_id <> old.user_id or new.classroom_id <> old.classroom_id
       or new.group_id <> old.group_id or new.group_member_id is distinct from old.group_member_id
       or new.is_approved <> old.is_approved or new.is_representative <> old.is_representative then
      raise exception 'Students cannot change account ownership or approval state';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tg_prevent_student_identity_changes on group_accounts;
create trigger tg_prevent_student_identity_changes
  before update on group_accounts for each row execute procedure public.prevent_student_identity_changes();

create or replace function public.prevent_student_submission_identity_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and exists (
    select 1 from group_accounts where user_id=auth.uid() and is_approved=true and group_id=old.group_id
  ) then
    if new.mission_id <> old.mission_id or new.group_id <> old.group_id or new.classroom_id <> old.classroom_id then
      raise exception 'Students cannot move a submission between missions or groups';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tg_prevent_student_submission_identity_changes on mission_submissions;
create trigger tg_prevent_student_submission_identity_changes
  before update on mission_submissions for each row execute procedure public.prevent_student_submission_identity_changes();

create or replace function public.scan_qr(
  p_hash text, p_group_member_id uuid, p_risk boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_qr qr_codes%rowtype; v_member group_members%rowtype;
  v_multiplier numeric := 1; v_points numeric; v_event text := 'scan'; v_mood text := 'neutral'; v_draw integer := 1; v_outcome integer := 1; v_log participation_logs%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_qr from qr_codes where hash=trim(p_hash) for update;
  if not found or v_qr.is_used then raise exception 'This QR code has already been used or is invalid'; end if;
  select * into v_member from group_members where id=p_group_member_id;
  if not found or not exists (select 1 from group_accounts where user_id=v_user and group_id=v_member.group_id and classroom_id=v_qr.classroom_id and is_approved=true) then
    raise exception 'You cannot scan for this student';
  end if;
  if v_qr.qr_type='gacha' and coalesce(p_risk,false) then
    -- Weighted outcomes: 0.5x=15%, 1.0x=60%, 1.5x=20%, 2.0x=5%.
    v_draw := floor(random()*20)::integer;
    v_outcome := case when v_draw < 3 then 0 when v_draw < 15 then 1 when v_draw < 19 then 2 else 3 end;
    v_multiplier := (array[0.5,1,1.5,2])[v_outcome+1];
    v_mood := case when v_outcome = 0 then 'sad' when v_outcome = 1 then 'neutral' else 'happy' end;
    v_event := case when v_outcome = 0 then 'gacha_loss' when v_outcome = 1 then 'gacha_even' else 'gacha_win' end;
  end if;
  v_points := round(v_qr.base_points * v_multiplier);
  update qr_codes set is_used=true, used_by_member_id=v_member.id, used_at=now() where id=v_qr.id;
  insert into participation_logs(group_member_id,group_id,classroom_id,qr_code_id,points_awarded,event_type,multiplier,note)
    values(v_member.id,v_member.group_id,v_qr.classroom_id,v_qr.id,v_points,v_event,v_multiplier,case when v_qr.qr_type='gacha' then 'Gacha capsule scan' else 'QR scan' end)
    returning * into v_log;
  return jsonb_build_object('points',v_points,'eventType',v_event,'multiplier',v_multiplier,'gacha',case when v_qr.qr_type='gacha' then jsonb_build_object('mood',v_mood,'multiplier',v_multiplier,'index',v_outcome) else null end,'groupId',v_member.group_id,'memberId',v_member.id,'log',to_jsonb(v_log));
end;
$$;

-- The client must not be able to publish arbitrary mission scores or point
-- movements. These functions validate the complete business operation while
-- holding the relevant group row lock.
create or replace function public.join_classroom(
  p_join_code text,
  p_group_id uuid,
  p_last_name text,
  p_first_name text,
  p_email text,
  p_wants_representative boolean default false,
  p_teammates jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_classroom classrooms%rowtype;
  v_group groups%rowtype;
  v_member group_members%rowtype;
  v_existing group_accounts%rowtype;
  v_teammate jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(p_join_code, ''))) < 4 then raise exception 'Invalid join code'; end if;

  select * into v_classroom from classrooms
    where upper(join_code) = upper(trim(p_join_code)) limit 1;
  if not found then raise exception 'Invalid join code'; end if;

  select * into v_group from groups
    where id = p_group_id and classroom_id = v_classroom.id for update;
  if not found then raise exception 'Invalid group for this classroom'; end if;

  if exists (select 1 from group_accounts where user_id = v_user and classroom_id = v_classroom.id) then
    raise exception 'You are already enrolled in this class';
  end if;
  if exists (select 1 from group_accounts where classroom_id = v_classroom.id
             and lower(email) = lower(trim(p_email))) then
    raise exception 'That email is already enrolled';
  end if;

  select * into v_existing from group_members
    where group_id = v_group.id
      and upper(last_name) = upper(trim(p_last_name))
      and upper(first_name) = upper(trim(p_first_name))
    limit 1;

  if found then
    if exists (select 1 from group_accounts where group_member_id = v_existing.id) then
      raise exception 'Someone already enrolled under that name in this group';
    end if;
    update group_members set is_account_holder = true where id = v_existing.id returning * into v_member;
  else
    insert into group_members(group_id, classroom_id, last_name, first_name, is_account_holder)
      values (v_group.id, v_classroom.id, upper(trim(p_last_name)), upper(trim(p_first_name)), true)
      returning * into v_member;
  end if;

  if p_wants_representative then
    if exists (select 1 from group_accounts where group_id = v_group.id and is_representative) then
      raise exception 'This group already has a representative';
    end if;
    for v_teammate in select * from jsonb_array_elements(coalesce(p_teammates, '[]'::jsonb)) loop
      if nullif(trim(v_teammate->>'last_name'), '') is not null
         and nullif(trim(v_teammate->>'first_name'), '') is not null
         and not exists (
           select 1 from group_members where group_id = v_group.id
             and upper(last_name) = upper(trim(v_teammate->>'last_name'))
             and upper(first_name) = upper(trim(v_teammate->>'first_name'))
         ) then
        insert into group_members(group_id, classroom_id, last_name, first_name, is_account_holder)
          values (v_group.id, v_classroom.id, upper(trim(v_teammate->>'last_name')), upper(trim(v_teammate->>'first_name')), false);
      end if;
    end loop;
  end if;

  insert into group_accounts(user_id, group_id, classroom_id, group_member_id,
    last_name, first_name, email, is_approved, is_representative)
  values (v_user, v_group.id, v_classroom.id, v_member.id,
    upper(trim(p_last_name)), upper(trim(p_first_name)), trim(p_email), false, p_wants_representative);

  return jsonb_build_object(
    'classroom', jsonb_build_object('id', v_classroom.id, 'grade_level', v_classroom.grade_level,
      'section', v_classroom.section, 'school_year', v_classroom.school_year),
    'group_id', v_group.id,
    'status', 'pending'
  );
end;
$$;

create or replace function public.lookup_classroom_by_join_code(p_join_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_classroom classrooms%rowtype; v_groups jsonb; v_accounts jsonb;
begin
  select * into v_classroom from classrooms where upper(join_code)=upper(trim(p_join_code)) limit 1;
  if not found then raise exception 'Invalid join code'; end if;
  select coalesce(jsonb_agg(to_jsonb(g) order by g.group_number), '[]'::jsonb) into v_groups from groups g where g.classroom_id=v_classroom.id;
  select coalesce(jsonb_agg(jsonb_build_object('group_id',a.group_id,'first_name',a.first_name,'last_name',a.last_name,'is_representative',a.is_representative)), '[]'::jsonb) into v_accounts from group_accounts a where a.classroom_id=v_classroom.id;
  return jsonb_build_object('classroom', jsonb_build_object('id',v_classroom.id,'grade_level',v_classroom.grade_level,'section',v_classroom.section,'school_year',v_classroom.school_year), 'groups',v_groups, 'accounts',v_accounts);
end;
$$;

create or replace function public.submit_mission(
  p_mission_id uuid, p_group_id uuid, p_score numeric, p_answers text
)
returns mission_submissions
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_m missions%rowtype; v_result mission_submissions%rowtype; v_group_id uuid; v_answers jsonb; v_score numeric; v_max numeric; v_correct integer; v_item jsonb; v_idx integer; v_key text; v_is_correct boolean; v_prompt text;
begin
  select group_id into v_group_id from group_accounts where user_id=v_user and group_id=p_group_id and is_approved=true limit 1;
  if v_group_id is null then raise exception 'You are not approved for this group'; end if;
  select * into v_m from missions where id=p_mission_id and classroom_id=(select classroom_id from groups where id=p_group_id) for update;
  if not found or not v_m.is_active then raise exception 'Mission is not active'; end if;
  if v_m.deadline is not null and v_m.deadline < current_date then raise exception 'Mission deadline has passed'; end if;
  begin v_answers := coalesce(nullif(p_answers, '')::jsonb, '{}'::jsonb); exception when others then raise exception 'Invalid answers'; end;
  if v_m.formative_type = 'true_false' or v_m.formative_type = 'multiple_choice' then
    select count(*) into v_correct
      from jsonb_array_elements(v_m.ai_content::jsonb->'questions') with ordinality as q(item, idx)
      where (v_answers -> ((q.idx - 1)::text)) = (v_m.answer_key::jsonb -> ((q.idx - 1)::text));
    v_score := v_correct;
    v_max := jsonb_array_length(v_m.ai_content::jsonb->'questions');
  elsif v_m.formative_type = 'drag_drop' then
    select count(*) into v_correct from jsonb_each(v_m.answer_key::jsonb) as a(key, value)
      where v_answers ->> a.key = trim(both '"' from a.value::text);
    v_score := v_correct;
    select count(*) into v_max from jsonb_object_keys(v_m.answer_key::jsonb);
  else
    v_score := greatest(0,least(coalesce(p_score,0),v_m.max_score));
    v_max := v_m.max_score;
  end if;
  insert into mission_submissions(mission_id,group_id,classroom_id,score,xp_earned,graded_by,answers)
  values (v_m.id,p_group_id,v_m.classroom_id,v_score,
    greatest(0,round((v_score/nullif(v_max,0))*v_m.xp_reward)),v_user,p_answers)
  on conflict (mission_id,group_id) do update set score=excluded.score,xp_earned=excluded.xp_earned,graded_by=excluded.graded_by,answers=excluded.answers
  returning * into v_result;

  if v_m.formative_type = 'true_false' or v_m.formative_type = 'multiple_choice' then
    v_idx := 0;
    for v_item in select value from jsonb_array_elements(v_m.ai_content::jsonb->'questions') loop
      v_prompt := coalesce(v_item->>'prompt', 'Question ' || (v_idx + 1)::text);
      v_is_correct := (v_answers -> (v_idx::text)) = (v_m.answer_key::jsonb -> (v_idx::text));
      insert into learning_reviews(user_id,classroom_id,group_id,mission_id,prompt_key,prompt_text,next_review_at,interval_days,last_result)
        values(v_user,v_m.classroom_id,p_group_id,v_m.id,v_idx::text,v_prompt,
          case when v_is_correct then now() + interval '3 days' else now() end,
          case when v_is_correct then 3 else 1 end,v_is_correct)
      on conflict (user_id,mission_id,prompt_key) do update set prompt_text=excluded.prompt_text,
        next_review_at=case when excluded.last_result then now() + make_interval(days => least(learning_reviews.interval_days * 2, 60)) else now() end,
        interval_days=case when excluded.last_result then least(learning_reviews.interval_days * 2, 60) else 1 end,
        last_result=excluded.last_result;
      v_idx := v_idx + 1;
    end loop;
  elsif v_m.formative_type = 'drag_drop' then
    for v_key, v_item in select key, value from jsonb_each(v_m.answer_key::jsonb) loop
      v_is_correct := (v_answers ->> v_key) = trim(both '"' from v_item::text);
      insert into learning_reviews(user_id,classroom_id,group_id,mission_id,prompt_key,prompt_text,next_review_at,interval_days,last_result)
        values(v_user,v_m.classroom_id,p_group_id,v_m.id,v_key,v_key,
          case when v_is_correct then now() + interval '3 days' else now() end,
          case when v_is_correct then 3 else 1 end,v_is_correct)
      on conflict (user_id,mission_id,prompt_key) do update set
        next_review_at=case when excluded.last_result then now() + make_interval(days => least(learning_reviews.interval_days * 2, 60)) else now() end,
        interval_days=case when excluded.last_result then least(learning_reviews.interval_days * 2, 60) else 1 end,
        last_result=excluded.last_result;
    end loop;
  end if;
  return v_result;
end;
$$;

create or replace function public.redeem_reward(p_reward_id uuid)
returns reward_redemptions
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_reward rewards%rowtype; v_group_id uuid; v_classroom_id uuid; v_earned numeric; v_spent numeric; v_result reward_redemptions%rowtype;
begin
  select group_id, classroom_id into v_group_id, v_classroom_id from group_accounts where user_id=v_user and is_approved=true limit 1;
  if v_group_id is null then raise exception 'Approved classroom account required'; end if;
  perform 1 from groups where id=v_group_id for update;
  select * into v_reward from rewards where id=p_reward_id and classroom_id=v_classroom_id and is_active=true for update;
  if not found then raise exception 'Reward is no longer available'; end if;
  select coalesce(sum(points_awarded),0) into v_earned from participation_logs where group_id=v_group_id;
  select coalesce(sum(points_spent),0) into v_spent from reward_redemptions where group_id=v_group_id;
  if v_earned-v_spent < v_reward.cost_points then raise exception 'Not enough points'; end if;
  insert into reward_redemptions(reward_id,reward_title,group_id,classroom_id,points_spent,redeemed_by)
    values(v_reward.id,v_reward.title,v_group_id,v_classroom_id,v_reward.cost_points,v_user) returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.redeem_mission_points(p_amount numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_group_id uuid; v_classroom_id uuid; v_earned numeric; v_redeemed numeric; v_members uuid[]; v_member uuid; v_per numeric; v_count integer;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a positive amount'; end if;
  select group_id, classroom_id into v_group_id, v_classroom_id from group_accounts where user_id=v_user and is_approved=true limit 1;
  if v_group_id is null then raise exception 'Approved classroom account required'; end if;
  perform 1 from groups where id=v_group_id for update;
  select coalesce(sum(xp_earned),0) into v_earned from mission_submissions where group_id=v_group_id;
  select coalesce(sum(points_awarded),0) into v_redeemed from participation_logs where group_id=v_group_id and event_type='mission_redemption';
  if v_earned-v_redeemed < p_amount then raise exception 'Not enough XP'; end if;
  select array_agg(id order by id), count(*) into v_members, v_count from group_members where group_id=v_group_id;
  if coalesce(v_count,0)=0 then raise exception 'Group has no members'; end if;
  v_per := p_amount / v_count;
  foreach v_member in array v_members loop
    insert into participation_logs(group_member_id,group_id,classroom_id,points_awarded,event_type,multiplier,note)
      values(v_member,v_group_id,v_classroom_id,v_per,'mission_redemption',1,'XP redemption');
  end loop;
  return jsonb_build_object('amount',p_amount,'groupId',v_group_id);
end;
$$;

revoke all on function public.join_classroom(text,uuid,text,text,text,boolean,jsonb) from public;
revoke all on function public.scan_qr(text,uuid,boolean) from public;
revoke all on function public.lookup_classroom_by_join_code(text) from public;
revoke all on function public.submit_mission(uuid,uuid,numeric,text) from public;
revoke all on function public.redeem_reward(uuid) from public;
revoke all on function public.redeem_mission_points(numeric) from public;
grant execute on function public.join_classroom(text,uuid,text,text,text,boolean,jsonb) to authenticated;
grant execute on function public.scan_qr(text,uuid,boolean) to authenticated;
grant execute on function public.lookup_classroom_by_join_code(text) to authenticated;
grant execute on function public.submit_mission(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.redeem_reward(uuid) to authenticated;
grant execute on function public.redeem_mission_points(numeric) to authenticated;
