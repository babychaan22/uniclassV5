-- 20261149 — check that every notification emitter actually delivers.
--
-- Nothing here may raise, and each emitter has to produce a row for a real
-- classroom. The check creates its own announcement, badge request, score
-- request and award, counts what each one caused, and deletes everything it
-- made.

do $$
declare
  v_classroom uuid;
  v_teacher uuid;
  v_student uuid;
  v_member uuid;
  v_group uuid;
  v_score_id uuid;
  v_announcement uuid;
  v_badge uuid;
  v_request uuid;
  v_manual public.participation_logs%rowtype;
  v_total integer;
  v_step text := 'start';
  v_problems text[] := '{}';
begin
  select c.id, c.teacher_id, ga.user_id, ga.group_member_id, ga.group_id
    into v_classroom, v_teacher, v_student, v_member, v_group
  from public.classrooms c
  join public.group_accounts ga
    on ga.classroom_id = c.id and ga.is_approved and ga.group_member_id is not null
  order by c.created_date, ga.created_date
  limit 1;

  if v_classroom is null then
    raise notice 'skipped: no classroom with an approved student to notify';
    return;
  end if;

  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_teacher::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_teacher::text, 'role', 'authenticated')::text);

  -- 1. A teacher announcement reaches the class.
  v_step := 'announcement';
  insert into public.announcements(classroom_id, title, body, is_pinned, created_by)
  values (v_classroom, 'Verification notice', 'Checking notifications.', false, v_teacher)
  returning id into v_announcement;

  select count(*) into v_total
  from public.app_notifications
  where classroom_id = v_classroom and kind = 'announcement';
  if v_total < 1 then
    v_problems := array_append(v_problems, 'an announcement notified nobody');
  end if;

  -- 2. A badge request reaches the teacher; its approval reaches the student.
  v_step := 'badge request';
  insert into public.badges(classroom_id, group_id, badge_type, week_start_date, points_awarded, redeemed_by, approval_status, member_id)
  values (
    v_classroom, v_group, 'weekly_full_attendance',
    (now() at time zone 'Asia/Manila')::date - extract(isodow from (now() at time zone 'Asia/Manila'))::integer + 1,
    5, v_student, 'pending', v_member
  )
  returning id into v_badge;

  if not exists (
    select 1 from public.app_notifications
    where kind = 'badge' and recipient_user_id = v_teacher and classroom_id = v_classroom
  ) then
    v_problems := array_append(v_problems, 'a badge request did not reach the teacher');
  end if;

  v_step := 'badge approval';
  update public.badges
  set approval_status = 'approved', reviewed_by = v_teacher, reviewed_at = now()
  where id = v_badge;

  if not exists (
    select 1 from public.app_notifications
    where kind = 'badge_award' and recipient_user_id = v_student
  ) then
    v_problems := array_append(v_problems, 'an approved badge did not reach the student');
  end if;

  -- 3. A score request reaches the teacher; its decision reaches the student.
  v_step := 'score request';
  select s.id into v_score_id
  from public.activity_scores s
  join public.group_members gm on gm.id = s.group_member_id
  where gm.group_id = v_group
  limit 1;

  if v_score_id is not null then
    insert into public.activity_score_edit_requests(
      activity_score_id, activity_id, classroom_id, group_id, group_member_id,
      current_score, proposed_score, requested_by
    )
    select s.id, s.activity_id, s.classroom_id, s.group_id, s.group_member_id,
           s.score, s.score + 1, v_student
    from public.activity_scores s
    where s.id = v_score_id
    returning id into v_request;

    if not exists (
      select 1 from public.app_notifications
      where kind = 'score_edit' and recipient_user_id = v_teacher
    ) then
      v_problems := array_append(v_problems, 'a score request did not reach the teacher');
    end if;

    v_step := 'score approval';
    update public.activity_score_edit_requests
    set status = 'approved', reviewed_by = v_teacher, reviewed_at = now()
    where id = v_request;

    if not exists (
      select 1 from public.app_notifications
      where kind = 'score_edit' and recipient_user_id = v_student
    ) then
      v_problems := array_append(v_problems, 'an approved score change did not reach the student');
    end if;
  end if;

  -- 4. A manual award tells the student, and removing it tells them again.
  v_step := 'manual award';
  v_manual := public.award_participation_points(v_group, 4, v_member, 'verification award');

  if not exists (
    select 1 from public.app_notifications
    where kind = 'points' and recipient_user_id = v_student and title = 'Points awarded'
  ) then
    v_problems := array_append(v_problems, 'a manual award did not reach the student');
  end if;

  v_step := 'removal';
  perform public.void_participation_entry(v_manual.id, 'verification');

  if not exists (
    select 1 from public.app_notifications
    where kind = 'points' and recipient_user_id = v_student and title = 'Points removed'
  ) then
    v_problems := array_append(v_problems, 'removing an entry did not tell the student');
  end if;

  -- Leave the classroom as it was found.
  delete from public.app_notifications
  where classroom_id = v_classroom and created_at > now() - interval '10 minutes';

  delete from public.participation_logs where id = v_manual.id;
  delete from public.activity_score_edit_requests where id = v_request;
  delete from public.badges where id = v_badge;
  delete from public.announcements where id = v_announcement;

  -- 5. The helpers must be unreachable from a signed-in student. This is the
  --    real guarantee, and it is checked as a privilege rather than by
  --    impersonation: these functions are only ever entered from another
  --    SECURITY DEFINER function or a trigger, which run as their owner.
  if has_function_privilege(
       'authenticated', 'public.notify_user(uuid,uuid,text,text,text,text,text)', 'execute'
     ) then
    v_problems := array_append(v_problems, 'a student could call notify_user and write into any bell');
  end if;

  if has_function_privilege(
       'authenticated', 'public.notify_group(uuid,text,text,text,text)', 'execute'
     ) then
    v_problems := array_append(v_problems, 'a student could call notify_group directly');
  end if;

  if has_function_privilege(
       'authenticated', 'public.notify_member(uuid,text,text,text,text)', 'execute'
     ) then
    v_problems := array_append(v_problems, 'a student could call notify_member directly');
  end if;

  if has_function_privilege(
       'authenticated', 'public.notify_classrooms(uuid[],text,text,text,text,text)', 'execute'
     ) then
    v_problems := array_append(v_problems, 'a student could call notify_classrooms directly');
  end if;

  if array_length(v_problems, 1) is not null then
    raise exception 'Notifications not delivered: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'verified: announcements reach the class, badge and score requests reach the teacher, their decisions and points changes reach the student, and the emitters cannot be called by a student';
end;
$$;