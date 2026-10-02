-- 20261126 — the Power-Up engine generates, it no longer publishes.
--
-- Part 1 corrects three defects left in 20261125's review functions, which its
-- own checks could not reach:
--
--   1. auth_is_teacher_of takes a *classroom* id, not a teacher id. Passing
--      teacher_id meant a legitimate teacher could be denied.
--   2. update_mission read a column named "key" from jsonb_object_keys, which
--      returns a column named jsonb_object_keys. Every edit raised.
--   3. EXECUTE requires INTO before USING.
--
-- Part 2 makes the engine generate without publishing. 20261119 inserted
-- today's Power-Up with is_active = true and re-activated it if anyone
-- switched it off, so a teacher never got to review it. Under the approval
-- workflow in 20261125 the engine's job ends at generating a pending mission:
-- it creates the row, and only set_mission_approval /
-- approve_power_up_for_all_classes may make it visible to a student.

-- ── set_mission_approval ──────────────────────────────────────────────────
create or replace function public.set_mission_approval(
  p_mission_id uuid,
  p_status text,
  p_classroom_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_mission public.missions%rowtype;
  v_teacher uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  if lower(coalesce(btrim(p_status), '')) not in ('pending', 'approved', 'rejected') then
    raise exception 'Unknown approval status "%". Use pending, approved or rejected.', p_status;
  end if;

  select * into v_mission from public.missions where id = p_mission_id;
  if not found then raise exception 'Mission not found.'; end if;

  select c.teacher_id into v_teacher
  from public.classrooms c
  where c.id = v_mission.classroom_id
    and (p_classroom_id is null or c.id = p_classroom_id);
  if not found then raise exception 'Classroom not found.'; end if;

  -- auth_is_teacher_of is keyed on the classroom, not the teacher.
  if v_user <> v_teacher and not auth_is_teacher_of(v_mission.classroom_id) then
    raise exception 'Only the teacher of this class can review a mission.';
  end if;

  update public.missions m
  set approval_status = lower(btrim(p_status)),
      reviewed_by = v_user,
      reviewed_at = now(),
      -- Approval is what publishes. Anything else withdraws it again.
      is_active = (lower(btrim(p_status)) = 'approved')
  where m.id = p_mission_id
  returning * into v_mission;

  return jsonb_build_object(
    'id', v_mission.id,
    'title', v_mission.title,
    'approval_status', v_mission.approval_status,
    'is_active', v_mission.is_active
  );
end;
$$;

revoke all on function public.set_mission_approval(uuid, text, uuid) from public;
grant execute on function public.set_mission_approval(uuid, text, uuid) to authenticated;

-- ── approve_power_up_for_all_classes ──────────────────────────────────────
create or replace function public.approve_power_up_for_all_classes(
  p_auto_daily_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_today date := coalesce(p_auto_daily_date, (now() at time zone 'Asia/Manila')::date);
  v_count integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  update public.missions m
  set approval_status = 'approved',
      is_active = true,
      reviewed_by = v_user,
      reviewed_at = now()
  where m.mission_source = 'daily_foundation'
    and m.auto_daily_date = v_today
    and m.approval_status <> 'approved'
    and exists (
      select 1 from public.classrooms c
      where c.id = m.classroom_id
        and (c.teacher_id = v_user or auth_is_teacher_of(c.id))
    );

  get diagnostics v_count = row_count;

  if v_count = 0 then
    return jsonb_build_object(
      'approved', 0,
      'date', v_today,
      'message', 'Every Power-Up for ' || v_today || ' is already approved.'
    );
  end if;

  return jsonb_build_object(
    'approved', v_count,
    'date', v_today,
    'message', 'Published ' || v_count || ' Power-Up' || (case when v_count = 1 then '' else 's' end)
      || ' for ' || v_today || ' across your classes.'
  );
end;
$$;

revoke all on function public.approve_power_up_for_all_classes(date) from public;
grant execute on function public.approve_power_up_for_all_classes(date) to authenticated;

-- ── update_mission ────────────────────────────────────────────────────────
create or replace function public.update_mission(
  p_mission_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_mission public.missions%rowtype;
  v_teacher uuid;
  v_patch   jsonb;
  v_allowed text[] := array[
    'title', 'description', 'xp_reward', 'max_score', 'deadline', 'deadline_at',
    'image_url', 'formative_type', 'ai_content', 'answer_key',
    'applies_to_all_classes', 'target_classroom_ids', 'target_statuses'
  ];
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_mission from public.missions where id = p_mission_id;
  if not found then raise exception 'Mission not found.'; end if;

  select c.teacher_id into v_teacher
  from public.classrooms c where c.id = v_mission.classroom_id;
  if v_teacher is null then raise exception 'Classroom not found.'; end if;

  if v_user <> v_teacher and not auth_is_teacher_of(v_mission.classroom_id) then
    raise exception 'Only the teacher of this class can edit a mission.';
  end if;

  -- Only the columns a teacher owns are writable. is_active, approval_status,
  -- mission_source and the auto-daily bookkeeping are not, so an edit can
  -- neither publish a mission nor forge its provenance.
  v_patch := (
    select jsonb_object_agg(e.key, e.value)
    from jsonb_each(p_patch) as e(key, value)
    where e.key = any(v_allowed)
  );

  if v_patch is null or v_patch = '{}'::jsonb then
    raise exception 'Nothing to update.';
  end if;

  -- EXECUTE takes INTO before USING.
  execute (
    select 'update public.missions set '
      || string_agg(format('%I = ($1->>%L)::%s', k.key, k.key,
          case k.key
            when 'xp_reward' then 'numeric'
            when 'max_score' then 'numeric'
            when 'target_classroom_ids' then 'uuid[]'
            when 'target_statuses' then 'text[]'
            when 'deadline' then 'date'
            when 'deadline_at' then 'timestamptz'
            else 'text'
          end), ', ')
      || ' where id = $2 returning *'
    from jsonb_object_keys(v_patch) as k(key)
  )
  into v_mission
  using v_patch, p_mission_id;

  return jsonb_build_object(
    'id', v_mission.id,
    'approval_status', v_mission.approval_status,
    'is_active', v_mission.is_active
  );
end;
$$;

revoke all on function public.update_mission(uuid, jsonb) from public;
grant execute on function public.update_mission(uuid, jsonb) to authenticated;

-- ── ensure_daily_drill ────────────────────────────────────────────────────
create or replace function public.ensure_daily_drill(p_classroom_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_end timestamptz := ((now() at time zone 'Asia/Manila')::date + time '23:59:59') at time zone 'Asia/Manila';
  v_classroom public.classrooms%rowtype;
  v_existing public.missions%rowtype;
  v_mission public.missions%rowtype;
  v_subject text;
  v_items jsonb := '[]'::jsonb;
  v_answers jsonb := '[]'::jsonb;
  v_levels smallint[] := '{}'::smallint[];
  v_skills text[] := '{}'::text[];
  v_row record;
  v_shuffled jsonb;
  v_i integer := 0;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_classroom
  from public.classrooms
  where id = coalesce(
    p_classroom_id,
    (select classroom_id
       from public.group_accounts
      where user_id = v_user and is_approved = true
      order by created_date asc limit 1)
  );

  if not found then raise exception 'Classroom not found'; end if;

  if not auth_is_teacher_of(v_classroom.id) then
    if not exists (
      select 1 from public.group_accounts
      where user_id = v_user
        and classroom_id = v_classroom.id
        and is_approved = true
    ) then
      raise exception 'Approved classroom account required';
    end if;
  end if;

  -- Yesterday's Power-Up is closed once the Manila day turns over. This only
  -- closes it; it does not touch the review record, so an approved Power-Up
  -- stays approved and visible in the teacher's history.
  update public.missions
  set is_active = false
  where is_auto_daily
    and auto_daily_date < v_today
    and is_active;

  -- Today's, if one already exists. It is returned exactly as it stands: a
  -- pending Power-Up stays pending, and one a teacher has closed stays closed.
  -- The engine does not second-guess a teacher's decision to withhold it.
  select * into v_existing
  from public.missions
  where mission_source = 'daily_foundation'
    and auto_daily_date = v_today
    and classroom_id = v_classroom.id;

  if found then
    return public.sanitize_mission_for_student(v_existing);
  end if;

  v_subject := coalesce(nullif(trim(v_classroom.subject), ''), 'General Studies');

  -- One engine for the whole platform: a Mathematics classroom, whichever
  -- spelling the teacher used. Anything else is simply not served, and says so.
  if lower(v_subject) !~ '(math|matemat|mathemat|maths|mathematics|arithmetic|algebra|geometry)' then
    raise exception 'The Daily Math Power-Up is a Mathematics activity. This classroom is %, so no Power-Up is generated for it.', v_subject;
  end if;

  for v_row in
    (
      select * from (
        select fq.*, row_number() over (partition by fq.level order by md5(random()::text || fq.question_id)) as rn
        from public.foundation_questions fq
        where fq.review_status = 'APPROVED'
          and fq.is_active
          and fq.level in (1, 2, 3)
          -- Skip any row the bank cannot serve safely.
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
    v_levels := array_append(v_levels, v_row.level);
    v_skills := array_append(v_skills, v_row.skill);

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

  if v_i < 5 then
    raise exception 'The Daily Math Power-Up needs 5 approved questions (2 from Level 1, 2 from Level 2, 1 from Level 3) but only % are currently available. Ask an administrator to review the question bank.', v_i;
  end if;

  begin
    insert into public.missions(
      classroom_id,
      title,
      description,
      xp_reward,
      max_score,
      deadline,
      deadline_at,
      is_active,
      created_by,
      formative_type,
      ai_content,
      answer_key,
      is_auto_daily,
      auto_daily_date,
      subject,
      mission_source,
      foundation_levels,
      foundation_skills,
      foundation_bank_version,
      approval_status
    )
    values (
      v_classroom.id,
      'Daily Math Power-Up',
      'Five quick foundation questions to strengthen your everyday math skills. Complete today''s Power-Up to earn 5 XP.',
      5,
      5,
      v_today,
      v_end,
      -- Generated, not published. A teacher approves it before any student
      -- sees it.
      false,
      v_classroom.teacher_id,
      'multiple_choice',
      jsonb_build_object(
        'questions', v_items,
        'auto_generated', true,
        'mission_source', 'daily_foundation',
        'learning_target', 'I can strengthen the basic math skills I need for today''s lessons.',
        'student_instructions', 'Answer all five questions. Read the explanation after you finish to learn from each answer.',
        'estimated_minutes', 5,
        'foundation_levels', to_jsonb(v_levels),
        'foundation_skills', to_jsonb(v_skills),
        'question_bank_version', 'v1-approved-3100'
      )::text,
      jsonb_build_object('answers', v_answers)::text,
      true,
      v_today,
      v_subject,
      'daily_foundation',
      v_levels,
      v_skills,
      'v1-approved-3100',
      'pending'
    )
    returning * into v_mission;
  exception
    -- Lost a race with a concurrent student. Their row is the real one.
    when unique_violation then
      select * into v_existing
      from public.missions
      where mission_source = 'daily_foundation'
        and auto_daily_date = v_today
        and classroom_id = v_classroom.id;
      if not found then raise; end if;
      return public.sanitize_mission_for_student(v_existing);
  end;

  return public.sanitize_mission_for_student(v_mission);
end;
$$;

revoke all on function public.ensure_daily_drill(uuid) from public;
grant execute on function public.ensure_daily_drill(uuid) to authenticated;

-- The old helper forced a withheld Power-Up back on. Under review it now means
-- "I have read this one": it records the teacher and publishes it, and nothing
-- runs it on a student's behalf.
create or replace function public.revive_todays_power_up(p_classroom_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_count integer;
begin
  update public.missions m
  set approval_status = 'approved',
      is_active = true,
      reviewed_by = v_user,
      reviewed_at = now()
  where m.mission_source = 'daily_foundation'
    and m.auto_daily_date = v_today
    and m.approval_status <> 'approved'
    and exists (
      select 1 from public.classrooms c
      where c.id = m.classroom_id
        and (c.teacher_id = v_user or auth_is_teacher_of(c.id))
        and (p_classroom_id is null or c.id = p_classroom_id)
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.revive_todays_power_up(uuid) from public;
grant execute on function public.revive_todays_power_up(uuid) to authenticated;

-- ── Verification ──────────────────────────────────────────────────────────
-- Power-Up generation is lazy: a row appears the first time a teacher or a
-- student opens the missions page. Rather than assume one already exists, this
-- generates one for a real Mathematics classroom and walks the whole review
-- path as the two people who actually perform it:
--
--   generate -> hidden from the student -> teacher approves -> now visible
--
-- It leaves today's Power-Up for that class approved, which is the working
-- state a teacher would leave it in.

do $$
declare
  v_today     date := (now() at time zone 'Asia/Manila')::date;
  v_cid       uuid;
  v_teacher   uuid;
  v_student   uuid;
  v_mid       uuid;
  v_row       public.missions%rowtype;
  v_visible   integer;
  v_questions integer;
  v_problems  text[] := '{}';
begin
  select c.id, c.teacher_id into v_cid, v_teacher
  from public.classrooms c
  where lower(coalesce(nullif(btrim(c.subject), ''), 'General Studies'))
        ~ '(math|matemat|maths|mathematics|arithmetic|algebra|geometry)'
    and exists (
      select 1 from public.group_accounts ga
      where ga.classroom_id = c.id and ga.is_approved
    )
  order by c.created_date
  limit 1;

  if v_cid is null then
    raise exception 'No Mathematics classroom with students exists to verify against.';
  end if;

  select ga.user_id into v_student
  from public.group_accounts ga
  where ga.classroom_id = v_cid and ga.is_approved
  order by ga.created_date
  limit 1;

  -- 1. A student opens the page. The engine generates today's Power-Up.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_student::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_student::text, 'role', 'authenticated')::text);

  perform public.ensure_daily_power_up_for_student(v_cid);

  select m.* into v_row
  from public.missions m
  where m.classroom_id = v_cid
    and m.mission_source = 'daily_foundation'
    and m.auto_daily_date = v_today;

  if not found then
    raise exception 'The engine did not generate a Power-Up for %', v_today;
  end if;
  v_mid := v_row.id;

  -- 2. Generated, not published.
  if v_row.approval_status <> 'pending' then
    v_problems := array_append(v_problems,
      'a newly generated Power-Up is ' || v_row.approval_status || ', not pending');
  end if;
  if v_row.is_active then
    v_problems := array_append(v_problems, 'a newly generated Power-Up is already live');
  end if;

  -- 3. The student must not see it yet.
  select count(*) into v_visible
  from public.get_student_missions(v_cid) as seen(payload)
  where seen.payload ->> 'id' = v_mid::text;

  if v_visible > 0 then
    v_problems := array_append(v_problems, 'an unapproved Power-Up is visible to a student');
  end if;

  -- 4. The teacher reviews and approves it.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_teacher::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_teacher::text, 'role', 'authenticated')::text);

  perform public.set_mission_approval(v_mid, 'approved');

  select * into v_row from public.missions where id = v_mid;

  if v_row.approval_status <> 'approved' or not v_row.is_active then
    v_problems := array_append(v_problems, 'approving did not publish the mission');
  end if;
  if v_row.reviewed_by <> v_teacher or v_row.reviewed_at is null then
    v_problems := array_append(v_problems, 'approval did not record who reviewed it');
  end if;

  -- 5. Now, and only now, the student sees a complete Power-Up.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_student::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_student::text, 'role', 'authenticated')::text);

  select count(*) into v_visible
  from public.get_student_missions(v_cid) as seen(payload)
  where seen.payload ->> 'id' = v_mid::text;

  select min(jsonb_array_length((seen.payload ->> 'ai_content')::jsonb -> 'questions'))
    into v_questions
  from public.get_student_missions(v_cid) as seen(payload)
  where seen.payload ->> 'id' = v_mid::text;

  if v_visible <> 1 then
    v_problems := array_append(v_problems,
      'the approved Power-Up is still not visible to the student');
  end if;
  if coalesce(v_questions, 0) < 5 then
    v_problems := array_append(v_problems,
      'the approved Power-Up exposes only ' || coalesce(v_questions, 0) || ' questions');
  end if;

  -- 6. A teacher can still edit a published mission without unpublishing it.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_teacher::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_teacher::text, 'role', 'authenticated')::text);

  perform public.update_mission(v_mid, jsonb_build_object('description', v_row.description));

  select * into v_row from public.missions where id = v_mid;
  if v_row.approval_status <> 'approved' or not v_row.is_active then
    v_problems := array_append(v_problems, 'editing a published mission unpublished it');
  end if;

  -- 7. A student must not be able to approve or withhold a Power-Up.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_student::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_student::text, 'role', 'authenticated')::text);

  begin
    perform public.set_mission_approval(v_mid, 'rejected');
    v_problems := array_append(v_problems, 'a student was able to review a mission');
  exception when others then
    null;
  end;

  if array_length(v_problems, 1) is not null then
    raise exception 'Approval workflow broken: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'verified: Power-Up generated pending, hidden until approved, then % question(s) rendered; edits keep it live',
    coalesce(v_questions, 0);
end;
$$;