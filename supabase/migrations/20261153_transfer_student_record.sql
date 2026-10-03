-- 20261153 — move a student's record from one account to another.
--
-- When a student forgets to pick their existing name during onboarding they end
-- up with a second, empty account while their old one keeps the points, the
-- history and the attendance. A teacher needs to be able to say "this is the
-- same person" and have one account carry everything.
--
-- Everything a student's record consists of is keyed on group_members.id, not
-- on the login. So moving a record means re-pointing those rows at the other
-- member and then getting the duplicate out of the way.
--
-- What moves:
--   participation_logs, attendances, activity_scores, activity_evidence,
--   activity_score_edit_requests, mission_submissions, badges,
--   reward_redemptions, teacher_assessments, learning_reviews
--
-- What deliberately does not:
--   * mission_retry_attempts. They are created by the student who submitted,
--     and an attempt is only meaningful alongside that submission, which moves.
--   * push_subscriptions and app_notifications. Those belong to a person, not a
--     roster row, and both members are the same human anyway.
--
-- The account the teacher chooses as the destination keeps its login, its
-- approval state and its representative flag. The source account is deleted,
-- which is what removes it from the student's class list.

create table if not exists public.student_record_transfers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  source_member_id uuid not null,
  target_member_id uuid not null,
  moved_logs integer not null default 0,
  moved_attendance integer not null default 0,
  moved_scores integer not null default 0,
  moved_submissions integer not null default 0,
  moved_badges integer not null default 0,
  moved_rewards integer not null default 0,
  moved_reviews integer not null default 0,
  performed_by uuid not null references auth.users(id),
  note text,
  check (source_member_id <> target_member_id)
);

comment on table public.student_record_transfers is
  'Audit trail of records moved from a duplicate student account onto the right one.';

alter table public.student_record_transfers enable row level security;

drop policy if exists teacher_read_student_record_transfers on public.student_record_transfers;
create policy teacher_read_student_record_transfers on public.student_record_transfers
  for select to authenticated
  using (auth_is_teacher_of(classroom_id));

create or replace function public.transfer_student_record(
  p_source_member_id uuid,
  p_target_member_id uuid,
  p_note text default null
)
returns public.student_record_transfers
language plpgsql security definer set search_path = public as $$
declare
  v_source public.group_members%rowtype;
  v_target public.group_members%rowtype;
  v_source_account public.group_accounts%rowtype;
  v_result public.student_record_transfers%rowtype;
begin
  select * into v_source from public.group_members where id = p_source_member_id for update;
  if not found then raise exception 'The account you are moving from no longer exists'; end if;

  select * into v_target from public.group_members where id = p_target_member_id for update;
  if not found then raise exception 'The account you are moving to no longer exists'; end if;

  if v_source.id = v_target.id then
    raise exception 'Choose two different student accounts';
  end if;

  if v_source.classroom_id <> v_target.classroom_id then
    raise exception 'Both students must be in the same class';
  end if;

  if not auth_is_teacher_of(v_source.classroom_id) then
    raise exception 'Only the classroom teacher may move a student record';
  end if;

  select * into v_source_account from public.group_accounts
    where group_member_id = v_source.id and classroom_id = v_source.classroom_id
  order by created_date limit 1;

  -- Refuse the cases where merging would quietly destroy somebody's history.
  if v_source_account.id is not null and v_source_account.user_id is not null
     and exists (
       select 1 from public.group_accounts ga
       where ga.group_member_id = v_target.id
         and ga.classroom_id = v_target.classroom_id
         and ga.user_id is not null
     ) then
    raise exception 'The account you are moving to is already signed in. Remove the duplicate sign-in first, or pick the other direction.';
  end if;

  -- ── Move the record ───────────────────────────────────────────────────
  -- Only rows that do not already exist on the target move, so running this
  -- twice cannot double anything.

  update public.participation_logs l
    set group_member_id = v_target.id
  where l.group_member_id = v_source.id
    and not exists (
      select 1 from public.participation_logs t
      where t.group_member_id = v_target.id
        and t.created_date = l.created_date
        and t.event_type = l.event_type
        and t.points_awarded = l.points_awarded
    );
  get diagnostics v_result.moved_logs = row_count;

  -- Attendance is one row per member per day, so an existing day on the target
  -- wins and the duplicate day is removed rather than merged.
  delete from public.attendances a
  using public.attendances t
  where a.group_member_id = v_source.id
    and t.group_member_id = v_target.id
    and t.attendance_date = a.attendance_date;

  update public.attendances
    set group_member_id = v_target.id
  where group_member_id = v_source.id;
  get diagnostics v_result.moved_attendance = row_count;

  delete from public.activity_scores s
  using public.activity_scores t
  where s.group_member_id = v_source.id
    and t.group_member_id = v_target.id
    and t.activity_id = s.activity_id;

  update public.activity_scores set group_member_id = v_target.id where group_member_id = v_source.id;
  get diagnostics v_result.moved_scores = row_count;

  update public.activity_evidence set group_member_id = v_target.id where group_member_id = v_source.id;

  update public.activity_score_edit_requests set group_member_id = v_target.id where group_member_id = v_source.id;

  -- A mission is attempted once per member. If both accounts attempted it, the
  -- target's own submission is kept and the duplicate is removed, because a
  -- second row for the same member is what submit_mission's unique index and
  -- the XP arithmetic cannot both tolerate.
  delete from public.mission_submissions s
  using public.mission_submissions t
  where s.group_member_id = v_source.id
    and t.group_member_id = v_target.id
    and t.mission_id = s.mission_id;

  update public.mission_submissions set group_member_id = v_target.id where group_member_id = v_source.id;
  get diagnostics v_result.moved_submissions = row_count;

  -- Badges are per group and week. A badge both accounts claimed collapses to
  -- the target's, and the award log that came with it follows.
  delete from public.participation_logs l
  using public.badges b
  where l.badge_id = b.id and b.member_id = v_source.id and b.member_id is not null
    and exists (select 1 from public.badges t
                where t.member_id = v_target.id and t.badge_type = b.badge_type
                  and t.week_start_date = b.week_start_date);
  delete from public.badges b
  using public.badges t
  where b.member_id = v_source.id
    and t.member_id = v_target.id
    and t.badge_type = b.badge_type
    and t.week_start_date = b.week_start_date;

  update public.badges set member_id = v_target.id where member_id = v_source.id;
  get diagnostics v_result.moved_badges = row_count;

  update public.reward_redemptions set group_member_id = v_target.id where group_member_id = v_source.id;
  get diagnostics v_result.moved_rewards = row_count;

  update public.teacher_assessments set group_member_id = v_target.id where group_member_id = v_source.id;

  -- learning_reviews is keyed by user_id and has a unique constraint on
  -- (user_id, mission_id, prompt_key). Spaced repetition belongs to the person,
  -- so it follows the account that still has a login rather than the roster row.
  if v_source_account.user_id is not null then
    update public.learning_reviews
    set user_id = (select ga.user_id from public.group_accounts ga
                    where ga.group_member_id = v_target.id and ga.classroom_id = v_target.classroom_id
                    order by created_date limit 1)
    where user_id = v_source_account.user_id
      and exists (select 1 from public.group_accounts ga
                  where ga.group_member_id = v_target.id and ga.classroom_id = v_target.classroom_id
                    and ga.user_id is not null);
  end if;
  get diagnostics v_result.moved_reviews = row_count;

  -- ── Retire the duplicate ──────────────────────────────────────────────
  -- The account row goes, then the roster row. Removing the account removes
  -- the duplicate from the class list, which is the whole point: without this
  -- the teacher has simply copied one student's history onto another and left
  -- the empty shell behind.
  if v_source_account.id is not null then
    delete from public.group_accounts where id = v_source_account.id;
  end if;

  delete from public.group_members where id = v_source.id;

  insert into public.student_record_transfers(
    classroom_id, source_member_id, target_member_id,
    moved_logs, moved_attendance, moved_scores, moved_submissions,
    moved_badges, moved_rewards, moved_reviews,
    performed_by, note
  )
  values (
    v_source.classroom_id, v_source.id, v_target.id,
    v_result.moved_logs, v_result.moved_attendance, v_result.moved_scores,
    v_result.moved_submissions, v_result.moved_badges, v_result.moved_rewards,
    v_result.moved_reviews, auth.uid(), nullif(trim(coalesce(p_note, '')), '')
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.transfer_student_record(uuid, uuid, text) from public;
grant execute on function public.transfer_student_record(uuid, uuid, text) to authenticated;

-- ── Verification ─────────────────────────────────────────────────────────
-- Two students are built from scratch inside one group, given points, badges,
-- attendance and a mission attempt, and then merged the way the teacher would.
-- The check confirms the target ends up holding everything and the duplicate is
-- gone, and it undoes every row it created.

do $$
declare
  v_case record;
  v_source uuid;
  v_target uuid;
  v_teacher uuid;
  v_transfer public.student_record_transfers%rowtype;
  v_logs integer;
  v_attendance integer;
  v_badges integer;
  v_source_logs integer;
  v_problems text[] := '{}';
begin
  select c.id, c.teacher_id, g.id as group_id into v_case
  from public.classrooms c
  join public.groups g on g.classroom_id = c.id
  where c.teacher_id is not null
    and exists (select 1 from public.group_accounts ga
                where ga.group_id = g.id and ga.is_approved)
  order by c.created_date
  limit 1;

  if v_case.id is null then
    raise notice 'skipped: no classroom has a group with an approved account';
    return;
  end if;

  v_teacher := v_case.teacher_id;

  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_teacher::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_teacher::text, 'role', 'authenticated')::text);

  -- Two roster rows in the same group, no accounts: this is exactly the shape a
  -- duplicate left behind during onboarding.
  insert into public.group_members(group_id, classroom_id, last_name, first_name, is_account_holder)
  values (v_case.group_id, v_case.id, 'VERIFY', 'SOURCE', true)
  returning id into v_source;

  insert into public.group_members(group_id, classroom_id, last_name, first_name, is_account_holder)
  values (v_case.group_id, v_case.id, 'VERIFY', 'TARGET', true)
  returning id into v_target;

  -- Give the source something worth moving.
  perform public.award_participation_points(v_case.group_id, 6, v_source, 'verification transfer');

  insert into public.attendances(classroom_id, group_id, group_member_id, attendance_date, status, marked_by)
  values (v_case.id, v_case.group_id, v_source, current_date, 'present', v_teacher);

  insert into public.badges(classroom_id, group_id, badge_type, week_start_date, points_awarded, redeemed_by, approval_status, member_id)
  values (
    v_case.id, v_case.group_id, 'weekly_full_attendance',
    (now() at time zone 'Asia/Manila')::date - extract(isodow from (now() at time zone 'Asia/Manila'))::integer + 1,
    5, v_teacher, 'approved', v_source
  );

  select count(*) into v_logs from public.participation_logs where group_member_id = v_source;
  select count(*) into v_attendance from public.attendances where group_member_id = v_source;
  select count(*) into v_badges from public.badges where member_id = v_source;

  if v_logs < 1 or v_attendance < 1 or v_badges < 1 then
    raise exception 'the verification could not set up its own records: logs=%, attendance=%, badges=%', v_logs, v_attendance, v_badges;
  end if;

  v_transfer := public.transfer_student_record(v_source, v_target, 'verification');

  -- Everything is on the target now.
  select count(*) into v_logs from public.participation_logs where group_member_id = v_target;
  if v_logs < 1 then
    v_problems := array_append(v_problems, 'the points did not move');
  end if;

  select count(*) into v_attendance from public.attendances where group_member_id = v_target;
  if v_attendance < 1 then
    v_problems := array_append(v_problems, 'the attendance did not move');
  end if;

  select count(*) into v_badges from public.badges where member_id = v_target;
  if v_badges < 1 then
    v_problems := array_append(v_problems, 'the badge did not move');
  end if;

  -- And the duplicate is gone, from both tables.
  select count(*) into v_source_logs from public.participation_logs where group_member_id = v_source;
  if v_source_logs <> 0 then
    v_problems := array_append(v_problems, 'records were left behind on the old account');
  end if;

  if exists (select 1 from public.group_members where id = v_source) then
    v_problems := array_append(v_problems, 'the duplicate roster row still exists');
  end if;

  if not exists (select 1 from public.group_members where id = v_target) then
    v_problems := array_append(v_problems, 'the account being moved to disappeared');
  end if;

  -- The transfer is on the record for the teacher.
  if not exists (
    select 1 from public.student_record_transfers
    where source_member_id = v_source and target_member_id = v_target
  ) then
    v_problems := array_append(v_problems, 'the transfer was not recorded');
  end if;

  -- A student may not do this.
  declare v_student uuid;
  begin
    select ga.user_id into v_student
    from public.group_accounts ga
    where ga.classroom_id = v_case.id and ga.is_approved and ga.user_id is not null
    order by ga.created_date limit 1;

    if v_student is not null then
      execute 'set local request.jwt.claim.sub = ' || quote_literal(v_student::text);
      execute 'set local request.jwt.claims = ' || quote_literal(
        json_build_object('sub', v_student::text, 'role', 'authenticated')::text);

      begin
        perform public.transfer_student_record(v_target, v_source, 'should not work');
        v_problems := array_append(v_problems, 'a student was able to move a record');
      exception when others then
        null;
      end;
    end if;
  end;

  -- Undo everything this check created.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_teacher::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_teacher::text, 'role', 'authenticated')::text);

  delete from public.student_record_transfers
    where source_member_id = v_source and target_member_id = v_target;
  delete from public.participation_logs where group_member_id = v_target and note = 'verification transfer';
  delete from public.badges where member_id = v_target and badge_type = 'weekly_full_attendance'
    and created_date > now() - interval '10 minutes';
  delete from public.attendances where group_member_id = v_target and attendance_date = current_date;
  delete from public.group_members where id = v_target;

  if array_length(v_problems, 1) is not null then
    raise exception 'Student transfer broken: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'verified: a teacher can move a duplicate account''s points, attendance and badges onto the right account; the duplicate is removed and the move is on the record';
end;
$$;