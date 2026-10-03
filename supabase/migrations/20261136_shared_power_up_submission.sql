-- 20261136 — let every Mathematics class submit the shared Power-Up.
--
-- 20261133 made the Daily Math Power-Up one shared mission with no classroom, and
-- opened it to every Mathematics class in get_student_missions. But submit_mission
-- still gated on the mission's creator owning the student's classroom:
--
--   (classroom_id = v_group.classroom_id or (
--     (applies_to_all_classes or v_group.classroom_id = any(target_classroom_ids))
--     and exists (... c.teacher_id = missions.created_by)))
--
-- With classroom_id NULL the first branch cannot match, and the second demands the
-- mission's one creator be the student's teacher. The result was a Power-Up that
-- every Mathematics class could see and nobody outside one teacher's classes could
-- submit: "Mission is not active".
--
-- Only the shared Power-Up gains an explicit branch. A teacher's own mission still
-- requires being the owner of the class it targets.

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

-- ── Verification ─────────────────────────────────────────────────────────
-- The shared Power-Up must be submittable from a Mathematics class the mission's
-- creator does not teach, must not be submittable from a non-Mathematics class,
-- and must credit the individual and their group once redeemed.

do $$
declare
  v_m         public.missions%rowtype;
  v_math      uuid;
  v_nonmath   uuid;
  v_student   uuid;
  v_member    uuid;
  v_group     uuid;
  v_ns        uuid;
  v_ngroup    uuid;
  v_sub       public.mission_submissions%rowtype;
  v_key       jsonb;
  v_answers   jsonb;
  v_redeem    jsonb;
  v_log       record;
  v_logged    boolean := false;
  v_xp        numeric := 0;
  v_avail     numeric := 0;
  v_redeemed  boolean := false;
  v_problems  text[] := '{}';
begin
  select * into v_m
  from public.missions
  where mission_source = 'daily_foundation'
    and auto_daily_date = (now() at time zone 'Asia/Manila')::date;
  if not found then raise exception 'No Power-Up exists for today to verify against.'; end if;

  if not (v_m.is_active and v_m.approval_status = 'approved') then
    raise exception 'The Power-Up is not approved and live, so the submit path cannot be exercised.';
  end if;

  -- Answer today's Power-Up correctly, so the check exercises grading and XP too.
  v_key := case
    when jsonb_typeof(v_m.answer_key::jsonb) = 'object' and v_m.answer_key::jsonb ? 'answers'
      then v_m.answer_key::jsonb -> 'answers'
    else v_m.answer_key::jsonb
  end;
  v_answers := (
    select jsonb_object_agg((a.idx - 1)::text, a.correct)
    from jsonb_array_elements(v_key) with ordinality as a(correct, idx)
  );
  if v_answers is null or jsonb_array_length(v_key) <> 5 then
    raise exception 'Today''s Power-Up has no usable five-answer key.';
  end if;

  -- A Mathematics classroom the mission's creator does NOT teach, holding a student
  -- who has not submitted today and has the most XP banked.
  select s.classroom_id, s.user_id, s.group_member_id, s.group_id, s.banked
    into v_math, v_student, v_member, v_group, v_avail
  from (
    select c.id as classroom_id, ga.user_id, ga.group_member_id, ga.group_id,
      coalesce((
        select sum(ms.xp_earned) from public.mission_submissions ms
        where ms.group_member_id = ga.group_member_id
      ), 0) - coalesce((
        select sum(pl.xp_spent) from public.participation_logs pl
        where pl.group_member_id = ga.group_member_id and pl.event_type = 'mission_redemption'
      ), 0) as banked
    from public.classrooms c
    join public.group_accounts ga
      on ga.classroom_id = c.id and ga.is_approved and ga.group_member_id is not null
    where public.foundation_class_serves_power_up(c.subject)
      and c.teacher_id is distinct from v_m.created_by
      and not exists (
        select 1 from public.mission_submissions ms
        where ms.mission_id = v_m.id and ms.group_member_id = ga.group_member_id
      )
  ) s
  order by s.banked desc, s.classroom_id
  limit 1;

  if v_math is null then
    raise exception 'No second-teacher Mathematics classroom exists to verify the shared submission.';
  end if;

  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_student::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_student::text, 'role', 'authenticated')::text);

  -- 1. A student outside the creator's classes can submit it, and it grades right.
  begin
    v_sub := public.submit_mission(v_m.id, v_group, 0, v_answers::text);
  exception when others then
    v_problems := array_append(v_problems,
      'a Mathematics class outside the creator''s schools could not submit it: ' || sqlerrm);
  end;

  if v_sub.id is not null then
    -- 2. The submission is individual, recorded against their own class, and pays
    --    the flat 5 XP for a full set of correct answers.
    if v_sub.group_member_id is null then
      v_problems := array_append(v_problems, 'the Power-Up submission is not individual');
    end if;
    if v_sub.classroom_id <> v_math then
      v_problems := array_append(v_problems,
        'the submission was recorded against the wrong classroom');
    end if;
    if v_sub.score <> 5 then
      v_problems := array_append(v_problems,
        'five correct answers scored ' || v_sub.score);
    end if;

    v_xp := v_sub.xp_earned;
    if v_xp <> 5 then
      v_problems := array_append(v_problems,
        'the Power-Up paid ' || v_xp || ' XP, expected a flat 5');
    end if;

    -- 3. Redeeming credits the personal wallet and the group, and only when the
    --    student actually has a full block of XP to spend.
    if v_avail + v_xp >= 10 then
      v_redeem := public.redeem_mission_points(10, v_math);

      select * into v_log
      from public.participation_logs pl
      where pl.group_member_id = v_member
        and pl.group_id = v_group
        and pl.event_type = 'mission_redemption'
        and pl.xp_spent = (v_redeem ->> 'xpAmount')::numeric
      order by pl.created_date desc
      limit 1;

      if not found then
        v_problems := array_append(v_problems,
          'the redemption credited neither the student''s wallet nor the group');
      else
        v_logged := true;
        if coalesce(v_log.points_awarded, 0) < 1 then
          v_problems := array_append(v_problems,
            'the redemption paid the student''s wallet nothing');
        end if;
      end if;
      v_redeemed := true;
    else
      raise notice
        'skipped the redemption check: the busiest second-teacher Mathematics student had only % XP banked',
        v_avail;
    end if;
  end if;

  -- 4. A non-Mathematics class still cannot submit it.
  select c.id into v_nonmath
  from public.classrooms c
  where not public.foundation_class_serves_power_up(c.subject)
    and exists (select 1 from public.group_accounts ga
                where ga.classroom_id = c.id and ga.is_approved)
  order by c.created_date limit 1;

  if v_nonmath is not null then
    select ga.user_id, ga.group_id into v_ns, v_ngroup
    from public.group_accounts ga
    where ga.classroom_id = v_nonmath and ga.is_approved
    order by ga.created_date limit 1;

    execute 'set local request.jwt.claim.sub = ' || quote_literal(v_ns::text);
    execute 'set local request.jwt.claims = ' || quote_literal(
      json_build_object('sub', v_ns::text, 'role', 'authenticated')::text);

    begin
      perform public.submit_mission(v_m.id, v_ngroup, 0, v_answers::text);
      v_problems := array_append(v_problems,
        'a non-Mathematics class was allowed to submit the Power-Up');
    exception when others then
      null;
    end;
  end if;

  -- Leave no trace of the verification.
  if v_logged then
    delete from public.participation_logs pl
    where pl.group_member_id = v_member
      and pl.group_id = v_group
      and pl.event_type = 'mission_redemption'
      and pl.xp_spent = (v_redeem ->> 'xpAmount')::numeric
      and pl.created_date = v_log.created_date;
  end if;
  delete from public.mission_submissions
  where mission_id = v_m.id and group_member_id = v_member;

  if array_length(v_problems, 1) is not null then
    raise exception 'Shared Power-Up submission broken: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'verified: a Mathematics class outside the creator''s schools can submit the Power-Up for a flat 5 XP, and the redemption check %',
    case when v_redeemed then ' credited both the wallet and the group' else ' was skipped' end;
end;
$$;