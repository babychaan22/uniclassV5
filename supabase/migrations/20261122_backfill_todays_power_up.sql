-- 20261122 — materialise today's Power-Up and prove a student really sees it.

-- 20261111 stripped answers with jsonb_set(..., '{ai_content}', <jsonb object>),
-- which turned the text column into a JSON object. Every client does
-- JSON.parse(mission.ai_content); the object stringified to "[object Object]",
-- the parse threw, and the mission rendered with zero questions
-- ("This mission has no questions available yet") even though the row was fine.
-- 20261120 re-wraps it with to_jsonb(..::text). MissionAssessment now also
-- tolerates either shape.

-- Generate today's Power-Up for every Mathematics classroom that has an
-- approved student. Done as the students themselves, so the exact code path the
-- app calls is the code path that runs here.
do $$
declare
  v_c       record;
  v_student uuid;
  v_created integer := 0;
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
    select ga.user_id into v_student
    from public.group_accounts ga
    where ga.classroom_id = v_c.id and ga.is_approved
    order by ga.created_date
    limit 1;

    execute 'set local request.jwt.claim.sub = ' || quote_literal(v_student::text);
    execute 'set local request.jwt.claims = ' || quote_literal(
      json_build_object('sub', v_student::text, 'role', 'authenticated')::text);

    begin
      perform public.ensure_daily_power_up_for_student(v_c.id);
      v_created := v_created + 1;
    exception when others then
      raise warning 'classroom % could not generate a Power-Up: %', v_c.id, sqlerrm;
    end;
  end loop;

  raise notice 'ensured today''s Power-Up for % Mathematics classroom(s)', v_created;
end;
$$;

-- ── Verification ──────────────────────────────────────────────────────────
-- Fails the migration if any student-visible mission is still unreadable, so
-- this exact bug can never ship silently again.

do $$
declare
  v_bad jsonb;
begin
  select jsonb_agg(jsonb_build_object('id', x.id, 'reason', x.reason)) into v_bad
  from (
    select m.id, s.j,
      case
        when jsonb_typeof(s.j -> 'ai_content') is distinct from 'string'
          then 'ai_content is ' || coalesce(jsonb_typeof(s.j -> 'ai_content'), 'missing') || ', not a string'
        when btrim(s.j ->> 'ai_content') = ''
          then 'ai_content is empty'
        when jsonb_typeof((s.j ->> 'ai_content')::jsonb -> 'questions') is distinct from 'array'
          then 'ai_content has no questions array'
        when jsonb_array_length((s.j ->> 'ai_content')::jsonb -> 'questions') < 5
          then 'only ' || jsonb_array_length((s.j ->> 'ai_content')::jsonb -> 'questions') || ' questions'
        else null
      end as reason
    from public.missions m
    cross join lateral (select public.sanitize_mission_for_student(m) as j) s
    where m.mission_source = 'daily_foundation'
      and m.is_active
  ) x
  where x.reason is not null;

  if v_bad is not null then
    raise exception 'Power-Up payloads still unreadable: %', v_bad::text;
  end if;

  raise notice 'verified: % active Power-Up(s) parse for students with >= 5 questions each',
    (select count(*) from public.missions
      where mission_source = 'daily_foundation' and is_active);
end;
$$;
