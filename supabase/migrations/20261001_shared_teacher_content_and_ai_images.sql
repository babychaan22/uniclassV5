-- Share teacher-created missions and badge definitions across the teacher's
-- classes, while keeping submissions and claims in the student's class.

alter table public.missions add column if not exists applies_to_all_classes boolean not null default true;
alter table public.missions add column if not exists image_url text;
alter table public.badge_definitions add column if not exists applies_to_all_classes boolean not null default true;
update public.missions set applies_to_all_classes = true where applies_to_all_classes is distinct from true;
update public.badge_definitions set applies_to_all_classes = true where applies_to_all_classes is distinct from true;

drop policy if exists "student_read_missions" on public.missions;
create policy "student_read_missions" on public.missions for select to authenticated
using (
  auth_in_classroom(classroom_id)
  or (applies_to_all_classes and exists (
    select 1 from public.group_accounts ga
    join public.classrooms c on c.id = ga.classroom_id
    where ga.user_id = auth.uid() and ga.is_approved = true and c.teacher_id = missions.created_by
  ))
);

drop policy if exists classroom_read_badge_definitions on public.badge_definitions;
create policy classroom_read_badge_definitions on public.badge_definitions for select to authenticated
using (
  auth_in_classroom(classroom_id)
  or (applies_to_all_classes and exists (
    select 1 from public.group_accounts ga
    join public.classrooms c on c.id = ga.classroom_id
    where ga.user_id = auth.uid() and ga.is_approved = true and c.teacher_id = badge_definitions.created_by
  ))
);

-- Atomic image quota: at most three generations per draft mission and ten per
-- teacher per Manila calendar day.
create table if not exists public.ai_image_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_key text not null,
  usage_date date not null,
  generation_count integer not null default 0 check (generation_count >= 0),
  unique(user_id, draft_key, usage_date)
);
alter table public.ai_image_usage enable row level security;
drop policy if exists ai_image_usage_none on public.ai_image_usage;
create policy ai_image_usage_none on public.ai_image_usage for select to authenticated using (user_id = auth.uid());

create or replace function public.consume_ai_image_quota(p_draft_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_date date := (now() at time zone 'Asia/Manila')::date; v_count integer; v_daily integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_draft_key), '') is null then raise exception 'Draft key required'; end if;
  select coalesce(sum(generation_count), 0) into v_daily from public.ai_image_usage where user_id = v_user and usage_date = v_date;
  if v_daily >= 10 then raise exception 'Daily image generation limit reached (10 images).'; end if;
  insert into public.ai_image_usage(user_id, draft_key, usage_date, generation_count)
    values(v_user, trim(p_draft_key), v_date, 1)
    on conflict (user_id, draft_key, usage_date) do update set generation_count = public.ai_image_usage.generation_count + 1
    returning generation_count into v_count;
  if v_count > 3 then
    update public.ai_image_usage set generation_count = generation_count - 1 where user_id = v_user and draft_key = trim(p_draft_key) and usage_date = v_date;
    raise exception 'This mission has reached its 3-image limit.';
  end if;
  return jsonb_build_object('draftCount', v_count, 'dailyCount', v_daily + 1, 'dailyLimit', 10, 'draftLimit', 3);
end;
$$;
revoke all on function public.consume_ai_image_quota(text) from public;
grant execute on function public.consume_ai_image_quota(text) to authenticated;

-- Allow a student to submit a shared mission for an approved group in any
-- class belonging to the mission's teacher.
create or replace function public.submit_mission(p_mission_id uuid, p_group_id uuid, p_score numeric, p_answers text)
returns public.mission_submissions language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_m public.missions%rowtype; v_result public.mission_submissions%rowtype;
  v_group public.groups%rowtype; v_answers jsonb; v_score numeric; v_max numeric; v_correct integer;
  v_item jsonb; v_idx integer; v_key text; v_is_correct boolean; v_prompt text;
begin
  select * into v_group from public.groups where id = p_group_id;
  if not found or not exists (select 1 from public.group_accounts where user_id=v_user and group_id=p_group_id and is_approved=true) then raise exception 'You are not approved for this group'; end if;
  select * into v_m from public.missions where id=p_mission_id and is_active=true and (
    classroom_id=v_group.classroom_id or (applies_to_all_classes and exists (
      select 1 from public.classrooms c where c.id=v_group.classroom_id and c.teacher_id=missions.created_by
    ))
  ) for update;
  if not found then raise exception 'Mission is not active'; end if;
  if v_m.deadline is not null and v_m.deadline < current_date then raise exception 'Mission deadline has passed'; end if;
  begin v_answers := coalesce(nullif(p_answers, '')::jsonb, '{}'::jsonb); exception when others then raise exception 'Invalid answers'; end;
  if v_m.formative_type in ('true_false','multiple_choice') then
    select count(*) into v_correct from jsonb_array_elements(v_m.ai_content::jsonb->'questions') with ordinality as q(item, idx)
      where (v_answers -> ((q.idx - 1)::text)) = (v_m.answer_key::jsonb -> ((q.idx - 1)::text));
    v_score := v_correct; v_max := jsonb_array_length(v_m.ai_content::jsonb->'questions');
  elsif v_m.formative_type = 'drag_drop' then
    select count(*) into v_correct from jsonb_each(v_m.answer_key::jsonb) as a(key, value)
      where v_answers ->> a.key = trim(both '"' from a.value::text);
    v_score := v_correct; select count(*) into v_max from jsonb_object_keys(v_m.answer_key::jsonb);
  else v_score := greatest(0,least(coalesce(p_score,0),v_m.max_score)); v_max := v_m.max_score; end if;
  insert into public.mission_submissions(mission_id,group_id,classroom_id,score,xp_earned,graded_by,answers)
    values(v_m.id,p_group_id,v_group.classroom_id,v_score,greatest(0,round((v_score/nullif(v_max,0))*v_m.xp_reward)),v_user,p_answers)
    on conflict (mission_id,group_id) do update set score=excluded.score,xp_earned=excluded.xp_earned,graded_by=excluded.graded_by,answers=excluded.answers
    returning * into v_result;
  if v_m.formative_type in ('true_false','multiple_choice') then
    v_idx := 0;
    for v_item in select value from jsonb_array_elements(v_m.ai_content::jsonb->'questions') loop
      v_prompt := coalesce(v_item->>'prompt', 'Question ' || (v_idx + 1)::text); v_is_correct := (v_answers -> (v_idx::text)) = (v_m.answer_key::jsonb -> (v_idx::text));
      insert into public.learning_reviews(user_id,classroom_id,group_id,mission_id,prompt_key,prompt_text,next_review_at,interval_days,last_result)
        values(v_user,v_group.classroom_id,p_group_id,v_m.id,v_idx::text,v_prompt,case when v_is_correct then now()+interval '3 days' else now() end,case when v_is_correct then 3 else 1 end,v_is_correct)
        on conflict (user_id,mission_id,prompt_key) do update set prompt_text=excluded.prompt_text,next_review_at=case when excluded.last_result then now()+make_interval(days=>least(learning_reviews.interval_days*2,60)) else now() end,interval_days=case when excluded.last_result then least(learning_reviews.interval_days*2,60) else 1 end,last_result=excluded.last_result;
      v_idx := v_idx + 1;
    end loop;
  elsif v_m.formative_type = 'drag_drop' then
    for v_key, v_item in select key,value from jsonb_each(v_m.answer_key::jsonb) loop
      v_is_correct := (v_answers ->> v_key) = trim(both '"' from v_item::text);
      insert into public.learning_reviews(user_id,classroom_id,group_id,mission_id,prompt_key,prompt_text,next_review_at,interval_days,last_result)
        values(v_user,v_group.classroom_id,p_group_id,v_m.id,v_key,v_key,case when v_is_correct then now()+interval '3 days' else now() end,case when v_is_correct then 3 else 1 end,v_is_correct)
        on conflict (user_id,mission_id,prompt_key) do update set next_review_at=case when excluded.last_result then now()+make_interval(days=>least(learning_reviews.interval_days*2,60)) else now() end,interval_days=case when excluded.last_result then least(learning_reviews.interval_days*2,60) else 1 end,last_result=excluded.last_result;
    end loop;
  end if;
  return v_result;
end;
$$;
revoke all on function public.submit_mission(uuid,uuid,numeric,text) from public;
grant execute on function public.submit_mission(uuid,uuid,numeric,text) to authenticated;

-- Shared badge definitions use the active group's classroom for the award and
-- logs, even when the definition originated in another class.
create or replace function public.claim_badge_definition(p_definition_id uuid, p_group_id uuid, p_member_id uuid default null)
returns public.badges language plpgsql security definer set search_path = public as $$
declare v_user uuid:=auth.uid(); v_def public.badge_definitions%rowtype; v_group public.groups%rowtype; v_account public.group_accounts%rowtype; v_result public.badges%rowtype; v_week date; v_badge_type text;
begin
  if extract(dow from (now() at time zone 'Asia/Manila')) not in (0,6) then raise exception 'Badges can be claimed on Saturday or Sunday.'; end if;
  select bd.* into v_def from public.badge_definitions bd where bd.id=p_definition_id and bd.is_active=true and (bd.classroom_id=(select classroom_id from public.groups where id=p_group_id) or (bd.applies_to_all_classes and exists (select 1 from public.classrooms c join public.groups g on g.classroom_id=c.id where g.id=p_group_id and c.teacher_id=bd.created_by))) ;
  if not found then raise exception 'Badge is no longer available for this class'; end if;
  select * into v_group from public.groups where id=p_group_id; if not found then raise exception 'Invalid group'; end if;
  select * into v_account from public.group_accounts where user_id=v_user and group_id=p_group_id and is_approved=true limit 1; if not found then raise exception 'Approved classroom account required'; end if;
  if v_def.badge_scope='personal' and (p_member_id is null or p_member_id<>v_account.group_member_id) then raise exception 'Personal badges can only be claimed for your own student profile'; end if;
  v_week := (now() at time zone 'Asia/Manila')::date-extract(isodow from (now() at time zone 'Asia/Manila'))::integer+1;
  v_badge_type := 'custom:'||v_def.id::text||case when v_def.badge_scope='personal' then ':'||p_member_id::text else '' end;
  insert into public.badges(group_id,classroom_id,badge_type,week_start_date,points_awarded,redeemed_by,badge_definition_id,member_id)
    values(p_group_id,v_group.classroom_id,v_badge_type,v_week,v_def.points,v_user,p_definition_id,case when v_def.badge_scope='personal' then p_member_id else null end) returning * into v_result;
  if v_def.badge_scope='group' then insert into public.participation_logs(group_member_id,group_id,classroom_id,points_awarded,event_type,multiplier,recipient_type,note) values(null,p_group_id,v_group.classroom_id,v_def.points,'badge',1,'group',v_def.title);
  else insert into public.participation_logs(group_member_id,group_id,classroom_id,points_awarded,event_type,multiplier,recipient_type,note) values(p_member_id,p_group_id,v_group.classroom_id,v_def.points,'badge',1,'member',v_def.title); end if;
  return v_result;
exception when unique_violation then raise exception 'This badge has already been claimed this week.';
end;
$$;
revoke all on function public.claim_badge_definition(uuid,uuid,uuid) from public;
grant execute on function public.claim_badge_definition(uuid,uuid,uuid) to authenticated;

insert into storage.buckets (id, name, public) values ('mission-images','mission-images',true) on conflict (id) do nothing;
