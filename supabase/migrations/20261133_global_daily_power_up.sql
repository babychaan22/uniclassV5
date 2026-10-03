-- 20261133 — one Daily Math Power-Up per day, global to every Mathematics class.
--
-- The engine created one Power-Up row per classroom per day and never pruned
-- them, so after a few days a teacher's mission list held a dozen identical
-- "Daily Math Power-Up" entries, one per class per day, while students saw at
-- most the one approved for their own class. The activity is a single global
-- morning practice, not a per-class assignment, so it gets a single row:
--
--   * classroom_id becomes nullable, and the global Power-Up has none. It
--     belongs to no class; it is delivered to every Mathematics classroom.
--   * The uniqueness guarantee moves from (classroom_id, auto_daily_date) to
--     (auto_daily_date) alone, so two Power-Ups on one day are now impossible
--     rather than merely discouraged.
--   * Students receive it only when it is approved and live, and only if their
--     own classroom is a Mathematics one.
--   * Any teacher who has a Mathematics classroom sees it in their review queue
--     and can approve it for everyone, which is what "approved for all classes"
--     has to mean when there is only one mission.

-- ── A Power-Up may belong to no classroom ────────────────────────────────
alter table public.missions alter column classroom_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'missions_power_up_may_be_global'
  ) then
    alter table public.missions
      add constraint missions_power_up_may_be_global
      check (mission_source = 'daily_foundation' or classroom_id is not null);
  end if;
end;
$$;

-- ── Clear the per-class duplicates ──────────────────────────────────────
-- Every classroom-scoped Power-Up is replaced by the single shared row. This has
-- to happen before the new unique index, which is precisely the constraint the
-- duplicates violate. No student has submitted one, so nothing is lost.

do $$
declare
  v_deleted integer;
  v_stale   integer;
begin
  delete from public.mission_submissions s
  using public.missions m
  where s.mission_id = m.id
    and m.mission_source = 'daily_foundation'
    and m.classroom_id is not null;
  get diagnostics v_stale = row_count;

  delete from public.missions
  where mission_source = 'daily_foundation'
    and classroom_id is not null;
  get diagnostics v_deleted = row_count;

  raise notice 'removed % classroom-scoped Power-Up row(s)', v_deleted;
end;
$$;

-- ── One Power-Up per day, platform-wide ───────────────────────────────────
-- The old index scoped uniqueness to a classroom, which is exactly what allowed
-- seven rows for one morning. Uniqueness on the date alone is the guarantee.
drop index if exists public.idx_missions_one_daily_foundation_per_day;
create unique index if not exists idx_missions_one_daily_foundation_per_day
  on public.missions(auto_daily_date)
  where mission_source = 'daily_foundation' and auto_daily_date is not null;

-- ── Teachers of a Mathematics class may see and review the global row ────
-- Every existing policy keys on classroom_id, which is NULL for the Power-Up,
-- so without these a teacher could not even see what they are meant to approve.

drop policy if exists missions_global_power_up_read on public.missions;
create policy missions_global_power_up_read
  on public.missions
  for select
  to authenticated
  using (
    mission_source = 'daily_foundation'
    and classroom_id is null
    and exists (
      select 1 from public.classrooms c
      where c.teacher_id = auth.uid()
        and public.foundation_class_serves_power_up(c.subject)
    )
  );

drop policy if exists missions_global_power_up_review on public.missions;
create policy missions_global_power_up_review
  on public.missions
  for update
  to authenticated
  using (
    mission_source = 'daily_foundation'
    and classroom_id is null
    and exists (
      select 1 from public.classrooms c
      where c.teacher_id = auth.uid()
        and public.foundation_class_serves_power_up(c.subject)
    )
  )
  with check (
    mission_source = 'daily_foundation'
    and classroom_id is null
  );

-- ── get_student_missions ─────────────────────────────────────────────────
-- The final check required the mission's creator to own the student's
-- classroom, which a shared Power-Up cannot satisfy. It is replaced by an
-- explicit branch for the global row, gated on the student's own classroom
-- being a Mathematics one.

create or replace function public.get_student_missions(p_classroom_id uuid)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.group_accounts
    where user_id = auth.uid() and classroom_id = p_classroom_id and is_approved = true
  ) then raise exception 'Approved student account required'; end if;

  return query
  select public.sanitize_mission_for_student(m)
  from public.missions m
  where (
      m.is_active
      or exists (
        select 1 from public.mission_submissions s
        join public.group_accounts ga on ga.group_id = s.group_id
        where s.mission_id = m.id and ga.user_id = auth.uid()
          and ga.classroom_id = p_classroom_id and ga.is_approved = true
      )
    )
    and (
      m.applies_to_all_classes
      or (cardinality(m.target_classroom_ids) > 0 and p_classroom_id = any(m.target_classroom_ids))
      or (not m.applies_to_all_classes and cardinality(m.target_classroom_ids) = 0 and m.classroom_id = p_classroom_id)
    )
    and (
      -- The shared daily Power-Up: one mission for every Mathematics class.
      (
        m.mission_source = 'daily_foundation'
        and m.classroom_id is null
        and m.approval_status = 'approved'
        and coalesce(
          (select public.foundation_class_serves_power_up(c.subject)
             from public.classrooms c where c.id = p_classroom_id),
          false)
      )
      -- A teacher's own mission still only reaches the classes they teach.
      or exists (
        select 1 from public.classrooms c
        where c.id = p_classroom_id and c.teacher_id = m.created_by
      )
    );
end;
$$;

revoke all on function public.get_student_missions(uuid) from public;
grant execute on function public.get_student_missions(uuid) to authenticated;

-- ── ensure_daily_drill: one global row, generated not published ──────────

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

  -- The caller's own classroom decides whether the activity applies to them.
  -- A Mathematics classroom still gets today's shared Power-Up even if the
  -- caller is a student; anyone else is served nothing.
  if not public.foundation_class_serves_power_up(v_classroom.subject) then
    raise exception 'The Daily Math Power-Up is a Mathematics activity. This classroom is %, so no Power-Up is generated for it.', v_classroom.subject;
  end if;

  -- Yesterday's is closed once the Manila day turns over. The review record is
  -- left alone: an approved Power-Up stays approved in the teacher's history.
  update public.missions
  set is_active = false
  where mission_source = 'daily_foundation'
    and auto_daily_date < v_today
    and is_active;

  -- Today's, if it already exists, returned exactly as it stands. A pending
  -- Power-Up stays pending and a closed one stays closed; the engine does not
  -- override a teacher's decision.
  select * into v_existing
  from public.missions
  where mission_source = 'daily_foundation'
    and auto_daily_date = v_today;

  if found then
    return public.sanitize_mission_for_student(v_existing);
  end if;

  for v_row in
    (
      select * from (
        select fq.*, row_number() over (partition by fq.level order by md5(random()::text || fq.question_id)) as rn
        from public.foundation_questions fq
        where fq.review_status = 'APPROVED'
          and fq.is_active
          and fq.level in (1, 2, 3)
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
      approval_status,
      applies_to_all_classes,
      target_classroom_ids,
      target_statuses
    )
    values (
      -- One row for the whole platform: it belongs to no single classroom.
      null,
      'Daily Math Power-Up',
      'Five quick foundation questions to strengthen your everyday math skills. Complete today''s Power-Up to earn 5 XP.',
      5,
      5,
      v_today,
      v_end,
      -- Generated, not published. A teacher approves it before anyone sees it.
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
      'Mathematics',
      'daily_foundation',
      v_levels,
      v_skills,
      'v1-approved-3100',
      'pending',
      true,
      '{}'::uuid[],
      array['On Track', 'Developing', 'At Risk']
    )
    returning * into v_mission;
  exception
    -- Another classroom generated today's Power-Up first. That row is the one.
    when unique_violation then
      select * into v_existing
      from public.missions
      where mission_source = 'daily_foundation'
        and auto_daily_date = v_today;
      if not found then raise; end if;
      return public.sanitize_mission_for_student(v_existing);
  end;

  return public.sanitize_mission_for_student(v_mission);
end;
$$;

revoke all on function public.ensure_daily_drill(uuid) from public;
grant execute on function public.ensure_daily_drill(uuid) to authenticated;

-- ── Reviewing the shared mission ─────────────────────────────────────────
-- set_mission_approval required a classroom match, which a global row cannot
-- satisfy. Any teacher of a Mathematics classroom may now review the shared
-- Power-Up; a teacher's own mission still requires being its class's teacher.

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
  v_owns    boolean := false;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  if lower(coalesce(btrim(p_status), '')) not in ('pending', 'approved', 'rejected') then
    raise exception 'Unknown approval status "%". Use pending, approved or rejected.', p_status;
  end if;

  select * into v_mission from public.missions where id = p_mission_id;
  if not found then raise exception 'Mission not found.'; end if;

  if v_mission.mission_source = 'daily_foundation' and v_mission.classroom_id is null then
    -- The shared daily Power-Up: reviewable by any Mathematics teacher.
    v_owns := exists (
      select 1 from public.classrooms c
      where c.teacher_id = v_user
        and public.foundation_class_serves_power_up(c.subject)
    );
  else
    select c.teacher_id into v_teacher
    from public.classrooms c
    where c.id = v_mission.classroom_id
      and (p_classroom_id is null or c.id = p_classroom_id);
    if not found then raise exception 'Classroom not found.'; end if;
    v_owns := (v_user = v_teacher or auth_is_teacher_of(v_mission.classroom_id));
  end if;

  if not v_owns then
    raise exception 'Only a teacher of this class can review a mission.';
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

-- ── Publish today's Power-Up ─────────────────────────────────────────────
-- There is now only ever one mission to publish, so this approves the shared
-- mission and reports what it did. Kept under its original name because the
-- teacher page calls it.

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
  v_row   public.missions%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  if not exists (
    select 1 from public.classrooms c
    where c.teacher_id = v_user and public.foundation_class_serves_power_up(c.subject)
  ) then
    raise exception 'Only a teacher of a Mathematics class can approve the Daily Math Power-Up.';
  end if;

  update public.missions m
  set approval_status = 'approved',
      is_active = true,
      reviewed_by = v_user,
      reviewed_at = now()
  where m.mission_source = 'daily_foundation'
    and m.auto_daily_date = v_today
    and m.approval_status <> 'approved'
  returning * into v_row;

  if not found then
    return jsonb_build_object(
      'approved', 0,
      'date', v_today,
      'message', 'The Power-Up for ' || v_today || ' is already approved.'
    );
  end if;

  return jsonb_build_object(
    'approved', 1,
    'date', v_today,
    'message', 'Published the Power-Up for ' || v_today
      || ' to every Mathematics class.'
  );
end;
$$;

revoke all on function public.approve_power_up_for_all_classes(date) from public;
grant execute on function public.approve_power_up_for_all_classes(date) to authenticated;

-- ── Populate the teacher's review queue ──────────────────────────────────
-- One call prepares the single shared Power-Up, so it is waiting for review
-- before class without anyone having to open the page first.

create or replace function public.generate_pending_power_ups()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_cid   uuid;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select c.id into v_cid
  from public.classrooms c
  where c.teacher_id = v_user and public.foundation_class_serves_power_up(c.subject)
  order by c.created_date
  limit 1;

  if v_cid is null then
    return jsonb_build_object('prepared', false,
      'message', 'The Daily Math Power-Up is a Mathematics activity.');
  end if;

  -- The engine generates it as pending. This never publishes.
  perform public.ensure_daily_power_up_for_student(v_cid);

  return jsonb_build_object(
    'prepared', true,
    'date', v_today,
    'message', 'Power-Up ready to review for ' || v_today || '.'
  );
end;
$$;

revoke all on function public.generate_pending_power_ups() from public;
grant execute on function public.generate_pending_power_ups() to authenticated;

-- update_mission has to accept a mission with no classroom, since the shared
-- Power-Up is editable exactly like any other.
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

  if not (
    (v_mission.mission_source = 'daily_foundation'
      and v_mission.classroom_id is null
      and exists (
        select 1 from public.classrooms c
        where c.teacher_id = v_user and public.foundation_class_serves_power_up(c.subject)
      ))
    or auth_is_teacher_of(v_mission.classroom_id)
  ) then
    raise exception 'Only a teacher of this class can edit a mission.';
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

-- ── Verification ─────────────────────────────────────────────────────────
-- One mission per day, invisible until approved, delivered to every Mathematics
-- class and no other.

do $$
declare
  v_today    date := (now() at time zone 'Asia/Manila')::date;
  v_math     record;
  v_nonmath  record;
  v_student  uuid;
  v_teacher  uuid;
  v_mid      uuid;
  v_row      public.missions%rowtype;
  v_seen     integer;
  v_questions integer;
  v_per_day  integer;
  v_problems text[] := '{}';
begin
  -- A Mathematics classroom with students, and a non-Mathematics one to prove
  -- the shared mission does not leak outside Mathematics.
  select c.id, c.teacher_id into v_math
  from public.classrooms c
  where public.foundation_class_serves_power_up(c.subject)
    and exists (select 1 from public.group_accounts ga
                where ga.classroom_id = c.id and ga.is_approved)
  order by c.created_date limit 1;

  select c.id into v_nonmath
  from public.classrooms c
  where not public.foundation_class_serves_power_up(c.subject)
    and exists (select 1 from public.group_accounts ga
                where ga.classroom_id = c.id and ga.is_approved)
  order by c.created_date limit 1;

  if v_math.id is null then raise exception 'No Mathematics classroom with students to verify against.'; end if;

  select ga.user_id into v_student
  from public.group_accounts ga
  where ga.classroom_id = v_math.id and ga.is_approved
  order by ga.created_date limit 1;

  -- Any Mathematics teacher's page generates it once, for everyone.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_math.teacher_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_math.teacher_id::text, 'role', 'authenticated')::text);
  perform public.generate_pending_power_ups();

  -- Calling it from a second Mathematics classroom must not add a second row.
  if exists (
    select 1 from public.classrooms c
    where public.foundation_class_serves_power_up(c.subject)
      and exists (select 1 from public.group_accounts ga
                  where ga.classroom_id = c.id and ga.is_approved)
      and c.id <> v_math.id
  ) then
    declare
      v_other_cid  uuid;
      v_other_teacher uuid;
      v_other_student uuid;
    begin
      select c.id, c.teacher_id into v_other_cid, v_other_teacher
      from public.classrooms c
      where public.foundation_class_serves_power_up(c.subject)
        and exists (select 1 from public.group_accounts ga
                    where ga.classroom_id = c.id and ga.is_approved)
        and c.id <> v_math.id
      order by c.created_date limit 1;

      execute 'set local request.jwt.claim.sub = ' || quote_literal(v_other_teacher::text);
      execute 'set local request.jwt.claims = ' || quote_literal(
        json_build_object('sub', v_other_teacher::text, 'role', 'authenticated')::text);
      perform public.generate_pending_power_ups();

      select count(*) into v_per_day
      from public.missions
      where mission_source = 'daily_foundation' and auto_daily_date = v_today;

      if v_per_day <> 1 then
        v_problems := array_append(v_problems,
          'a second classroom produced ' || v_per_day || ' Power-Ups for one day');
      end if;
    end;
  end if;

  select m.* into v_row
  from public.missions m
  where m.mission_source = 'daily_foundation' and m.auto_daily_date = v_today;

  if not found then
    raise exception 'No Power-Up was generated for today.';
  end if;
  v_mid := v_row.id;

  if v_row.classroom_id is not null then
    v_problems := array_append(v_problems, 'the Power-Up is still tied to one classroom');
  end if;
  if v_row.approval_status <> 'pending' or v_row.is_active then
    v_problems := array_append(v_problems, 'the Power-Up was generated already published');
  end if;

  -- Hidden from a Mathematics student until it is approved.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_student::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_student::text, 'role', 'authenticated')::text);

  select count(*) into v_seen
  from public.get_student_missions(v_math.id) as seen(payload)
  where seen.payload ->> 'id' = v_mid::text;

  if v_seen > 0 then
    v_problems := array_append(v_problems, 'an unapproved Power-Up is visible to a student');
  end if;

  -- A non-Mathematics student must never receive it, even once approved.
  if v_nonmath.id is not null then
    declare v_ns uuid;
    begin
      select ga.user_id into v_ns from public.group_accounts ga
      where ga.classroom_id = v_nonmath.id and ga.is_approved
      order by ga.created_date limit 1;

      execute 'set local request.jwt.claim.sub = ' || quote_literal(v_ns::text);
      execute 'set local request.jwt.claims = ' || quote_literal(
        json_build_object('sub', v_ns::text, 'role', 'authenticated')::text);

      select count(*) into v_seen
      from public.get_student_missions(v_nonmath.id) as seen(payload)
      where seen.payload ->> 'id' = v_mid::text;

      if v_seen > 0 then
        v_problems := array_append(v_problems,
          'the Power-Up leaked into a non-Mathematics classroom');
      end if;
    end;
  end if;

  -- A Mathematics teacher approves it, and every Mathematics class gets it.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_math.teacher_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_math.teacher_id::text, 'role', 'authenticated')::text);
  perform public.set_mission_approval(v_mid, 'approved');

  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_student::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_student::text, 'role', 'authenticated')::text);

  select count(*) into v_seen
  from public.get_student_missions(v_math.id) as seen(payload)
  where seen.payload ->> 'id' = v_mid::text;

  select min(jsonb_array_length((seen.payload ->> 'ai_content')::jsonb -> 'questions'))
    into v_questions
  from public.get_student_missions(v_math.id) as seen(payload)
  where seen.payload ->> 'id' = v_mid::text;

  if v_seen <> 1 or coalesce(v_questions, 0) < 5 then
    v_problems := array_append(v_problems,
      'the approved Power-Up did not render 5 questions for the student');
  end if;

  -- Still exactly one row for the day.
  select count(*) into v_per_day
  from public.missions
  where mission_source = 'daily_foundation' and auto_daily_date = v_today;

  if v_per_day <> 1 then
    v_problems := array_append(v_problems,
      'there are ' || v_per_day || ' Power-Ups for ' || v_today);
  end if;

  if array_length(v_problems, 1) is not null then
    raise exception 'Global Power-Up broken: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'verified: exactly one Power-Up for %, generated pending, delivered only to Mathematics classes after approval',
    v_today;
end;
$$;