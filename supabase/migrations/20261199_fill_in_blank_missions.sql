-- Add secure server-side grading and feedback for word-bank fill-in-the-blank
-- missions. The browser never receives the answer key before submission.

create or replace function public.submit_mission(
  p_mission_id uuid, p_group_id uuid, p_score numeric, p_answers text,
  p_retry_attempt_id uuid default null
)
returns public.mission_submissions language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_account public.group_accounts%rowtype; v_m public.missions%rowtype;
  v_group public.groups%rowtype; v_result public.mission_submissions%rowtype; v_answers jsonb;
  v_raw_answer_key jsonb; v_answer_key jsonb; v_questions jsonb; v_score numeric; v_max numeric;
  v_correct integer; v_retry public.mission_retry_attempts%rowtype;
begin
  select * into v_account from public.group_accounts where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved student account required'; end if;
  select * into v_group from public.groups where id = p_group_id;
  select * into v_m from public.missions where id = p_mission_id and is_active = true
    and (classroom_id = v_group.classroom_id or ((applies_to_all_classes or v_group.classroom_id = any(target_classroom_ids)) and exists (select 1 from public.classrooms c where c.id = v_group.classroom_id and c.teacher_id = missions.created_by)) or (missions.mission_source = 'daily_foundation' and missions.classroom_id is null and missions.approval_status = 'approved' and coalesce((select public.foundation_class_serves_power_up(c.subject) from public.classrooms c where c.id = v_group.classroom_id), false)));
  if not found then raise exception 'Mission is not active'; end if;
  if v_m.archived_at is not null then raise exception 'This mission has been archived'; end if;
  if v_m.deadline is not null and v_m.deadline < current_date then raise exception 'Mission deadline has passed'; end if;
  if p_retry_attempt_id is null and v_m.formative_type = 'manual' then raise exception 'Teacher-graded missions cannot be self-submitted'; end if;
  begin v_answers := coalesce(nullif(p_answers, '')::jsonb, '{}'::jsonb); exception when others then raise exception 'Invalid answers'; end;
  v_questions := v_m.ai_content::jsonb -> 'questions'; v_raw_answer_key := v_m.answer_key::jsonb;
  v_answer_key := case when jsonb_typeof(v_raw_answer_key) = 'object' and v_raw_answer_key ? 'answers' then v_raw_answer_key -> 'answers' else v_raw_answer_key end;
  if p_retry_attempt_id is not null then
    select * into v_retry from public.mission_retry_attempts where id = p_retry_attempt_id and mission_id = p_mission_id and group_id = p_group_id and created_by = v_user and completed_at is null for update;
    if not found then raise exception 'Retry attempt is unavailable'; end if;
    v_questions := v_retry.questions; v_answer_key := v_retry.answer_key;
  end if;
  if v_m.formative_type in ('true_false', 'multiple_choice') then
    select count(*) into v_correct from jsonb_array_elements(v_questions) with ordinality as q(item, idx) where (v_answers -> ((q.idx - 1)::text)) = (v_answer_key -> ((q.idx - 1)::integer)); v_score := v_correct; v_max := jsonb_array_length(v_questions);
  elsif v_m.formative_type in ('drag_drop', 'fill_in_blank') then
    select count(*) into v_correct from jsonb_each(v_answer_key) a(key, value) where v_answers ->> a.key = trim(both '"' from a.value::text); v_score := v_correct; select count(*) into v_max from jsonb_object_keys(v_answer_key);
  else raise exception 'Unsupported student mission type'; end if;
  if p_retry_attempt_id is not null then
    update public.mission_retry_attempts set submitted_answers = v_answers, score = v_score, completed_at = now() where id = p_retry_attempt_id;
    select * into v_result from public.mission_submissions where mission_id = p_mission_id and group_member_id = v_account.group_member_id;
    if not found then raise exception 'Your original mission submission is unavailable'; end if; return v_result;
  end if;
  insert into public.mission_submissions(mission_id, group_id, group_member_id, classroom_id, score, xp_earned, graded_by, answers)
  values (v_m.id, p_group_id, v_account.group_member_id, v_group.classroom_id, v_score, greatest(0, round((v_score / nullif(v_max, 0)) * v_m.xp_reward)), v_user, p_answers)
  on conflict (mission_id, group_member_id) where group_member_id is not null do update set score = mission_submissions.score, xp_earned = mission_submissions.xp_earned, graded_by = mission_submissions.graded_by, answers = mission_submissions.answers returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.get_mission_submission_review(
  p_mission_id uuid, p_group_id uuid, p_retry_attempt_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_member_id uuid; v_m public.missions%rowtype;
  v_submission public.mission_submissions%rowtype; v_retry public.mission_retry_attempts%rowtype;
  v_questions jsonb; v_raw_key jsonb; v_key jsonb; v_answers jsonb; v_items jsonb := '[]'::jsonb;
  v_index integer := 0; v_question jsonb; v_correct jsonb; v_selected jsonb;
  v_item_key text; v_item_value jsonb; v_expected text; v_selected_value text; v_max integer;
  v_tags text;
begin
  select group_member_id into v_member_id from public.group_accounts where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if v_member_id is null then raise exception 'Approved student account required'; end if;
  select * into v_m from public.missions where id = p_mission_id;
  if not found then raise exception 'Mission not found'; end if;
  if p_retry_attempt_id is null then
    select * into v_submission from public.mission_submissions where mission_id = p_mission_id and group_member_id = v_member_id;
    if not found then raise exception 'Submit the mission before viewing feedback'; end if;
    v_questions := v_m.ai_content::jsonb -> 'questions'; v_raw_key := v_m.answer_key::jsonb;
    v_key := case when jsonb_typeof(v_raw_key) = 'object' and v_raw_key ? 'answers' then v_raw_key -> 'answers' else v_raw_key end;
    v_answers := v_submission.answers::jsonb;
  else
    select * into v_retry from public.mission_retry_attempts where id = p_retry_attempt_id and mission_id = p_mission_id and group_id = p_group_id and created_by = v_user and completed_at is not null;
    if not found then raise exception 'Retry feedback is unavailable'; end if;
    v_questions := v_retry.questions; v_key := v_retry.answer_key; v_answers := v_retry.submitted_answers;
  end if;
  if v_m.formative_type in ('drag_drop', 'fill_in_blank') then
    for v_item_key, v_item_value in select key, value from jsonb_each(v_key) loop
      v_expected := trim(both '"' from v_item_value::text); v_selected_value := v_answers ->> v_item_key;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'item', case when v_m.formative_type = 'fill_in_blank' then 'Blank ' || v_item_key else v_item_key end,
        'selected', v_selected_value, 'correct_answer', v_expected, 'correct', v_selected_value = v_expected,
        'explanation', case when v_m.formative_type = 'fill_in_blank' then 'Read the complete sentence and choose the word that makes its meaning correct.' else format('%s belongs in %s.', v_item_key, v_expected) end
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
      'explanation', coalesce(v_question ->> 'explanation', 'Review this idea with your teacher or lesson notes.'),
      'feedback', nullif(v_question ->> 'feedback', ''), 'tags', coalesce(nullif(v_question ->> 'tags', ''), v_tags),
      'skill', nullif(v_question ->> 'skill', ''), 'domain', nullif(v_question ->> 'domain', '')
    ));
    v_index := v_index + 1;
  end loop;
  return jsonb_build_object('items', v_items, 'score', coalesce(v_retry.score, v_submission.score, 0), 'maxScore', jsonb_array_length(v_questions));
end;
$$;

revoke all on function public.submit_mission(uuid, uuid, numeric, text, uuid) from public;
grant execute on function public.submit_mission(uuid, uuid, numeric, text, uuid) to authenticated;
revoke all on function public.get_mission_submission_review(uuid, uuid, uuid) from public;
grant execute on function public.get_mission_submission_review(uuid, uuid, uuid) to authenticated;
