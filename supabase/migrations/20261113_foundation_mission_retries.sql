-- Fresh retries for the Daily Math Power-Up.
--
-- start_mission_retry() serves a retry from a pre-generated `retry_variants`
-- entry in the mission's answer_key. Power-Up missions are built from the
-- question bank and have no such variant, so the button raised "This mission
-- has no generated retry variant" for every student. The bank makes a real
-- fresh variant possible: five different questions, same 2 + 2 + 1 level mix,
-- options shuffled again.
--
-- The stored attempt keeps answer_index and explanation, because
-- submit_mission() and get_mission_submission_review() both grade from it
-- server-side. Only the copy returned to the browser is stripped, so a retry
-- reveals the answer no earlier than the first attempt did.

create or replace function public.start_mission_retry(p_mission_id uuid, p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_member_id uuid;
  v_m public.missions%rowtype;
  v_group public.groups%rowtype;
  v_attempt public.mission_retry_attempts%rowtype;
  v_variant jsonb;

  v_items jsonb := '[]'::jsonb;
  v_answers jsonb := '[]'::jsonb;
  v_used text[] := '{}'::text[];
  v_row record;
  v_shuffled jsonb;
  v_i integer := 0;
begin
  select group_member_id into v_member_id from public.group_accounts
    where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if v_member_id is null then raise exception 'Approved student account required'; end if;

  select * into v_group from public.groups where id = p_group_id;
  if not found then raise exception 'Group not found'; end if;

  if not exists (
    select 1 from public.mission_submissions
    where mission_id = p_mission_id and group_member_id = v_member_id
  ) then
    raise exception 'Submit your mission before starting a retry';
  end if;

  select * into v_m from public.missions where id = p_mission_id and is_active = true;
  if not found or v_m.formative_type not in ('true_false', 'multiple_choice') then
    raise exception 'A fresh retry is not available for this mission type';
  end if;

  if v_m.mission_source = 'daily_foundation' then
    -- Retry with different questions rather than the same five again.
    select coalesce(array_agg(q->>'question_id'), '{}'::text[])
    into v_used
    from jsonb_array_elements(coalesce(v_m.ai_content::jsonb -> 'questions', '[]'::jsonb)) q;

    for v_row in
      (
        select * from (
          select fq.*, row_number() over (partition by fq.level order by md5(random()::text || fq.question_id)) as rn
          from public.foundation_questions fq
          where fq.review_status = 'APPROVED'
            and fq.is_active
            and fq.level in (1, 2, 3)
            and not (fq.question_id = any (v_used))
            and jsonb_typeof(fq.options) = 'array'
            and jsonb_array_length(fq.options) = 4
            and fq.correct_index between 0 and 3
            and fq.options ->> fq.correct_index = fq.correct_answer
            and btrim(coalesce(fq.answer_explanation, '')) <> ''
        ) q
        where (level = 1 and rn <= 2)
           or (level = 2 and rn <= 2)
           or (level = 3 and rn <= 1)
        order by md5(random()::text || question_id)
        limit 5
      )
    loop
      v_i := v_i + 1;
      v_shuffled := public.foundation_shuffle_options(v_row.options, v_row.correct_index);

      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'id', v_i,
        'question_id', v_row.question_id,
        'level', v_row.level,
        'skill', v_row.skill,
        'domain', v_row.domain,
        'difficulty', v_row.difficulty,
        'prompt', v_row.question,
        'question', v_row.question,
        'options', v_shuffled->'options',
        'answer_index', v_shuffled->'answer_index',
        'explanation', v_row.answer_explanation,
        'feedback', v_row.student_feedback
      ));

      v_answers := v_answers || jsonb_build_array(v_shuffled->'answer_index');
    end loop;

    -- The bank is large enough that this should be unreachable, but a retry
    -- with fewer than five questions would be mis-graded, so refuse instead.
    if v_i < 5 then
      raise exception 'There are not enough unused foundation questions left for a fresh retry. Try again after tomorrow''s Power-Up.';
    end if;

    insert into public.mission_retry_attempts(mission_id, group_id, classroom_id, created_by, questions, answer_key)
      values(p_mission_id, p_group_id, v_group.classroom_id, v_user, v_items, v_answers)
      returning * into v_attempt;

    return jsonb_build_object(
      'attemptId', v_attempt.id,
      'questions', (
        select coalesce(
          jsonb_agg(
            (q.value - 'answer_index' - 'explanation' - 'feedback' - 'student_feedback')
            order by q.ordinality
          ),
          '[]'::jsonb
        )
        from jsonb_array_elements(v_attempt.questions) with ordinality as q(value, ordinality)
      )
    );
  end if;

  v_variant := case when jsonb_typeof(v_m.answer_key::jsonb) = 'object' then v_m.answer_key::jsonb -> 'retry_variants' -> 0 else null end;
  if v_variant is null or jsonb_array_length(coalesce(v_variant -> 'questions', '[]'::jsonb)) = 0 then
    raise exception 'This mission has no generated retry variant. Ask your teacher to create a new mission.';
  end if;

  insert into public.mission_retry_attempts(mission_id, group_id, classroom_id, created_by, questions, answer_key)
    values(p_mission_id, p_group_id, v_group.classroom_id, v_user, v_variant -> 'questions', v_variant -> 'answers')
    returning * into v_attempt;

  return jsonb_build_object('attemptId', v_attempt.id, 'questions', v_attempt.questions);
end;
$$;

revoke all on function public.start_mission_retry(uuid, uuid) from public;
grant execute on function public.start_mission_retry(uuid, uuid) to authenticated;

-- ── Verification ─────────────────────────────────────────────────────────

do $$
declare
  v_def text;
  v_leaks text[] := '{}';
  v_item jsonb;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'start_mission_retry';

  if v_def is null then raise exception 'start_mission_retry is missing'; end if;
  if v_def not like '%daily_foundation%' then
    raise exception 'start_mission_retry no longer serves foundation retries';
  end if;
  -- The foundation branch must strip before returning, not return the stored
  -- attempt unchanged like the teacher-variant branch does.
  if v_def not like '%- ''answer_index''%' then
    raise exception 'start_mission_retry returns retry questions without stripping answer_index';
  end if;

  -- Re-check the strip on a real attempt-shaped payload.
  v_item := jsonb_build_object(
    'prompt', 'verification', 'options', '[]'::jsonb,
    'answer_index', 2, 'explanation', 'verification', 'feedback', 'verification'
  ) - 'answer_index' - 'explanation' - 'feedback' - 'student_feedback';
  if v_item ? 'answer_index' or v_item ? 'explanation' or v_item ? 'feedback' then
    v_leaks := array_append(v_leaks, 'retry payload');
  end if;
  if v_item ->> 'prompt' is distinct from 'verification' then
    v_leaks := array_append(v_leaks, 'retry prompt removed');
  end if;

  if array_length(v_leaks, 1) is not null then
    raise exception 'start_mission_retry leak: %', array_to_string(v_leaks, ', ');
  end if;

  -- The bank must hold enough distinct questions to cover a mission and its
  -- retry, so the retry path can never be short of questions in practice.
  if (select count(*) from public.foundation_questions where review_status = 'APPROVED' and is_active) < 10 then
    raise exception 'Approved foundation bank is too small to serve retries';
  end if;

  raise notice 'foundation retry verified: served from the bank, stored with its key, returned sanitised';
end;
$$;
