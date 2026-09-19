-- AI mission answers are stored as an object keyed by question number
-- (for example, {"0": 1}), while generated answer keys are arrays
-- (for example, [1, 0]). JSONB requires a text key for the former and a
-- numeric array index for the latter. The earlier comparison used a text key
-- for both, causing every generated answer to grade as incorrect.

drop function if exists public.submit_mission(uuid,uuid,numeric,text,uuid);
create or replace function public.submit_mission(
  p_mission_id uuid, p_group_id uuid, p_score numeric, p_answers text,
  p_retry_attempt_id uuid default null
)
returns public.mission_submissions language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_m public.missions%rowtype; v_group public.groups%rowtype; v_result public.mission_submissions%rowtype;
  v_answers jsonb; v_raw_answer_key jsonb; v_answer_key jsonb; v_questions jsonb; v_score numeric; v_max numeric; v_correct integer;
  v_retry public.mission_retry_attempts%rowtype;
begin
  select * into v_group from public.groups where id=p_group_id;
  if not found or not exists (select 1 from public.group_accounts where user_id=v_user and group_id=p_group_id and is_approved=true) then raise exception 'You are not approved for this group'; end if;
  select * into v_m from public.missions where id=p_mission_id and is_active=true and (classroom_id=v_group.classroom_id or ((applies_to_all_classes or v_group.classroom_id=any(target_classroom_ids)) and exists(select 1 from public.classrooms c where c.id=v_group.classroom_id and c.teacher_id=missions.created_by))) for update;
  if not found then raise exception 'Mission is not active'; end if;
  if v_m.deadline is not null and v_m.deadline < current_date then raise exception 'Mission deadline has passed'; end if;
  begin v_answers := coalesce(nullif(p_answers,'')::jsonb,'{}'::jsonb); exception when others then raise exception 'Invalid answers'; end;
  v_questions := v_m.ai_content::jsonb->'questions';
  v_raw_answer_key := v_m.answer_key::jsonb;
  v_answer_key := case when jsonb_typeof(v_raw_answer_key)='object' and v_raw_answer_key ? 'answers' then v_raw_answer_key->'answers' else v_raw_answer_key end;
  if p_retry_attempt_id is not null then
    select * into v_retry from public.mission_retry_attempts where id=p_retry_attempt_id and mission_id=p_mission_id and group_id=p_group_id and created_by=v_user and completed_at is null for update;
    if not found then raise exception 'Retry attempt is unavailable'; end if;
    v_questions := v_retry.questions; v_answer_key := v_retry.answer_key;
  end if;
  if v_m.formative_type in ('true_false','multiple_choice') then
    select count(*) into v_correct from jsonb_array_elements(v_questions) with ordinality as q(item,idx)
      where (v_answers->((q.idx-1)::text))=(v_answer_key->((q.idx-1)::integer));
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
  v_questions jsonb; v_raw_key jsonb; v_key jsonb; v_answers jsonb; v_items jsonb; v_index integer:=0; v_question jsonb; v_correct jsonb; v_selected jsonb;
begin
  if not exists(select 1 from public.group_accounts where user_id=v_user and group_id=p_group_id and is_approved=true) then raise exception 'Approved classroom account required'; end if;
  select * into v_m from public.missions where id=p_mission_id; if not found then raise exception 'Mission not found'; end if;
  if p_retry_attempt_id is null then
    select * into v_submission from public.mission_submissions where mission_id=p_mission_id and group_id=p_group_id;
    if not found then raise exception 'Submit the mission before viewing feedback'; end if;
    v_questions:=v_m.ai_content::jsonb->'questions'; v_raw_key:=v_m.answer_key::jsonb; v_key:=case when jsonb_typeof(v_raw_key)='object' and v_raw_key ? 'answers' then v_raw_key->'answers' else v_raw_key end; v_answers:=v_submission.answers::jsonb;
  else
    select * into v_retry from public.mission_retry_attempts where id=p_retry_attempt_id and mission_id=p_mission_id and group_id=p_group_id and created_by=v_user and completed_at is not null;
    if not found then raise exception 'Retry feedback is unavailable'; end if;
    v_questions:=v_retry.questions; v_key:=v_retry.answer_key; v_answers:=v_retry.submitted_answers;
  end if;
  if v_m.formative_type='drag_drop' then return jsonb_build_object('items','[]'::jsonb,'score',coalesce(v_retry.score,v_submission.score,0)); end if;
  v_items:='[]'::jsonb;
  for v_question in select value from jsonb_array_elements(v_questions) loop
    v_correct:=v_key->v_index; v_selected:=v_answers->(v_index::text);
    v_items:=v_items || jsonb_build_array(jsonb_build_object('index',v_index,'correct',v_selected=v_correct,'selected',v_selected,'correct_answer',v_correct,'explanation',coalesce(v_question->>'explanation','Review this idea with your teacher or lesson notes.')));
    v_index:=v_index+1;
  end loop;
  return jsonb_build_object('items',v_items,'score',coalesce(v_retry.score,v_submission.score,0),'maxScore',jsonb_array_length(v_questions));
end;
$$;

-- Repair completed true/false and multiple-choice submissions, including the
-- one already reported as 0/5 despite four correct answers.
with regraded as (
  select s.id,
    count(*) filter (where (s.answers::jsonb->((q.idx-1)::text)) = (
      (case when jsonb_typeof(m.answer_key::jsonb)='object' and m.answer_key::jsonb ? 'answers' then m.answer_key::jsonb->'answers' else m.answer_key::jsonb end)->((q.idx-1)::integer)
    )) as score,
    count(*) as max_score,
    m.xp_reward
  from public.mission_submissions s
  join public.missions m on m.id=s.mission_id
  cross join lateral jsonb_array_elements(coalesce(m.ai_content::jsonb->'questions','[]'::jsonb)) with ordinality as q(item,idx)
  where m.formative_type in ('true_false','multiple_choice')
  group by s.id,m.xp_reward
)
update public.mission_submissions s
set score=r.score,
    xp_earned=greatest(0,round((r.score/nullif(r.max_score,0))*r.xp_reward))
from regraded r
where s.id=r.id;

-- Correct the spaced-review outcome created from the same answers.
with corrected_reviews as (
  select lr.id,
    (s.answers::jsonb->lr.prompt_key) = (
      (case when jsonb_typeof(m.answer_key::jsonb)='object' and m.answer_key::jsonb ? 'answers' then m.answer_key::jsonb->'answers' else m.answer_key::jsonb end)->(lr.prompt_key::integer)
    ) as is_correct
  from public.learning_reviews lr
  join public.mission_submissions s on s.mission_id=lr.mission_id and s.group_id=lr.group_id
  join public.missions m on m.id=lr.mission_id
  where m.formative_type in ('true_false','multiple_choice') and lr.prompt_key ~ '^[0-9]+$'
)
update public.learning_reviews lr
set last_result=r.is_correct,
    interval_days=case when r.is_correct then greatest(lr.interval_days,3) else 1 end,
    next_review_at=case when r.is_correct then now()+interval '3 days' else now() end
from corrected_reviews r
where lr.id=r.id;

revoke all on function public.submit_mission(uuid,uuid,numeric,text,uuid) from public;
revoke all on function public.get_mission_submission_review(uuid,uuid,uuid) from public;
grant execute on function public.submit_mission(uuid,uuid,numeric,text,uuid) to authenticated;
grant execute on function public.get_mission_submission_review(uuid,uuid,uuid) to authenticated;
