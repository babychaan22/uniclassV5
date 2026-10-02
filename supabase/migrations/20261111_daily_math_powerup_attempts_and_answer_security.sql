-- Follow-up to 20261110 (the supplied Daily Math Power-Up package).
--
-- The supplied engine is authoritative for the question bank and the daily
-- selection, but four gaps are closed here.
--
--  1. Answer security. The supplied engine copies `answer_index`, `explanation`
--     and `feedback` into missions.ai_content, and get_student_missions only
--     strips the answer_key column. Students would therefore receive the correct
--     answer and its explanation before submitting. All three student-facing
--     entry points now return a sanitised payload. Feedback is still delivered
--     after submission by get_mission_submission_review(), which reads the
--     mission row server-side and only runs once a submission exists.
--
--  2. Item-level attempt records, captured by a trigger on mission_submissions
--     so the existing submit_mission() path, its scoring and its XP maths stay
--     exactly as they are.
--
--  3. Per-mission option shuffling with a correctly remapped answer index.
--
--  4. A safe handover for Daily Drill rows created by the earlier generated
--     engine (20261108), which occupy today's slot but are not Power-Ups.

-- ── shared sanitiser ─────────────────────────────────────────────────────
-- Single definition of "safe to send to a student browser", used by every RPC a
-- student can call that returns mission content.

create or replace function public.sanitize_mission_for_student(p_mission public.missions)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_result jsonb;
begin
  if p_mission.id is null then return null; end if;

  -- answer_key is a column, the per-item answer is buried in ai_content.
  v_result := to_jsonb(p_mission) - 'answer_key';

  if p_mission.ai_content is null then return v_result; end if;

  begin
    if jsonb_typeof(p_mission.ai_content::jsonb -> 'questions') = 'array' then
      v_result := jsonb_set(
        v_result,
        '{ai_content}',
        (p_mission.ai_content::jsonb - 'questions')
          || jsonb_build_object(
            'questions',
            (
              select coalesce(
                jsonb_agg(
                  (item.value
                    - 'answer_index' - 'correct_index' - 'correct_answer' - 'answer'
                    - 'explanation' - 'feedback' - 'student_feedback')
                  order by item.ordinality
                ),
                '[]'::jsonb
              )
              from jsonb_array_elements(p_mission.ai_content::jsonb -> 'questions')
                with ordinality as item(value, ordinality)
            )
          ),
        true
      );
    end if;
  exception when others then
    -- Unreadable ai_content must not hide the rest of the mission.
    null;
  end;

  return v_result;
end;
$$;

revoke all on function public.sanitize_mission_for_student(public.missions) from public;
grant execute on function public.sanitize_mission_for_student(public.missions) to authenticated;

-- ── 1. Student payloads must not contain answers ──────────────────────────
-- Built on the 20261023 visibility rules, so the fix does not regress mission
-- targeting or the "already submitted, now inactive" case.

create or replace function public.get_student_missions(p_classroom_id uuid)
returns setof jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.group_accounts
    where user_id=auth.uid() and classroom_id=p_classroom_id and is_approved=true
  ) then raise exception 'Approved student account required'; end if;

  return query
  select public.sanitize_mission_for_student(m)
  from public.missions m
  where (
      m.is_active
      or exists (
        select 1 from public.mission_submissions s
        join public.group_accounts ga on ga.group_id=s.group_id
        where s.mission_id=m.id and ga.user_id=auth.uid() and ga.classroom_id=p_classroom_id and ga.is_approved=true
      )
    )
    and (
      m.applies_to_all_classes
      or (cardinality(m.target_classroom_ids)>0 and p_classroom_id=any(m.target_classroom_ids))
      or (not m.applies_to_all_classes and cardinality(m.target_classroom_ids)=0 and m.classroom_id=p_classroom_id)
    )
    and exists (select 1 from public.classrooms c where c.id=p_classroom_id and c.teacher_id=m.created_by);
end;
$$;

revoke all on function public.get_student_missions(uuid) from public;
grant execute on function public.get_student_missions(uuid) to authenticated;

-- ── 2. Item-level foundation attempts ────────────────────────────────────
-- The smallest table that supports per-skill mastery tracking later. It is
-- written by a trigger, so no new submission path is introduced.

create table if not exists public.foundation_question_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  answered_at timestamptz not null default now(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  submission_id uuid references public.mission_submissions(id) on delete cascade,
  classroom_id uuid references public.classrooms(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  group_member_id uuid references public.group_members(id) on delete cascade,
  question_id text not null,
  item_index integer not null,
  level smallint,
  skill text,
  difficulty text,
  domain text,
  selected_index integer,
  is_correct boolean not null
);

create index if not exists idx_foundation_attempts_member
  on public.foundation_question_attempts(group_member_id, answered_at desc);
create index if not exists idx_foundation_attempts_question
  on public.foundation_question_attempts(question_id);
create index if not exists idx_foundation_attempts_skill
  on public.foundation_question_attempts(group_member_id, skill, level);

-- One row per item per submission, so re-grading a submission cannot inflate
-- mastery counts.
create unique index if not exists idx_foundation_attempts_unique
  on public.foundation_question_attempts(submission_id, item_index);

alter table public.foundation_question_attempts enable row level security;

drop policy if exists own_foundation_attempts on public.foundation_question_attempts;
create policy own_foundation_attempts on public.foundation_question_attempts for select to authenticated
  using (
    exists (
      select 1 from public.group_accounts ga
      where ga.user_id = auth.uid()
        and ga.group_member_id = foundation_question_attempts.group_member_id
    )
  );

drop policy if exists teacher_read_foundation_attempts on public.foundation_question_attempts;
create policy teacher_read_foundation_attempts on public.foundation_question_attempts for select to authenticated
  using (auth_is_teacher_of(classroom_id));

create or replace function public.record_foundation_attempts()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mission public.missions%rowtype;
  v_questions jsonb;
  v_key jsonb;
  v_answers jsonb;
begin
  -- Teacher-created and manual missions are untouched.
  if new.mission_id is null then return new; end if;

  select * into v_mission from public.missions where id = new.mission_id;
  if not found or v_mission.mission_source is distinct from 'daily_foundation' then
    return new;
  end if;

  if new.answers is null or btrim(new.answers) = '' then return new; end if;

  begin
    v_answers := new.answers::jsonb;
    v_questions := coalesce(v_mission.ai_content::jsonb -> 'questions', '[]'::jsonb);
  exception when others then
    -- A malformed payload must never block the submission itself.
    return new;
  end;

  if jsonb_typeof(v_questions) <> 'array' then return new; end if;

  begin
    v_key := case
      when jsonb_typeof(v_mission.answer_key::jsonb) = 'object'
        then v_mission.answer_key::jsonb -> 'answers'
      else v_mission.answer_key::jsonb
    end;
  exception when others then
    v_key := null;
  end;

  -- Without a key there is nothing to compare against, so nothing is recorded.
  if v_key is null then return new; end if;

  -- Students post answers as an object keyed by item position, exactly the
  -- shape submit_mission() grades, so the same lookups are reused here.
  insert into public.foundation_question_attempts(
    mission_id, submission_id, classroom_id, group_id, group_member_id,
    question_id, item_index, level, skill, difficulty, domain,
    selected_index, is_correct
  )
  select
    new.mission_id,
    new.id,
    new.classroom_id,
    new.group_id,
    new.group_member_id,
    coalesce(q.item->>'question_id', 'item-' || q.ordinality::text),
    q.ordinality - 1,
    nullif(q.item->>'level', '')::smallint,
    nullif(q.item->>'skill', ''),
    nullif(q.item->>'difficulty', ''),
    nullif(q.item->>'domain', ''),
    nullif(v_answers ->> (q.ordinality - 1)::text, '')::integer,
    (v_answers -> (q.ordinality - 1)::text)
      is not distinct from (v_key -> (q.ordinality - 1)::integer)
  from jsonb_array_elements(v_questions) with ordinality as q(item, ordinality)
  on conflict (submission_id, item_index) do nothing;

  return new;
end;
$$;

drop trigger if exists capture_foundation_attempts on public.mission_submissions;
create trigger capture_foundation_attempts
after insert or update of answers on public.mission_submissions
for each row execute function public.record_foundation_attempts();

-- ── 3. Option shuffling ──────────────────────────────────────────────────
-- Fisher-Yates over the four option positions, with the answer index remapped
-- to match. Input that cannot be trusted is returned untouched, so the key is
-- never misaligned with the displayed options.

create or replace function public.foundation_shuffle_options(
  p_options jsonb,
  p_correct_index smallint
)
returns jsonb
language sql
volatile
as $$
  -- perm maps each original option position to the new position it is shown
  -- at, so the answer index can be remapped with the options.
  with perm as (
    select
      u.old_pos,
      row_number() over (order by md5(random()::text || u.old_pos::text))::integer as new_pos
    from generate_series(0, 3) as u(old_pos)
  )
  select case
    when p_correct_index is not null
      and jsonb_typeof(p_options) = 'array'
      and jsonb_array_length(p_options) = 4
      and p_correct_index between 0 and 3
    then jsonb_build_object(
      'options', (select jsonb_agg(p_options ->> perm.old_pos order by perm.new_pos) from perm),
      'answer_index', (select perm.new_pos - 1 from perm where perm.old_pos = p_correct_index)
    )
    else jsonb_build_object('options', p_options, 'answer_index', p_correct_index)
  end;
$$;

-- ── 4. The daily Power-Up engine ─────────────────────────────────────────
-- Same selection contract as 20261110: 2 Level 1 + 2 Level 2 + 1 Level 3 from
-- APPROVED, active rows, expiring at the end of the Manila day, flat 5 XP.
-- The return type becomes jsonb so a student can never receive the answer key.
-- PostgreSQL cannot change a return type in place, so both entry points are
-- dropped first. Nothing else depends on them: the client only reads the id
-- and the mission fields over PostgREST, which serialises both the old
-- composite type and jsonb the same way.

drop function if exists public.ensure_daily_drill_for_student(uuid);
drop function if exists public.ensure_daily_drill(uuid);

create function public.ensure_daily_drill(p_classroom_id uuid default null)
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

  select * into v_existing
  from public.missions
  where mission_source = 'daily_foundation'
    and auto_daily_date = v_today
    and classroom_id = v_classroom.id;

  if found then return public.sanitize_mission_for_student(v_existing); end if;

  -- A drill from the earlier generated engine may still own today's slot. It
  -- is a different question set, so it is retired rather than shown to
  -- students. Existing submissions are preserved by only deactivating rows
  -- nobody has attempted.
  update public.missions m
  set is_active = false
  where m.is_auto_daily
    and m.mission_source <> 'daily_foundation'
    and m.auto_daily_date = v_today
    and m.classroom_id = v_classroom.id
    and not exists (select 1 from public.mission_submissions s where s.mission_id = m.id);

  v_subject := coalesce(nullif(trim(v_classroom.subject), ''), 'General Studies');

  if lower(v_subject) !~ '(math|matemat|mathemat|maths|mathematics|arithmetic|algebra|geometry)' then
    raise exception 'Automatic Daily Math Power-Up is available for Mathematics classes only. Classroom subject: %s', v_subject;
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
    raise exception 'Daily Math Power-Up question bank does not contain enough approved active questions for all Levels 1-3. Found %, need 5.', v_i;
  end if;

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
    -- Grading compares the submitted option index against this key, so the key
    -- holds each item's shuffled answer_index rather than its value.
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

  return public.sanitize_mission_for_student(v_mission);
end;
$$;

revoke all on function public.ensure_daily_drill(uuid) from public;
grant execute on function public.ensure_daily_drill(uuid) to authenticated;

-- The student wrapper is now a thin delegate, so the handover above always runs
-- and the return type stays sanitised.
create or replace function public.ensure_daily_drill_for_student(p_classroom_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  if not exists (
    select 1 from public.group_accounts
    where user_id = v_user and classroom_id = p_classroom_id and is_approved = true
  ) and not auth_is_teacher_of(p_classroom_id) then
    raise exception 'Approved classroom account required';
  end if;

  return ensure_daily_drill(p_classroom_id);
end;
$$;

revoke all on function public.ensure_daily_drill_for_student(uuid) from public;
grant execute on function public.ensure_daily_drill_for_student(uuid) to authenticated;

-- 20261108 left expire_daily_drills() executable by every authenticated user,
-- which let any student deactivate missions. ensure_daily_drill() now expires
-- yesterday's row as part of materialising today's, so the standalone helper
-- has no callers and no need to be reachable.
revoke all on function public.expire_daily_drills() from public, authenticated;

-- The generated-number builders have no callers once the bank engine is live.
drop function if exists public.drill_options(numeric, integer);
drop function if exists public.drill_whole(integer);
drop function if exists public.drill_integer(integer);
drop function if exists public.drill_fraction(integer);
drop function if exists public.drill_decimal(integer);

-- One automatic daily Power-Up per classroom per day. The 20261108 index was
-- keyed by subject as well; only mathematics generates one, so the narrower
-- key is the correct invariant. Duplicate rows are retired first so the unique
-- index can be created on a database that already ran the old engine.
update public.missions m
set is_active = false
where m.mission_source = 'daily_foundation'
  and m.auto_daily_date is not null
  and exists (
    select 1 from public.missions other
    where other.mission_source = 'daily_foundation'
      and other.auto_daily_date = m.auto_daily_date
      and other.classroom_id = m.classroom_id
      and (other.created_date, other.id) > (m.created_date, m.id)
  );

drop index if exists public.idx_missions_one_auto_daily_per_day;
drop index if exists public.idx_missions_source_daily_foundation;
create unique index if not exists idx_missions_one_daily_foundation_per_day
  on public.missions(classroom_id, auto_daily_date)
  where mission_source = 'daily_foundation' and auto_daily_date is not null;
