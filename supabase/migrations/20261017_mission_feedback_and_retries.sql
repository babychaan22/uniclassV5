-- Store retry answer keys privately; students retrieve only questions and the
-- review for an attempt they have already submitted.
create table if not exists public.mission_retry_attempts (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  questions jsonb not null,
  answer_key jsonb not null,
  submitted_answers jsonb,
  score numeric,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.mission_retry_attempts enable row level security;
drop policy if exists mission_retry_attempts_no_direct_access on public.mission_retry_attempts;
create policy mission_retry_attempts_no_direct_access on public.mission_retry_attempts for all to authenticated using (false) with check (false);

-- Keep legacy answer-key arrays working while new missions use an object with
-- answers and a generated retry variant.
drop function if exists public.submit_mission(uuid,uuid,numeric,text);
create or replace function public.submit_mission(
  p_mission_id uuid, p_group_id uuid, p_score numeric, p_answers text,
  p_retry_attempt_id uuid default null
)
returns public.mission_submissions language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_m public.missions%rowtype; v_group public.groups%rowtype; v_result public.mission_submissions%rowtype;
  v_answers jsonb; v_answer_key jsonb; v_questions jsonb; v_score numeric; v_max numeric; v_correct integer;
  v_retry public.mission_retry_attempts%rowtype;
begin
  select * into v_group from public.groups where id=p_group_id;
  if not found or not exists (select 1 from public.group_accounts where user_id=v_user and group_id=p_group_id and is_approved=true) then raise exception 'You are not approved for this group'; end if;
  select * into v_m from public.missions where id=p_mission_id and is_active=true and (classroom_id=v_group.classroom_id or ((applies_to_all_classes or v_group.classroom_id=any(target_classroom_ids)) and exists(select 1 from public.classrooms c where c.id=v_group.classroom_id and c.teacher_id=missions.created_by))) for update;
  if not found then raise exception 'Mission is not active'; end if;
  if v_m.deadline is not null and v_m.deadline < current_date then raise exception 'Mission deadline has passed'; end if;
  begin v_answers := coalesce(nullif(p_answers,'')::jsonb,'{}'::jsonb); exception when others then raise exception 'Invalid answers'; end;
  v_questions := v_m.ai_content::jsonb->'questions';
  v_answer_key := case when jsonb_typeof(v_m.answer_key::jsonb)='object' then v_m.answer_key::jsonb->'answers' else v_m.answer_key::jsonb end;
  if p_retry_attempt_id is not null then
    select * into v_retry from public.mission_retry_attempts where id=p_retry_attempt_id and mission_id=p_mission_id and group_id=p_group_id and created_by=v_user and completed_at is null for update;
    if not found then raise exception 'Retry attempt is unavailable'; end if;
    v_questions := v_retry.questions; v_answer_key := v_retry.answer_key;
  end if;
  if v_m.formative_type in ('true_false','multiple_choice') then
    select count(*) into v_correct from jsonb_array_elements(v_questions) with ordinality as q(item,idx) where (v_answers->((q.idx-1)::text))=(v_answer_key->((q.idx-1)::text));
    v_score:=v_correct; v_max:=jsonb_array_length(v_questions);
  elsif v_m.formative_type='drag_drop' then
    select count(*) into v_correct from jsonb_each(v_answer_key) a(key,value) where v_answers->>a.key=trim(both '"' from a.value::text);
    v_score:=v_correct; select count(*) into v_max from jsonb_object_keys(v_answer_key);
  else v_score:=greatest(0,least(coalesce(p_score,0),v_m.max_score)); v_max:=v_m.max_score; end if;
  insert into public.mission_submissions(mission_id,group_id,classroom_id,score,xp_earned,graded_by,answers)
    values(v_m.id,p_group_id,v_group.classroom_id,v_score,greatest(0,round((v_score/nullif(v_max,0))*v_m.xp_reward)),v_user,p_answers)
    on conflict(mission_id,group_id) do update set score=greatest(mission_submissions.score,excluded.score),xp_earned=greatest(mission_submissions.xp_earned,excluded.xp_earned),graded_by=excluded.graded_by,answers=case when excluded.score >= mission_submissions.score then excluded.answers else mission_submissions.answers end
    returning * into v_result;
  if p_retry_attempt_id is not null then update public.mission_retry_attempts set submitted_answers=v_answers,score=v_score,completed_at=now() where id=p_retry_attempt_id; end if;
  return v_result;
end;
$$;

create or replace function public.get_mission_submission_review(p_mission_id uuid, p_group_id uuid, p_retry_attempt_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid:=auth.uid(); v_m public.missions%rowtype; v_submission public.mission_submissions%rowtype; v_retry public.mission_retry_attempts%rowtype;
  v_questions jsonb; v_key jsonb; v_answers jsonb; v_items jsonb; v_index integer:=0; v_question jsonb; v_correct jsonb; v_selected jsonb;
begin
  if not exists(select 1 from public.group_accounts where user_id=v_user and group_id=p_group_id and is_approved=true) then raise exception 'Approved classroom account required'; end if;
  select * into v_m from public.missions where id=p_mission_id; if not found then raise exception 'Mission not found'; end if;
  if p_retry_attempt_id is null then
    select * into v_submission from public.mission_submissions where mission_id=p_mission_id and group_id=p_group_id;
    if not found then raise exception 'Submit the mission before viewing feedback'; end if;
    v_questions:=v_m.ai_content::jsonb->'questions'; v_key:=case when jsonb_typeof(v_m.answer_key::jsonb)='object' then v_m.answer_key::jsonb->'answers' else v_m.answer_key::jsonb end; v_answers:=v_submission.answers::jsonb;
  else
    select * into v_retry from public.mission_retry_attempts where id=p_retry_attempt_id and mission_id=p_mission_id and group_id=p_group_id and created_by=v_user and completed_at is not null;
    if not found then raise exception 'Retry feedback is unavailable'; end if;
    v_questions:=v_retry.questions; v_key:=v_retry.answer_key; v_answers:=v_retry.submitted_answers;
  end if;
  if v_m.formative_type='drag_drop' then return jsonb_build_object('items','[]'::jsonb,'score',coalesce(v_retry.score,v_submission.score,0)); end if;
  v_items:='[]'::jsonb;
  for v_question in select value from jsonb_array_elements(v_questions) loop
    v_correct:=v_key->v_index; v_selected:=v_answers->v_index;
    v_items:=v_items || jsonb_build_array(jsonb_build_object('index',v_index,'correct',v_selected=v_correct,'selected',v_selected,'correct_answer',v_correct,'explanation',coalesce(v_question->>'explanation','Review this idea with your teacher or lesson notes.')));
    v_index:=v_index+1;
  end loop;
  return jsonb_build_object('items',v_items,'score',coalesce(v_retry.score,v_submission.score,0),'maxScore',jsonb_array_length(v_questions));
end;
$$;

create or replace function public.start_mission_retry(p_mission_id uuid, p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid:=auth.uid(); v_m public.missions%rowtype; v_variant jsonb; v_attempt public.mission_retry_attempts%rowtype; v_group public.groups%rowtype;
begin
  select * into v_group from public.groups where id=p_group_id;
  if not found or not exists(select 1 from public.group_accounts where user_id=v_user and group_id=p_group_id and is_approved=true) then raise exception 'Approved classroom account required'; end if;
  if not exists(select 1 from public.mission_submissions where mission_id=p_mission_id and group_id=p_group_id) then raise exception 'Submit the mission before starting a retry'; end if;
  select * into v_m from public.missions where id=p_mission_id and is_active=true; if not found or v_m.formative_type not in ('true_false','multiple_choice') then raise exception 'A fresh retry is not available for this mission type'; end if;
  v_variant := case when jsonb_typeof(v_m.answer_key::jsonb)='object' then v_m.answer_key::jsonb->'retry_variants'->0 else null end;
  if v_variant is null or jsonb_array_length(coalesce(v_variant->'questions','[]'::jsonb))=0 then raise exception 'This mission has no generated retry variant. Ask your teacher to create a new mission.'; end if;
  insert into public.mission_retry_attempts(mission_id,group_id,classroom_id,created_by,questions,answer_key) values(p_mission_id,p_group_id,v_group.classroom_id,v_user,v_variant->'questions',v_variant->'answers') returning * into v_attempt;
  return jsonb_build_object('attemptId',v_attempt.id,'questions',v_attempt.questions);
end;
$$;

revoke all on function public.submit_mission(uuid,uuid,numeric,text,uuid) from public;
revoke all on function public.get_mission_submission_review(uuid,uuid,uuid) from public;
revoke all on function public.start_mission_retry(uuid,uuid) from public;
grant execute on function public.submit_mission(uuid,uuid,numeric,text,uuid) to authenticated;
grant execute on function public.get_mission_submission_review(uuid,uuid,uuid) to authenticated;
grant execute on function public.start_mission_retry(uuid,uuid) to authenticated;
