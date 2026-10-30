-- Keep the learner's likely-misconception explanation private until after a
-- submission, then include it with the protected worked-review payload.

create or replace function public.sanitize_mission_for_student(p_mission public.missions)
returns jsonb language plpgsql immutable as $$
declare v_result jsonb; v_content jsonb; v_questions jsonb;
begin
  if p_mission.id is null then return null; end if;
  v_result := to_jsonb(p_mission) - 'answer_key';
  if p_mission.ai_content is null then return v_result; end if;
  begin
    v_content := p_mission.ai_content::jsonb;
    v_content := v_content - 'feedback' - 'solution_steps' - 'why_wrong' - 'remember' - 'retry_variants' - 'misconceptions';
    if jsonb_typeof(v_content -> 'questions') = 'array' then
      select coalesce(jsonb_agg(q.value - 'answer_index' - 'correct_index' - 'correct_answer' - 'answer'
        - 'explanation' - 'feedback' - 'student_feedback' - 'solution_steps' - 'why_wrong' - 'remember' - 'misconception'
        order by q.ordinality), '[]'::jsonb) into v_questions
      from jsonb_array_elements(v_content -> 'questions') with ordinality q(value, ordinality);
      v_content := jsonb_set(v_content, '{questions}', v_questions);
    end if;
    return jsonb_set(v_result, '{ai_content}', to_jsonb(v_content::text), true);
  exception when others then
    return jsonb_set(v_result, '{ai_content}', 'null'::jsonb, true);
  end;
end;
$$;

create or replace function public.get_mission_submission_review(
  p_mission_id uuid, p_group_id uuid, p_retry_attempt_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_member_id uuid; v_m public.missions%rowtype;
  v_submission public.mission_submissions%rowtype; v_retry public.mission_retry_attempts%rowtype;
  v_content jsonb; v_questions jsonb; v_raw_key jsonb; v_key jsonb; v_answers jsonb; v_items jsonb := '[]'::jsonb;
  v_index integer := 0; v_question jsonb; v_correct jsonb; v_selected jsonb; v_feedback jsonb;
  v_item_key text; v_item_value jsonb; v_expected text; v_selected_value text; v_max integer; v_tags text;
begin
  select group_member_id into v_member_id from public.group_accounts where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if v_member_id is null then raise exception 'Approved student account required'; end if;
  select * into v_m from public.missions where id = p_mission_id;
  if not found then raise exception 'Mission not found'; end if;
  v_content := coalesce(v_m.ai_content::jsonb, '{}'::jsonb);
  if p_retry_attempt_id is null then
    select * into v_submission from public.mission_submissions where mission_id = p_mission_id and group_member_id = v_member_id;
    if not found then raise exception 'Submit the mission before viewing feedback'; end if;
    v_questions := v_content -> 'questions'; v_raw_key := v_m.answer_key::jsonb;
    v_key := case when jsonb_typeof(v_raw_key) = 'object' and v_raw_key ? 'answers' then v_raw_key -> 'answers' else v_raw_key end;
    v_answers := v_submission.answers::jsonb;
  else
    select * into v_retry from public.mission_retry_attempts where id = p_retry_attempt_id and mission_id = p_mission_id and group_id = p_group_id and created_by = v_user and completed_at is not null;
    if not found then raise exception 'Retry feedback is unavailable'; end if;
    v_questions := v_retry.questions; v_key := v_retry.answer_key; v_answers := v_retry.submitted_answers;
  end if;
  if v_m.formative_type in ('drag_drop', 'fill_in_blank') then
    for v_item_key, v_item_value in select key, value from jsonb_each(v_key) loop
      v_expected := v_item_value #>> '{}'; v_selected_value := v_answers ->> v_item_key;
      v_feedback := case when v_m.formative_type = 'drag_drop' then v_content -> 'feedback' -> v_item_key else null end;
      v_question := case when v_m.formative_type = 'fill_in_blank' and split_part(v_item_key, ':', 1) ~ '^[0-9]+$'
        then v_questions -> (split_part(v_item_key, ':', 1)::integer) else null end;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'item', case when v_m.formative_type = 'fill_in_blank' then 'Blank ' || v_item_key else v_item_key end,
        'selected', v_selected_value, 'correct_answer', v_expected, 'correct', v_selected_value = v_expected,
        'explanation', case when jsonb_typeof(v_feedback) = 'string' then v_feedback #>> '{}'
          else coalesce(v_feedback ->> 'explanation', v_question ->> 'explanation') end,
        'solution_steps', coalesce(v_feedback -> 'solution_steps', v_question -> 'solution_steps', '[]'::jsonb),
        'why_wrong', coalesce(v_feedback ->> 'why_wrong', v_question ->> 'why_wrong', v_question ->> 'misconception'),
        'remember', coalesce(v_feedback ->> 'remember', v_question ->> 'remember')
      ));
    end loop;
    select count(*) into v_max from jsonb_object_keys(v_key);
    return jsonb_build_object('items', v_items, 'score', coalesce(v_retry.score, v_submission.score, 0), 'maxScore', v_max);
  end if;
  for v_question in select value from jsonb_array_elements(v_questions) loop
    select fq.tags into v_tags from public.foundation_questions fq where fq.question_id = v_question ->> 'question_id';
    v_correct := v_key -> v_index; v_selected := v_answers -> (v_index::text);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'index', v_index, 'correct', v_selected = v_correct, 'selected', v_selected, 'correct_answer', v_correct,
      'explanation', nullif(v_question ->> 'explanation', ''), 'solution_steps', coalesce(v_question -> 'solution_steps', '[]'::jsonb),
      'why_wrong', coalesce(nullif(v_question ->> 'why_wrong', ''), nullif(v_question ->> 'misconception', '')),
      'remember', nullif(v_question ->> 'remember', ''), 'feedback', nullif(v_question ->> 'feedback', ''),
      'tags', coalesce(nullif(v_question ->> 'tags', ''), v_tags), 'skill', nullif(v_question ->> 'skill', ''), 'domain', nullif(v_question ->> 'domain', '')
    ));
    v_index := v_index + 1;
  end loop;
  return jsonb_build_object('items', v_items, 'score', coalesce(v_retry.score, v_submission.score, 0), 'maxScore', jsonb_array_length(v_questions));
end;
$$;

create or replace function public.start_mission_retry(p_mission_id uuid, p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result jsonb; v_questions jsonb;
begin
  v_result := public.start_mission_retry_internal(p_mission_id, p_group_id);
  select coalesce(jsonb_agg(q.value - 'answer_index' - 'correct_index' - 'correct_answer' - 'answer'
    - 'explanation' - 'feedback' - 'student_feedback' - 'solution_steps' - 'why_wrong' - 'remember' - 'misconception'
    order by q.ordinality), '[]'::jsonb) into v_questions
  from jsonb_array_elements(coalesce(v_result -> 'questions', '[]'::jsonb)) with ordinality q(value, ordinality);
  return jsonb_set(v_result, '{questions}', v_questions);
end;
$$;

revoke all on function public.sanitize_mission_for_student(public.missions) from public;
grant execute on function public.sanitize_mission_for_student(public.missions) to authenticated;
revoke all on function public.get_mission_submission_review(uuid, uuid, uuid) from public;
grant execute on function public.get_mission_submission_review(uuid, uuid, uuid) to authenticated;
revoke all on function public.start_mission_retry(uuid, uuid) from public;
grant execute on function public.start_mission_retry(uuid, uuid) to authenticated;
