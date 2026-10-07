-- The foundation bank's tags hold the precise rule or method a learner needs
-- after submitting. They are returned only in the protected review payload,
-- never in the mission sent before submission.

create or replace function public.get_mission_submission_review(
  p_mission_id uuid, p_group_id uuid, p_retry_attempt_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_member_id uuid; v_m public.missions%rowtype;
  v_submission public.mission_submissions%rowtype; v_retry public.mission_retry_attempts%rowtype;
  v_questions jsonb; v_raw_key jsonb; v_key jsonb; v_answers jsonb; v_items jsonb := '[]'::jsonb;
  v_index integer := 0; v_question jsonb; v_correct jsonb; v_selected jsonb;
  v_item_key text; v_item_value jsonb; v_expected text; v_selected_category text; v_max integer;
  v_tags text;
begin
  select group_member_id into v_member_id from public.group_accounts
    where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if v_member_id is null then raise exception 'Approved student account required'; end if;
  select * into v_m from public.missions where id = p_mission_id;
  if not found then raise exception 'Mission not found'; end if;

  if p_retry_attempt_id is null then
    select * into v_submission from public.mission_submissions where mission_id = p_mission_id and group_member_id = v_member_id;
    if not found then raise exception 'Submit the mission before viewing feedback'; end if;
    v_questions := v_m.ai_content::jsonb -> 'questions';
    v_raw_key := v_m.answer_key::jsonb;
    v_key := case when jsonb_typeof(v_raw_key) = 'object' and v_raw_key ? 'answers' then v_raw_key -> 'answers' else v_raw_key end;
    v_answers := v_submission.answers::jsonb;
  else
    select * into v_retry from public.mission_retry_attempts where id = p_retry_attempt_id and mission_id = p_mission_id and group_id = p_group_id and created_by = v_user and completed_at is not null;
    if not found then raise exception 'Retry feedback is unavailable'; end if;
    v_questions := v_retry.questions; v_key := v_retry.answer_key; v_answers := v_retry.submitted_answers;
  end if;

  if v_m.formative_type = 'drag_drop' then
    for v_item_key, v_item_value in select key, value from jsonb_each(v_key) loop
      v_expected := trim(both '"' from v_item_value::text); v_selected_category := v_answers ->> v_item_key;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'item', v_item_key, 'selected', v_selected_category, 'correct_answer', v_expected,
        'correct', v_selected_category = v_expected,
        'explanation', coalesce(v_m.ai_content::jsonb -> 'feedback' ->> v_item_key, format('%s belongs in %s.', v_item_key, v_expected))
      ));
    end loop;
    select count(*) into v_max from jsonb_object_keys(v_key);
    return jsonb_build_object('items', v_items, 'score', coalesce(v_retry.score, v_submission.score, 0), 'maxScore', v_max);
  end if;

  for v_question in select value from jsonb_array_elements(v_questions) loop
    -- Foundation tags are retrieved only now, after a saved submission. This
    -- gives the learner the seed's rule/method without exposing it mid-quiz.
    select fq.tags into v_tags from public.foundation_questions fq where fq.question_id = v_question ->> 'question_id';
    v_correct := v_key -> v_index; v_selected := v_answers -> (v_index::text);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'index', v_index, 'correct', v_selected = v_correct, 'selected', v_selected,
      'correct_answer', v_correct,
      'explanation', coalesce(v_question ->> 'explanation', 'Review this idea with your teacher or lesson notes.'),
      'feedback', nullif(v_question ->> 'feedback', ''),
      'tags', coalesce(nullif(v_question ->> 'tags', ''), v_tags),
      'skill', nullif(v_question ->> 'skill', ''),
      'domain', nullif(v_question ->> 'domain', '')
    ));
    v_index := v_index + 1;
  end loop;
  return jsonb_build_object('items', v_items, 'score', coalesce(v_retry.score, v_submission.score, 0), 'maxScore', jsonb_array_length(v_questions));
end;
$$;

revoke all on function public.get_mission_submission_review(uuid, uuid, uuid) from public;
grant execute on function public.get_mission_submission_review(uuid, uuid, uuid) to authenticated;
