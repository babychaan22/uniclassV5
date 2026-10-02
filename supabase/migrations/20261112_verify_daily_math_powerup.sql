-- Deploy-time verification for the Daily Math Power-Up work.
--
-- The question bank ships as data, and the security properties (a student must
-- never receive an answer, and the shuffled key must stay aligned with the
-- displayed options) are properties of data plus code. Both are asserted here
-- so a bad import or a bad shuffle fails the deploy loudly instead of leaking
-- answers to students.

-- ── 1. The approved bank is complete and internally consistent ────────────

do $$
declare
  v_total integer;
  v_approved integer;
  v_active_approved integer;
  v_bad_options integer;
  v_bad_index integer;
  v_misaligned integer;
  v_no_explanation integer;
  v_empty_feedback integer;
  v_by_level integer[];
begin
  select count(*) into v_total from public.foundation_questions;
  select count(*) into v_approved
    from public.foundation_questions where review_status = 'APPROVED';
  select count(*) into v_active_approved
    from public.foundation_questions where review_status = 'APPROVED' and is_active;

  if v_total <> 3100 then
    raise exception 'Foundation bank has % rows, expected 3100', v_total;
  end if;

  if v_approved <> 3100 or v_active_approved <> 3100 then
    raise exception 'Foundation bank is not fully approved and active: % approved, % approved and active',
      v_approved, v_active_approved;
  end if;

  -- Exactly the documented daily mix must be available, otherwise
  -- ensure_daily_drill() can raise mid-morning and no student gets a mission.
  select array_agg(n order by level) into v_by_level
  from (
    select level, count(*) as n
    from public.foundation_questions
    where review_status = 'APPROVED' and is_active
    group by level
  ) s;
  if v_by_level is distinct from array[1200, 900, 1000] then
    raise exception 'Foundation bank level distribution is %, expected {1200,900,1000}', v_by_level;
  end if;

  select count(*) into v_bad_options from public.foundation_questions
    where jsonb_typeof(options) <> 'array' or jsonb_array_length(options) <> 4;
  if v_bad_options > 0 then
    raise exception '% foundation questions do not have exactly four options', v_bad_options;
  end if;

  select count(*) into v_bad_index from public.foundation_questions
    where correct_index is null or correct_index not between 0 and 3;
  if v_bad_index > 0 then
    raise exception '% foundation questions have an out-of-range correct_index', v_bad_index;
  end if;

  -- The single most dangerous import error: the key points at a distractor.
  select count(*) into v_misaligned from public.foundation_questions
    where options ->> correct_index is distinct from correct_answer;
  if v_misaligned > 0 then
    raise exception '% foundation questions have options that disagree with correct_index', v_misaligned;
  end if;

  select count(*) into v_no_explanation from public.foundation_questions
    where btrim(coalesce(answer_explanation, '')) = '';
  if v_no_explanation > 0 then
    raise exception '% foundation questions have no explanation, so students would get empty feedback', v_no_explanation;
  end if;

  select count(*) into v_empty_feedback from public.foundation_questions
    where btrim(coalesce(student_feedback, '')) = '';
  if v_empty_feedback > 0 then
    raise exception '% foundation questions have no student feedback', v_empty_feedback;
  end if;

  raise notice 'foundation bank verified: % approved questions, levels %', v_approved, v_by_level;
end;
$$;

-- ── 2. The sanitiser never leaks a per-item answer ────────────────────────
-- Built on a real bank row and a real shaped mission row, so this exercises the
-- same path get_student_missions() and ensure_daily_drill() use.

do $$
declare
  v_row public.foundation_questions%rowtype;
  v_mission public.missions%rowtype;
  v_payload jsonb;
  v_item jsonb;
  v_leaks text[] := '{}';
begin
  select * into v_row from public.foundation_questions
    where review_status = 'APPROVED' and is_active order by question_id limit 1;
  if not found then raise exception 'Foundation bank is empty'; end if;

  -- A %rowtype variable is already null, so only the columns the sanitiser
  -- reads need populating.
  v_mission.id := gen_random_uuid();
  v_mission.title := 'verification';
  v_mission.classroom_id := gen_random_uuid();
  v_mission.formative_type := 'multiple_choice';
  v_mission.answer_key := jsonb_build_object('answers', jsonb_build_array(v_row.correct_index))::text;
  v_mission.ai_content := jsonb_build_object(
    -- Mirrors the item shape ensure_daily_drill() writes, so the check covers
    -- the metadata the attempt log and the UI rely on.
    'questions', jsonb_build_array(jsonb_build_object(
      'id', 1,
      'question_id', v_row.question_id,
      'level', v_row.level,
      'skill', v_row.skill,
      'domain', v_row.domain,
      'difficulty', v_row.difficulty,
      'prompt', v_row.question,
      'question', v_row.question,
      'options', v_row.options,
      'answer_index', v_row.correct_index,
      'explanation', v_row.answer_explanation,
      'feedback', v_row.student_feedback
    )),
    'auto_generated', true,
    'mission_source', 'daily_foundation',
    'learning_target', 'verification',
    'student_instructions', 'verification',
    'estimated_minutes', 5
  )::text;

  v_payload := public.sanitize_mission_for_student(v_mission);

  if v_payload ? 'answer_key' then
    v_leaks := array_append(v_leaks, 'answer_key column');
  end if;

  for v_item in select value from jsonb_array_elements(v_payload -> 'ai_content' -> 'questions')
  loop
    if v_item ? 'answer_index' then v_leaks := array_append(v_leaks, 'answer_index'); end if;
    if v_item ? 'correct_index' then v_leaks := array_append(v_leaks, 'correct_index'); end if;
    if v_item ? 'correct_answer' then v_leaks := array_append(v_leaks, 'correct_answer'); end if;
    if v_item ? 'explanation' then v_leaks := array_append(v_leaks, 'explanation'); end if;
    if v_item ? 'feedback' then v_leaks := array_append(v_leaks, 'feedback'); end if;
  end loop;

  if array_length(v_leaks, 1) is not null then
    raise exception 'sanitize_mission_for_student leaked %', array_to_string(v_leaks, ', ');
  end if;

  -- The payload must still be usable: prompt, options and the non-answer
  -- metadata a student legitimately sees all have to survive the strip.
  v_item := v_payload -> 'ai_content' -> 'questions' -> 0;
  if v_item ->> 'prompt' is distinct from v_row.question then
    raise exception 'sanitiser removed the question prompt';
  end if;
  if (v_item -> 'options') is distinct from v_row.options then
    raise exception 'sanitiser altered the option list';
  end if;
  if (v_item ->> 'question_id') is distinct from v_row.question_id
     or (v_item ->> 'level') is distinct from v_row.level::text
     or (v_item ->> 'skill') is distinct from v_row.skill
     or (v_item ->> 'difficulty') is distinct from v_row.difficulty then
    raise exception 'sanitiser removed foundation metadata needed for mastery tracking';
  end if;
  if v_payload -> 'ai_content' ->> 'learning_target' is distinct from 'verification' then
    raise exception 'sanitiser removed the learning target';
  end if;

  raise notice 'sanitiser verified: answer key, index, explanation and feedback are all withheld';
end;
$$;

-- ── 3. Shuffling preserves the options and realigns the key ───────────────
-- Repeats over a large slice of the bank, because a shuffle that is correct for
-- one question but misaligned for another is exactly the bug that would leak
-- or mis-grade answers in production.

do $$
declare
  v_sample record;
  v_shuffled jsonb;
  v_before jsonb;
  v_after jsonb;
  v_index integer;
  v_seen integer;
  v_total integer := 0;
begin
  for v_sample in
    select options, correct_index, correct_answer
    from public.foundation_questions
    where review_status = 'APPROVED' and is_active
    order by question_id
    limit 400
  loop
    v_total := v_total + 1;
    v_shuffled := public.foundation_shuffle_options(v_sample.options, v_sample.correct_index);
    v_before := (select jsonb_agg(value order by value) from jsonb_array_elements(v_sample.options));
    v_after := (select jsonb_agg(value order by value) from jsonb_array_elements(v_shuffled -> 'options'));

    -- Same four options, no loss and no duplication.
    if v_before is distinct from v_after then
      raise exception 'shuffle changed the option set for % of % sampled questions', v_total, 400;
    end if;

    v_index := (v_shuffled ->> 'answer_index')::integer;
    if v_index is null or v_index not between 0 and 3 then
      raise exception 'shuffle produced an out-of-range answer_index for % of % sampled questions', v_total, 400;
    end if;

    -- The remapped index must still select the correct answer.
    if (v_shuffled -> 'options' ->> v_index) is distinct from v_sample.correct_answer then
      raise exception 'shuffle misaligned the answer key for % of % sampled questions', v_total, 400;
    end if;

    -- And the correct answer must not have been duplicated into another slot.
    v_seen := 0;
    select count(*) into v_seen
    from jsonb_array_elements(v_shuffled -> 'options') as o(value)
    where o.value #>> '{}' = v_sample.correct_answer;
    if v_seen <> 1 then
      raise exception 'shuffle duplicated or lost the correct answer for % of % sampled questions', v_total, 400;
    end if;
  end loop;

  if v_total < 400 then
    raise exception 'Expected at least 400 approved questions to verify shuffling, found %', v_total;
  end if;

  raise notice 'shuffle verified over % questions: options preserved and answer_index realigned', v_total;
end;
$$;

-- ── 4. The attempt log exists, is locked down, and is actually wired up ───

do $$
declare
  v_rls boolean;
  v_trigger boolean;
  v_policies int;
  v_columns int;
begin
  select relrowsecurity into v_rls
  from pg_class where oid = 'public.foundation_question_attempts'::regclass;
  if not coalesce(v_rls, false) then
    raise exception 'foundation_question_attempts does not have RLS enabled';
  end if;

  select count(*) into v_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'foundation_question_attempts';
  if v_columns < 13 then
    raise exception 'foundation_question_attempts has only % columns, expected at least 13', v_columns;
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'foundation_question_attempts';
  if v_policies < 2 then
    raise exception 'foundation_question_attempts has % policies, expected a student and a teacher policy', v_policies;
  end if;

  -- The trigger is the only writer, so a missing trigger means no mastery data.
  select exists (
    select 1 from pg_trigger
    where tgname = 'capture_foundation_attempts'
      and tgrelid = 'public.mission_submissions'::regclass
      and not tgisinternal
  ) into v_trigger;
  if not v_trigger then
    raise exception 'The capture_foundation_attempts trigger is missing from mission_submissions';
  end if;

  raise notice 'attempt log verified: RLS on, % policies, submission trigger installed', v_policies;
end;
$$;

-- ── 5. Every student-facing mission path is sanitised ─────────────────────
-- A function can be replaced later by a migration that forgets the strip, so
-- the guarantee is asserted against the live definitions instead of trusted.

do $$
declare
  v_def text;
  v_missing text[] := '{}';
  v_fn text;
begin
  foreach v_fn in array array[
    'get_student_missions',
    'ensure_daily_drill',
    'ensure_daily_drill_for_student'
  ]
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_fn;

    if v_def is null then
      v_missing := array_append(v_missing, v_fn || ' is missing');
    elsif v_fn = 'get_student_missions' and v_def not like '%sanitize_mission_for_student%' then
      v_missing := array_append(v_missing, v_fn || ' no longer sanitises');
    elsif v_fn = 'ensure_daily_drill' and v_def not like '%sanitize_mission_for_student%' then
      v_missing := array_append(v_missing, v_fn || ' no longer sanitises');
    end if;
  end loop;

  if array_length(v_missing, 1) is not null then
    raise exception 'Unsanitised student mission path: %', array_to_string(v_missing, '; ');
  end if;

  -- ensure_daily_drill must not hand back the composite type any more, because
  -- the composite type contains answer_key.
  select pg_get_function_result(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ensure_daily_drill';
  if v_def is not distinct from 'missions' then
    raise exception 'ensure_daily_drill still returns the missions row type, which carries answer_key';
  end if;

  raise notice 'student mission paths verified: all sanitise, and none return the answer-key row type';
end;
$$;
