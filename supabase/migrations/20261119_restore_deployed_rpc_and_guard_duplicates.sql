-- Restores availability for the deployed frontend, and hardens one-per-day.
--
-- Two student-reported symptoms, one shared cause:
--
--  1. "No available questions / not rendered." 20261114 renamed the student
--     entry point to ensure_daily_power_up_for_student and dropped
--     ensure_daily_drill_for_student. The already-deployed bundle still calls
--     the old name, so the RPC raises "function does not exist", the client
--     swallows it, and no Power-Up is materialised or rendered. The new name is
--     kept as the canonical entry point and the old name returns as an alias.
--
--  2. "More than one Power-Up per day." The old client had no filter excluding
--     daily rows, so it listed every Power-Up a student had ever been sent in
--     Active Missions alongside the dedicated section. The database was never
--     at fault: exactly one row per classroom per day exists. The fix here is
--     the concurrency guard that keeps it true, plus the index that makes a
--     duplicate impossible.
--
-- The bank is not the problem: 1,200 / 900 / 1,000 APPROVED active questions at
-- Levels 1-3, all with four valid options and an aligned answer index.

-- ── 1. The old entry point, restored as an alias ──────────────────────────
-- Kept so a deployed client that predates the rename keeps working. It does
-- exactly what the new name does, and stays security-definer with the same
-- approval gate, so it grants no new access.

create or replace function public.ensure_daily_drill_for_student(p_classroom_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return ensure_daily_power_up_for_student(p_classroom_id);
end;
$$;

revoke all on function public.ensure_daily_drill_for_student(uuid) from public;
grant execute on function public.ensure_daily_drill_for_student(uuid) to authenticated;

-- ── 2. One Power-Up per classroom per day, guaranteed ────────────────────
-- Concurrent students loading the page at the same time could both observe no
-- row for today and both try to insert. A unique index turns that race into a
-- loser that falls back to reading the winner's row, instead of a duplicate or
-- a raw constraint error the client would swallow.

drop index if exists public.idx_missions_one_daily_foundation_per_day;
create unique index if not exists idx_missions_one_daily_foundation_per_day
  on public.missions(classroom_id, auto_daily_date)
  where mission_source = 'daily_foundation' and auto_daily_date is not null;

-- A Power-Up deactivated by hand today comes back while the Manila day is
-- still open. Yesterday's stays retired, so history is preserved.
create or replace function public.revive_todays_power_up(p_classroom_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_count integer;
begin
  update public.missions m
  set is_active = true
  where m.mission_source = 'daily_foundation'
    and m.auto_daily_date = v_today
    and not m.is_active
    and (p_classroom_id is null or m.classroom_id = p_classroom_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.revive_todays_power_up(uuid) from public;
grant execute on function public.revive_todays_power_up(uuid) to authenticated;

-- The engine now tolerates a lost insert race instead of failing the call.
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

  -- Yesterday's Power-Up is done with once the Manila day has turned over.
  update public.missions
  set is_active = false
  where is_auto_daily
    and auto_daily_date < v_today
    and is_active;

  -- Today's, if one already exists. A row deactivated by hand earlier today is
  -- still today's Power-Up, so it is restored rather than treated as missing.
  select * into v_existing
  from public.missions
  where mission_source = 'daily_foundation'
    and auto_daily_date = v_today
    and classroom_id = v_classroom.id;

  if found then
    if not v_existing.is_active then
      update public.missions set is_active = true where id = v_existing.id
      returning * into v_existing;
    end if;
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
      foundation_bank_version
    )
    values (
      v_classroom.id,
      'Daily Math Power-Up',
      'Five quick foundation questions to strengthen your everyday math skills. Complete today''s Power-Up to earn 5 XP.',
      5,
      5,
      v_today,
      v_end,
      true,
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
      'v1-approved-3100'
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

-- Retire any duplicate a pre-fix race already left behind, keeping the oldest so
-- a submission can never be orphaned from the row it points at.
do $$
declare
  v_duplicates integer;
begin
  with ranked as (
    select id, row_number() over (partition by classroom_id, auto_daily_date order by created_date, id) as rn
    from public.missions
    where mission_source = 'daily_foundation' and auto_daily_date is not null
  )
  update public.missions m
  set is_active = false
  from ranked r
  where m.id = r.id and r.rn > 1;

  get diagnostics v_duplicates = row_count;
  raise notice 'deactivated % duplicate Power-Up row(s) left by a pre-fix race', v_duplicates;
end;
$$;

-- ── Verification ─────────────────────────────────────────────────────────

do $$
declare
  v_problems text[] := '{}';
  v_count integer;
  v_bank integer;
begin
  -- The deployed client's RPC must exist, be executable, and be an alias that
  -- resolves to the same sanitised payload.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ensure_daily_drill_for_student'
  ) then
    v_problems := array_append(v_problems, 'the deployed client''s RPC is still missing');
  elsif not exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'ensure_daily_drill_for_student' and grantee = 'authenticated'
  ) then
    v_problems := array_append(v_problems, 'students cannot call the restored RPC');
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ensure_daily_drill_for_student'
      and pg_get_functiondef(p.oid) not like '%ensure_daily_power_up_for_student%'
  ) then
    v_problems := array_append(v_problems, 'the old RPC is no longer an alias of the new one');
  end if;

  -- One row per classroom per day, and that is now enforced by an index.
  select count(*) into v_count from (
    select classroom_id, auto_daily_date
    from public.missions
    where mission_source = 'daily_foundation' and auto_daily_date is not null
    group by classroom_id, auto_daily_date
    having count(*) > 1
  ) d;
  if v_count > 0 then
    v_problems := array_append(v_problems, v_count || ' classroom/day pair(s) still have more than one Power-Up');
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'missions'
      and indexdef like '%UNIQUE%' and indexdef like '%auto_daily_date%'
  ) then
    v_problems := array_append(v_problems, 'the one-per-day unique index is missing');
  end if;

  -- The engine must still refuse duplicates at the database level.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ensure_daily_drill'
      and pg_get_functiondef(p.oid) not like '%unique_violation%'
  ) then
    v_problems := array_append(v_problems, 'the engine does not handle a lost insert race');
  end if;

  -- The bank must still be able to fill a mission, so "no available questions"
  -- can only ever mean a genuine shortage now.
  select count(*) into v_bank
  from public.foundation_questions fq
  where fq.review_status = 'APPROVED' and fq.is_active and fq.level in (1, 2, 3)
    and jsonb_array_length(fq.options) = 4 and fq.correct_index between 0 and 3
    and fq.options ->> fq.correct_index = fq.correct_answer
    and btrim(coalesce(fq.answer_explanation, '')) <> '';
  if v_bank < 5 then
    v_problems := array_append(v_problems, 'only ' || v_bank || ' usable questions remain in the bank');
  end if;

  -- Sanitisation must survive the rewrite.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ensure_daily_drill'
      and pg_get_functiondef(p.oid) not like '%sanitize_mission_for_student%'
  ) then
    v_problems := array_append(v_problems, 'the engine no longer sanitises its response');
  end if;

  if array_length(v_problems, 1) is not null then
    raise exception 'Power-Up fix incomplete: %', array_to_string(v_problems, '; ');
  end if;

  raise notice 'verified: deployed RPC restored, one Power-Up per classroom per day enforced, % usable questions in the bank', v_bank;
end;
$$;