-- 20261141 — archive a mission instead of letting it pile up.
--
-- The create-mission page lists every mission a teacher has ever authored,
-- live or dead, so after a term it is mostly history. Deleting is the only
-- option today, and deleting cascades to mission_submissions and the retry
-- attempts and learning reviews behind them.
--
-- archived_at is a soft, reversible alternative:
--
--   * the mission leaves the create page's working list
--   * students who never started it stop seeing it
--   * a student who already submitted keeps their copy and their feedback
--   * nothing is deleted, so unarchiving restores it exactly
--
-- The shared Daily Math Power-Up is refused: it is regenerated every morning,
-- so archiving yesterday's row would only hide today's from the teacher.

alter table public.missions
  add column if not exists archived_at timestamptz;

create index if not exists idx_missions_archived
  on public.missions(archived_at)
  where archived_at is not null;

comment on column public.missions.archived_at is
  'Set when a teacher files a mission away. Archived missions leave the create page and are hidden from students who have not started them. Never deleted.';

create or replace function public.archive_mission(p_mission_id uuid, p_archived boolean default true)
returns public.missions
language plpgsql security definer set search_path = public as $$
declare
  v_m public.missions%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_m from public.missions where id = p_mission_id for update;
  if not found then raise exception 'Mission not found'; end if;

  if v_m.mission_source = 'daily_foundation' then
    raise exception 'The Daily Math Power-Up cannot be archived. A new one is generated every day.';
  end if;

  if v_m.created_by is distinct from auth.uid() then
    raise exception 'You can only archive missions you created';
  end if;

  update public.missions
  set archived_at = case when p_archived then now() else null end
  where id = p_mission_id
  returning * into v_m;

  return v_m;
end;
$$;

revoke all on function public.archive_mission(uuid, boolean) from public;
grant execute on function public.archive_mission(uuid, boolean) to authenticated;

-- ── Students stop seeing a mission they never started ─────────────────────
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
      -- Live, or already in this student's hands. An archived mission keeps
      -- showing only to the students who submitted it.
      ((m.is_active and m.archived_at is null)
        or exists (
          select 1 from public.mission_submissions s
          join public.group_accounts ga on ga.group_id = s.group_id
          where s.mission_id = m.id and ga.user_id = auth.uid()
            and ga.classroom_id = p_classroom_id and ga.is_approved = true
        )
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

-- ── And cannot be submitted or retried once archived ─────────────────────
create or replace function public.submit_mission(
  p_mission_id uuid, p_group_id uuid, p_score numeric, p_answers text,
  p_retry_attempt_id uuid default null
)
returns public.mission_submissions language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_account public.group_accounts%rowtype;
  v_m public.missions%rowtype;
  v_group public.groups%rowtype;
  v_result public.mission_submissions%rowtype;
  v_answers jsonb;
  v_raw_answer_key jsonb;
  v_answer_key jsonb;
  v_questions jsonb;
  v_score numeric;
  v_max numeric;
  v_correct integer;
  v_retry public.mission_retry_attempts%rowtype;
begin
  select * into v_account from public.group_accounts
  where user_id = v_user and group_id = p_group_id and is_approved = true
  limit 1;
  if not found or v_account.group_member_id is null then
    raise exception 'Approved student account required';
  end if;

  select * into v_group from public.groups where id = p_group_id;
  select * into v_m from public.missions
  where id = p_mission_id and is_active = true
    and (
      classroom_id = v_group.classroom_id
      or (
        (applies_to_all_classes or v_group.classroom_id = any(target_classroom_ids))
        and exists (select 1 from public.classrooms c where c.id = v_group.classroom_id and c.teacher_id = missions.created_by)
      )
      -- The shared Daily Math Power-Up: one mission for every Mathematics class,
      -- delivered once a teacher has approved it.
      or (
        missions.mission_source = 'daily_foundation'
        and missions.classroom_id is null
        and missions.approval_status = 'approved'
        and coalesce((
          select public.foundation_class_serves_power_up(c.subject)
          from public.classrooms c where c.id = v_group.classroom_id
        ), false)
      )
    )
  for update;
  if not found then raise exception 'Mission is not active'; end if;
  if v_m.archived_at is not null then raise exception 'This mission has been archived'; end if;
  if v_m.deadline is not null and v_m.deadline < current_date then raise exception 'Mission deadline has passed'; end if;

  begin
    v_answers := coalesce(nullif(p_answers, '')::jsonb, '{}'::jsonb);
  exception when others then
    raise exception 'Invalid answers';
  end;
  v_questions := v_m.ai_content::jsonb -> 'questions';
  v_raw_answer_key := v_m.answer_key::jsonb;
  v_answer_key := case when jsonb_typeof(v_raw_answer_key) = 'object' and v_raw_answer_key ? 'answers'
    then v_raw_answer_key -> 'answers' else v_raw_answer_key end;

  if p_retry_attempt_id is not null then
    select * into v_retry from public.mission_retry_attempts
    where id = p_retry_attempt_id and mission_id = p_mission_id and group_id = p_group_id
      and created_by = v_user and completed_at is null
    for update;
    if not found then raise exception 'Retry attempt is unavailable'; end if;
    v_questions := v_retry.questions;
    v_answer_key := v_retry.answer_key;
  end if;

  if v_m.formative_type in ('true_false', 'multiple_choice') then
    select count(*) into v_correct
    from jsonb_array_elements(v_questions) with ordinality as q(item, idx)
    where (v_answers -> ((q.idx - 1)::text)) = (v_answer_key -> ((q.idx - 1)::integer));
    v_score := v_correct;
    v_max := jsonb_array_length(v_questions);
  elsif v_m.formative_type = 'drag_drop' then
    select count(*) into v_correct from jsonb_each(v_answer_key) a(key, value)
    where v_answers ->> a.key = trim(both '"' from a.value::text);
    v_score := v_correct;
    select count(*) into v_max from jsonb_object_keys(v_answer_key);
  else
    v_score := greatest(0, least(coalesce(p_score, 0), v_m.max_score));
    v_max := v_m.max_score;
  end if;

  if p_retry_attempt_id is not null then
    update public.mission_retry_attempts
    set submitted_answers = v_answers, score = v_score, completed_at = now()
    where id = p_retry_attempt_id;
    select * into v_result from public.mission_submissions
    where mission_id = p_mission_id and group_member_id = v_account.group_member_id;
    if not found then raise exception 'Your original mission submission is unavailable'; end if;
    return v_result;
  end if;

  -- First attempt is permanent for scoring. Later submits leave its XP intact.
  insert into public.mission_submissions(
    mission_id, group_id, group_member_id, classroom_id, score, xp_earned, graded_by, answers
  ) values (
    v_m.id, p_group_id, v_account.group_member_id, v_group.classroom_id, v_score,
    greatest(0, round((v_score / nullif(v_max, 0)) * v_m.xp_reward)), v_user, p_answers
  ) on conflict (mission_id, group_member_id) where group_member_id is not null
  do update set
    score = mission_submissions.score,
    xp_earned = mission_submissions.xp_earned,
    graded_by = mission_submissions.graded_by,
    answers = mission_submissions.answers
  returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.submit_mission(uuid, uuid, numeric, text, uuid) from public;
grant execute on function public.submit_mission(uuid, uuid, numeric, text, uuid) to authenticated;

-- start_mission_retry is redefined only to add the archived guard; the body is
-- otherwise the foundation-retry implementation from 20261113.
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
  if v_m.archived_at is not null then raise exception 'This mission has been archived'; end if;

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
  v_m public.missions%rowtype;
  v_original timestamptz;
  v_after public.missions%rowtype;
  v_power_up uuid;
  v_student uuid;
  v_problems text[] := '{}';
  v_def text;
begin
  -- A teacher-authored, non-Power-Up mission to archive and restore.
  select * into v_m
  from public.missions m
  where m.mission_source <> 'daily_foundation'
    and m.created_by is not null
    and exists (select 1 from public.classrooms c where c.teacher_id = m.created_by)
  order by m.created_date
  limit 1;

  if v_m.id is null then
    raise notice 'skipped: no teacher-authored mission exists to archive';
    return;
  end if;

  v_original := v_m.archived_at;

  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_m.created_by::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_m.created_by::text, 'role', 'authenticated')::text);

  -- Archive, then restore. Nothing is deleted either way.
  v_after := public.archive_mission(v_m.id, true);
  if v_after.archived_at is null then
    v_problems := array_append(v_problems, 'archiving left archived_at empty');
  end if;

  v_after := public.archive_mission(v_m.id, false);
  if v_after.archived_at is not null then
    v_problems := array_append(v_problems, 'unarchiving left archived_at set');
  end if;

  -- The shared Power-Up must refuse.
  select id into v_power_up
  from public.missions
  where mission_source = 'daily_foundation'
  order by auto_daily_date desc nulls last limit 1;

  if v_power_up is not null then
    begin
      perform public.archive_mission(v_power_up, true);
      v_problems := array_append(v_problems, 'the Daily Math Power-Up was archivable');
    exception when others then
      null;
    end;
  end if;

  -- A student must not be able to archive anything.
  select user_id into v_student
  from public.group_accounts
  where is_approved and group_member_id is not null
  order by created_date limit 1;

  if v_student is not null then
    execute 'set local request.jwt.claim.sub = ' || quote_literal(v_student::text);
    execute 'set local request.jwt.claims = ' || quote_literal(
      json_build_object('sub', v_student::text, 'role', 'authenticated')::text);

    begin
      perform public.archive_mission(v_m.id, true);
      v_problems := array_append(v_problems, 'a student was able to archive a mission');
    exception when others then
      null;
    end;
  end if;

  -- Put the mission back exactly as it was found.
  update public.missions set archived_at = v_original where id = v_m.id;

  -- The guards have to be in the deployed definitions, not just in this file.
  foreach v_def in array array[
    'get_student_missions(uuid)', 'submit_mission(uuid,uuid,numeric,text,uuid)',
    'start_mission_retry(uuid,uuid)'
  ] loop
    if position('archived_at' in pg_get_functiondef(v_def::regprocedure)) = 0 then
      v_problems := array_append(v_problems, v_def || ' ignores archived_at');
    end if;
  end loop;

  if array_length(v_problems, 1) is not null then
    raise exception 'Mission archive broken: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'verified: a teacher can archive and restore a mission without deleting it, the shared Power-Up and students are refused, and all three student paths honour the flag';
end;
$$;