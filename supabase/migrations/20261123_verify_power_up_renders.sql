-- 20261123 — prove the Power-Up renders for a real student, end to end.
--
-- "No questions available yet" means the student's own RPC call returned a
-- payload whose JSON.parse(ai_content) yields no questions. This exercises that
-- exact path per classroom: call the RPC as an approved student, parse the
-- result the way the client does, and require 5 renderable questions with no
-- answer data attached.

do $$
declare
  v_c        record;
  v_student  uuid;
  v_res      jsonb;
  v_content  jsonb;
  v_q        jsonb;
  v_problems text[] := '{}';
  v_classes  integer := 0;
  v_items    integer := 0;
begin
  for v_c in
    select c.id
    from public.classrooms c
    where lower(coalesce(nullif(btrim(c.subject), ''), 'General Studies'))
          ~ '(math|matemat|maths|mathematics|arithmetic|algebra|geometry)'
      and exists (
        select 1 from public.group_accounts ga
        where ga.classroom_id = c.id and ga.is_approved
      )
  loop
    v_classes := v_classes + 1;

    select ga.user_id into v_student
    from public.group_accounts ga
    where ga.classroom_id = v_c.id and ga.is_approved
    order by ga.created_date
    limit 1;

    execute 'set local request.jwt.claim.sub = ' || quote_literal(v_student::text);
    execute 'set local request.jwt.claims = ' || quote_literal(
      json_build_object('sub', v_student::text, 'role', 'authenticated')::text);

    begin
      v_res := public.ensure_daily_power_up_for_student(v_c.id);
    exception when others then
      v_problems := array_append(v_problems,
        'classroom ' || v_c.id || ': RPC raised ' || sqlerrm);
      continue;
    end;

    -- The client does JSON.parse(mission.ai_content). It must not be an object.
    if jsonb_typeof(v_res -> 'ai_content') <> 'string' then
      v_problems := array_append(v_problems,
        'classroom ' || v_c.id || ': ai_content is '
        || coalesce(jsonb_typeof(v_res -> 'ai_content'), 'missing') || ', not a string');
      continue;
    end if;

    begin
      v_content := (v_res ->> 'ai_content')::jsonb;
    exception when others then
      v_problems := array_append(v_problems,
        'classroom ' || v_c.id || ': client JSON.parse would throw');
      continue;
    end;

    v_q := v_content -> 'questions';
    if jsonb_typeof(v_q) <> 'array' or jsonb_array_length(v_q) < 5 then
      v_problems := array_append(v_problems,
        'classroom ' || v_c.id || ': only '
        || coalesce(jsonb_array_length(v_q), 0) || ' questions');
      continue;
    end if;

    -- Every question must be renderable, and answer-free.
    if exists (
      select 1 from jsonb_array_elements(v_q) it
      where coalesce(it ->> 'prompt', '') = ''
         or jsonb_typeof(it -> 'options') <> 'array'
         or jsonb_array_length(it -> 'options') <> 4
         or (it ?| array['answer_index','correct_index','correct_answer','answer',
                            'explanation','feedback','student_feedback'])
    ) then
      v_problems := array_append(v_problems,
        'classroom ' || v_c.id || ': a question is unrenderable or leaks its answer');
      continue;
    end if;

    -- The level mix the curriculum requires.
    if (select count(*) from jsonb_array_elements(v_q) it where (it ->> 'level') = '1') <> 2
       or (select count(*) from jsonb_array_elements(v_q) it where (it ->> 'level') = '2') <> 2
       or (select count(*) from jsonb_array_elements(v_q) it where (it ->> 'level') = '3') <> 1
    then
      v_problems := array_append(v_problems,
        'classroom ' || v_c.id || ': wrong level mix (need 2x L1, 2x L2, 1x L3)');
      continue;
    end if;

    v_items := v_items + jsonb_array_length(v_q);
  end loop;

  if array_length(v_problems, 1) is not null then
    raise exception 'Power-Up still broken: %', array_to_string(v_problems, '; ');
  end if;

  raise notice 'verified: % classroom(s), % student questions renderable', v_classes, v_items;
end;
$$;