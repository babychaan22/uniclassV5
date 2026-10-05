-- 20261166 — enforce mission eligibility and practice limits at the database.
--
-- The browser can make a helpful mission experience, but it is not a security
-- boundary. These checks also apply to direct RPC calls.

create or replace function public.student_mission_status(
  p_classroom_id uuid,
  p_member_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_term public.grading_terms%rowtype;
  v_settings public.class_settings%rowtype;
  v_attendance numeric := 0;
  v_activity numeric := 0;
  v_quiz numeric := 0;
  v_exam numeric := 0;
  v_performance numeric := 0;
  v_participation numeric := 0;
  v_attendance_count integer := 0;
  v_activity_count integer := 0;
  v_quiz_count integer := 0;
  v_exam_count integer := 0;
  v_performance_count integer := 0;
  v_participation_count integer := 0;
  v_weight numeric;
  v_num numeric := 0;
  v_den numeric := 0;
  v_points numeric := 0;
  v_max_points numeric := 1;
  v_total numeric := 0;
begin
  select * into v_term from public.grading_terms
    where classroom_id = p_classroom_id
    order by is_active desc, created_date desc limit 1;
  select * into v_settings from public.class_settings
    where classroom_id = p_classroom_id order by created_date desc limit 1;

  select count(*), coalesce(100.0 * count(*) filter (where status = 'present') / nullif(count(*), 0), 0)
    into v_attendance_count, v_attendance
  from public.attendances
  where classroom_id = p_classroom_id and group_member_id = p_member_id
    and (v_term.id is null or attendance_date between v_term.start_date and v_term.end_date);

  select count(s.id), coalesce(100.0 * sum(s.score) / nullif(sum(a.max_score), 0), 0)
    into v_activity_count, v_activity
  from public.activity_scores s join public.activities a on a.id = s.activity_id
  where s.classroom_id = p_classroom_id and s.group_member_id = p_member_id;

  select count(*), coalesce(100.0 * sum(score) / nullif(sum(max_score), 0), 0)
    into v_quiz_count, v_quiz
  from public.teacher_assessments
  where classroom_id = p_classroom_id and group_member_id = p_member_id and category = 'quiz'
    and (v_term.id is null or created_date::date between v_term.start_date and v_term.end_date);
  select count(*), coalesce(100.0 * sum(score) / nullif(sum(max_score), 0), 0)
    into v_exam_count, v_exam
  from public.teacher_assessments
  where classroom_id = p_classroom_id and group_member_id = p_member_id and category = 'major_exam'
    and (v_term.id is null or created_date::date between v_term.start_date and v_term.end_date);
  select count(*), coalesce(100.0 * sum(score) / nullif(sum(max_score), 0), 0)
    into v_performance_count, v_performance
  from public.teacher_assessments
  where classroom_id = p_classroom_id and group_member_id = p_member_id and category = 'performance_task'
    and (v_term.id is null or created_date::date between v_term.start_date and v_term.end_date);

  select coalesce(sum(case when event_type = 'behavior_penalty' then -abs(points_awarded) else points_awarded end), 0)
    into v_points
  from public.participation_logs where classroom_id = p_classroom_id and group_member_id = p_member_id;
  select greatest(coalesce(max(points), 0), 1) into v_max_points from (
    select coalesce(sum(case when event_type = 'behavior_penalty' then -abs(points_awarded) else points_awarded end), 0) as points
    from public.participation_logs where classroom_id = p_classroom_id group by group_member_id
  ) totals;
  v_participation := 100.0 * v_points / v_max_points;
  v_participation_count := case when v_points > 0 then 1 else 0 end;

  v_weight := coalesce(v_settings.weight_attendance, 10); if v_attendance_count > 0 and v_weight > 0 then v_num := v_num + v_attendance * v_weight; v_den := v_den + v_weight; end if;
  v_weight := coalesce(v_settings.weight_activity_scores, 20); if v_activity_count > 0 and v_weight > 0 then v_num := v_num + v_activity * v_weight; v_den := v_den + v_weight; end if;
  v_weight := coalesce(v_settings.weight_quizzes, 20); if v_quiz_count > 0 and v_weight > 0 then v_num := v_num + v_quiz * v_weight; v_den := v_den + v_weight; end if;
  v_weight := coalesce(v_settings.weight_major_exams, 30); if v_exam_count > 0 and v_weight > 0 then v_num := v_num + v_exam * v_weight; v_den := v_den + v_weight; end if;
  v_weight := coalesce(v_settings.weight_performance_tasks, 20); if v_performance_count > 0 and v_weight > 0 then v_num := v_num + v_performance * v_weight; v_den := v_den + v_weight; end if;
  v_weight := coalesce(v_settings.weight_participation, 0); if v_participation_count > 0 and v_weight > 0 then v_num := v_num + v_participation * v_weight; v_den := v_den + v_weight; end if;

  v_total := case when v_den > 0 then v_num / v_den else 0 end;
  return case when v_total >= 80 then 'On Track' when v_total >= 60 then 'Developing' else 'At Risk' end;
end;
$$;

create or replace function public.enforce_student_mission_submission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mission public.missions%rowtype;
  v_account public.group_accounts%rowtype;
  v_status text;
begin
  select * into v_mission from public.missions where id = new.mission_id;
  if not found then raise exception 'Mission not found'; end if;
  if auth_is_teacher_of(new.classroom_id) then return new; end if;

  select * into v_account from public.group_accounts
  where user_id = auth.uid() and group_id = new.group_id and group_member_id = new.group_member_id
    and classroom_id = new.classroom_id and is_approved = true limit 1;
  if not found then raise exception 'Approved student account required'; end if;
  if v_mission.formative_type = 'manual' then
    raise exception 'Teacher-graded missions cannot be self-submitted';
  end if;
  if v_mission.mission_source <> 'daily_foundation' then
    v_status := public.student_mission_status(new.classroom_id, new.group_member_id);
    if not (coalesce(v_mission.target_statuses, array['On Track', 'Developing', 'At Risk']) @> array[v_status]) then
      raise exception 'This mission is not assigned to your current learning status';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_student_mission_submission on public.mission_submissions;
create trigger enforce_student_mission_submission
  before insert on public.mission_submissions
  for each row execute function public.enforce_student_mission_submission();

create or replace function public.enforce_mission_retry_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mission public.missions%rowtype;
begin
  select * into v_mission from public.missions where id = new.mission_id;
  if not found then raise exception 'Mission not found'; end if;
  if (v_mission.deadline_at is not null and v_mission.deadline_at <= now())
    or (v_mission.deadline is not null and v_mission.deadline < current_date) then
    raise exception 'Mission deadline has passed';
  end if;
  if exists (
    select 1 from public.mission_retry_attempts
    where mission_id = new.mission_id and created_by = new.created_by and completed_at is null
  ) then raise exception 'Finish your open practice retry before starting another'; end if;
  if (select count(*) from public.mission_retry_attempts
      where mission_id = new.mission_id and created_by = new.created_by and completed_at is not null) >= 1 then
    raise exception 'This mission already has its one practice retry';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_mission_retry_limits on public.mission_retry_attempts;
create trigger enforce_mission_retry_limits
  before insert on public.mission_retry_attempts
  for each row execute function public.enforce_mission_retry_limits();

-- Older versions allowed a student to start the same practice retry more than
-- once. Keep the most recent unfinished draft; the older ones have no submitted
-- work and cannot be resumed safely once the one-open-at-a-time rule exists.
delete from public.mission_retry_attempts r
using (
  select id from (
    select id, row_number() over (
      partition by mission_id, created_by
      order by created_at desc, id desc
    ) as row_number
    from public.mission_retry_attempts
    where completed_at is null
  ) ranked where row_number > 1
) stale
where r.id = stale.id;

create unique index if not exists idx_one_open_mission_retry_per_student
  on public.mission_retry_attempts(mission_id, created_by) where completed_at is null;
create index if not exists idx_mission_retry_attempts_student_history
  on public.mission_retry_attempts(mission_id, created_by, completed_at, created_at desc);

-- The mission row is content, not a counter. Locking it made every student in
-- a daily Power-Up wait behind the previous submission. The unique submission
-- index remains the concurrency guard for a student's first attempt.
create or replace function public.submit_mission(
  p_mission_id uuid, p_group_id uuid, p_score numeric, p_answers text,
  p_retry_attempt_id uuid default null
)
returns public.mission_submissions language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_account public.group_accounts%rowtype; v_m public.missions%rowtype;
  v_group public.groups%rowtype; v_result public.mission_submissions%rowtype; v_answers jsonb;
  v_raw_answer_key jsonb; v_answer_key jsonb; v_questions jsonb; v_score numeric; v_max numeric;
  v_correct integer; v_retry public.mission_retry_attempts%rowtype;
begin
  select * into v_account from public.group_accounts where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved student account required'; end if;
  select * into v_group from public.groups where id = p_group_id;
  select * into v_m from public.missions where id = p_mission_id and is_active = true
    and (classroom_id = v_group.classroom_id or ((applies_to_all_classes or v_group.classroom_id = any(target_classroom_ids)) and exists (select 1 from public.classrooms c where c.id = v_group.classroom_id and c.teacher_id = missions.created_by)) or (missions.mission_source = 'daily_foundation' and missions.classroom_id is null and missions.approval_status = 'approved' and coalesce((select public.foundation_class_serves_power_up(c.subject) from public.classrooms c where c.id = v_group.classroom_id), false)));
  if not found then raise exception 'Mission is not active'; end if;
  if v_m.archived_at is not null then raise exception 'This mission has been archived'; end if;
  if v_m.deadline is not null and v_m.deadline < current_date then raise exception 'Mission deadline has passed'; end if;
  if p_retry_attempt_id is null and v_m.formative_type = 'manual' then raise exception 'Teacher-graded missions cannot be self-submitted'; end if;
  begin v_answers := coalesce(nullif(p_answers, '')::jsonb, '{}'::jsonb); exception when others then raise exception 'Invalid answers'; end;
  v_questions := v_m.ai_content::jsonb -> 'questions'; v_raw_answer_key := v_m.answer_key::jsonb;
  v_answer_key := case when jsonb_typeof(v_raw_answer_key) = 'object' and v_raw_answer_key ? 'answers' then v_raw_answer_key -> 'answers' else v_raw_answer_key end;
  if p_retry_attempt_id is not null then
    select * into v_retry from public.mission_retry_attempts where id = p_retry_attempt_id and mission_id = p_mission_id and group_id = p_group_id and created_by = v_user and completed_at is null for update;
    if not found then raise exception 'Retry attempt is unavailable'; end if;
    v_questions := v_retry.questions; v_answer_key := v_retry.answer_key;
  end if;
  if v_m.formative_type in ('true_false', 'multiple_choice') then
    select count(*) into v_correct from jsonb_array_elements(v_questions) with ordinality as q(item, idx) where (v_answers -> ((q.idx - 1)::text)) = (v_answer_key -> ((q.idx - 1)::integer)); v_score := v_correct; v_max := jsonb_array_length(v_questions);
  elsif v_m.formative_type = 'drag_drop' then
    select count(*) into v_correct from jsonb_each(v_answer_key) a(key, value) where v_answers ->> a.key = trim(both '"' from a.value::text); v_score := v_correct; select count(*) into v_max from jsonb_object_keys(v_answer_key);
  else raise exception 'Unsupported student mission type'; end if;
  if p_retry_attempt_id is not null then
    update public.mission_retry_attempts set submitted_answers = v_answers, score = v_score, completed_at = now() where id = p_retry_attempt_id;
    select * into v_result from public.mission_submissions where mission_id = p_mission_id and group_member_id = v_account.group_member_id;
    if not found then raise exception 'Your original mission submission is unavailable'; end if; return v_result;
  end if;
  insert into public.mission_submissions(mission_id, group_id, group_member_id, classroom_id, score, xp_earned, graded_by, answers)
  values (v_m.id, p_group_id, v_account.group_member_id, v_group.classroom_id, v_score, greatest(0, round((v_score / nullif(v_max, 0)) * v_m.xp_reward)), v_user, p_answers)
  on conflict (mission_id, group_member_id) where group_member_id is not null do update set score = mission_submissions.score, xp_earned = mission_submissions.xp_earned, graded_by = mission_submissions.graded_by, answers = mission_submissions.answers returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.submit_mission(uuid, uuid, numeric, text, uuid) from public;
grant execute on function public.submit_mission(uuid, uuid, numeric, text, uuid) to authenticated;
