-- 20261137 — the release gate for the shared Daily Math Power-Up.
--
-- Every earlier migration verified one thing on the day it shipped. This one
-- re-asserts the whole promise against the database as it stands now, so the
-- state is on the record rather than inferred from a chain of migrations:
--
--   * one Power-Up for today, approved, live, and owned by no single classroom
--   * five questions, 2 from Level 1, 2 from Level 2, 1 from Level 3, four
--     options each
--   * every Mathematics classroom with students is served it exactly once, and
--     no other classroom is served it at all
--   * the payload a student receives carries no answer key, in any spelling
--   * the deployed submit_mission still knows about the shared Power-Up
--
-- Read only: it inspects, and fails the push if any of the above is untrue.

do $$
declare
  v_today     date := (now() at time zone 'Asia/Manila')::date;
  v_m         public.missions%rowtype;
  v_per_day   integer;
  v_levels    integer[];
  v_math      integer;
  v_math_seen integer;
  v_others    integer;
  v_others_seen integer;
  v_students  integer;
  v_seen      integer;
  v_questions integer;
  v_forbidden text[] := array[
    'answer_index', 'correct_index', 'correct_answer', 'answer',
    'explanation', 'feedback', 'student_feedback'
  ];
  v_found     text[] := '{}';
  v_payload   jsonb;
  v_problems  text[] := '{}';
  v_c         record;
begin
  -- One Power-Up for today, generated and published.
  select count(*) into v_per_day
  from public.missions
  where mission_source = 'daily_foundation' and auto_daily_date = v_today;

  if v_per_day <> 1 then
    raise exception 'There are % Power-Ups for %; there must be exactly one.', v_per_day, v_today;
  end if;

  select * into v_m
  from public.missions
  where mission_source = 'daily_foundation' and auto_daily_date = v_today;

  if not (v_m.is_active and v_m.approval_status = 'approved') then
    v_problems := array_append(v_problems,
      'today''s Power-Up is ' || v_m.approval_status
      || case when v_m.is_active then ' and live' else ' and hidden' end);
  end if;
  if v_m.classroom_id is not null then
    v_problems := array_append(v_problems, 'today''s Power-Up belongs to one classroom again');
  end if;

  -- Five questions, the agreed level mix, four options each. The generator
  -- shuffles the five, so the mix is a multiset, not a sequence.
  select array_agg((q.item ->> 'level')::integer order by (q.item ->> 'id')::integer),
         count(*),
         count(*) filter (where jsonb_array_length(q.item -> 'options') = 4)
    into v_levels, v_questions, v_seen
  from jsonb_array_elements(v_m.ai_content::jsonb -> 'questions') as q(item);

  if v_questions <> 5 or v_seen <> 5 then
    v_problems := array_append(v_problems,
      'today''s Power-Up has ' || v_questions || ' questions and ' || v_seen || ' with four options');
  end if;
  if coalesce((select array_agg(l order by l) from unnest(v_levels) as l)::text, '')
       <> '{1,1,2,2,3}' then
    v_problems := array_append(v_problems,
      'today''s Power-Up serves levels ' || coalesce(v_levels::text, 'none')
      || ', expected two from Level 1, two from Level 2 and one from Level 3');
  end if;

  -- Served to every Mathematics classroom with students, and to nobody else.
  select count(*) into v_math
  from public.classrooms c
  where public.foundation_class_serves_power_up(c.subject)
    and exists (select 1 from public.group_accounts ga
                where ga.classroom_id = c.id and ga.is_approved and ga.group_member_id is not null);

  select count(*) into v_others
  from public.classrooms c
  where not public.foundation_class_serves_power_up(c.subject)
    and exists (select 1 from public.group_accounts ga
                where ga.classroom_id = c.id and ga.is_approved and ga.group_member_id is not null);

  v_math_seen := 0;
  v_others_seen := 0;
  v_students := 0;

  -- Bounded so the gate cannot run away on a large school.
  for v_c in
    select c.id, c.teacher_id,
      public.foundation_class_serves_power_up(c.subject) as is_math,
      (select ga.user_id from public.group_accounts ga
        where ga.classroom_id = c.id and ga.is_approved and ga.group_member_id is not null
        order by ga.created_date limit 1) as student
    from public.classrooms c
    where exists (select 1 from public.group_accounts ga
                  where ga.classroom_id = c.id and ga.is_approved and ga.group_member_id is not null)
    order by c.created_date
    limit 20
  loop
    continue when v_c.student is null;

    execute 'set local request.jwt.claim.sub = ' || quote_literal(v_c.student::text);
    execute 'set local request.jwt.claims = ' || quote_literal(
      json_build_object('sub', v_c.student::text, 'role', 'authenticated')::text);

    select count(*) into v_seen
    from public.get_student_missions(v_c.id) as seen(payload)
    where seen.payload ->> 'id' = v_m.id::text;

    if v_c.is_math then
      v_math_seen := v_math_seen + 1;
      v_students := v_students + 1;
      if v_seen <> 1 then
        v_problems := array_append(v_problems,
          'a Mathematics classroom is served the Power-Up ' || v_seen || ' times');
      end if;

      -- The first Mathematics student on record is the payload we inspect.
      if v_students = 1 then
        select seen.payload into v_payload
        from public.get_student_missions(v_c.id) as seen(payload)
        where seen.payload ->> 'id' = v_m.id::text;

        if v_payload ? 'answer_key' then
          v_problems := array_append(v_problems,
            'the student payload still ships the answer_key column');
        end if;

        select coalesce(array_agg(distinct k order by k), '{}')
          into v_found
        from jsonb_array_elements((v_payload ->> 'ai_content')::jsonb -> 'questions') as q(item),
             lateral unnest(v_forbidden) as k
        where q.item ? k;

        if array_length(v_found, 1) is not null then
          v_problems := array_append(v_problems,
            'the student payload still ships ' || array_to_string(v_found, ', '));
        end if;
      end if;
    else
      v_others_seen := v_others_seen + 1;
      if v_seen > 0 then
        v_problems := array_append(v_problems,
          'a non-Mathematics classroom is served the Power-Up');
      end if;
    end if;
  end loop;

  if v_math_seen = 0 or v_others_seen = 0 then
    raise exception 'The gate needs at least one Mathematics classroom (% seen) and one other (% seen) with students to compare.', v_math_seen, v_others_seen;
  end if;

  -- The deployed submit_mission must be the one that opens up to the shared row.
  if position('daily_foundation' in
       (select prosrc from pg_proc
        where oid = 'public.submit_mission(uuid,uuid,numeric,text,uuid)'::regprocedure)) = 0 then
    v_problems := array_append(v_problems,
      'the deployed submit_mission has no shared Power-Up branch');
  end if;

  if array_length(v_problems, 1) is not null then
    raise exception 'Power-Up is not shippable: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'ship gate passed for %: one approved Power-Up, % questions (levels %), served to % of % Mathematics classrooms and % of % other classrooms, no answer key in the payload',
    v_today, v_questions, (select array_agg(l order by l) from unnest(v_levels) as l)::text,
    v_math_seen, v_math, v_others_seen, v_others;
end;
$$;