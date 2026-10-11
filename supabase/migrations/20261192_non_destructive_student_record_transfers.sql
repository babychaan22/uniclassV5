-- A transferred learner stays available for audit, but loses classroom access.
-- Historical rows are reassigned wherever doing so cannot overwrite a record
-- already held by the destination. Conflicts remain on the archived source and
-- are recorded in the transfer audit rather than being deleted.

alter table public.group_members
  add column if not exists is_transferred boolean not null default false,
  add column if not exists transferred_to_member_id uuid references public.group_members(id) on delete set null,
  add column if not exists transferred_at timestamptz;

alter table public.group_accounts
  add column if not exists transferred_to_member_id uuid references public.group_members(id) on delete set null,
  add column if not exists transferred_at timestamptz;

alter table public.student_record_transfers
  add column if not exists source_member_name text,
  add column if not exists target_member_name text,
  add column if not exists source_account_id uuid,
  add column if not exists target_account_id uuid,
  add column if not exists source_blocked_at timestamptz,
  add column if not exists preserved_conflicts jsonb not null default '{}'::jsonb;

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
  v_target_account public.group_accounts%rowtype;
  v_result public.student_record_transfers%rowtype;
  v_attendance_conflicts integer := 0;
  v_score_conflicts integer := 0;
  v_submission_conflicts integer := 0;
  v_badge_conflicts integer := 0;
  v_log_conflicts integer := 0;
begin
  select * into v_source from public.group_members where id = p_source_member_id for update;
  if not found then raise exception 'The source student no longer exists'; end if;
  select * into v_target from public.group_members where id = p_target_member_id for update;
  if not found then raise exception 'The destination student no longer exists'; end if;
  if v_source.id = v_target.id then raise exception 'Choose two different students'; end if;
  if v_source.classroom_id <> v_target.classroom_id then raise exception 'Both students must be in the same class'; end if;
  if v_source.is_transferred then raise exception 'This source record has already been transferred'; end if;
  if v_target.is_transferred then raise exception 'Choose an active student as the destination'; end if;
  if not auth_is_teacher_of(v_source.classroom_id) then raise exception 'Only the classroom teacher may move a student record'; end if;

  select * into v_source_account from public.group_accounts
    where group_member_id = v_source.id and classroom_id = v_source.classroom_id order by created_date limit 1;
  select * into v_target_account from public.group_accounts
    where group_member_id = v_target.id and classroom_id = v_target.classroom_id order by created_date limit 1;

  select count(*) into v_log_conflicts from public.participation_logs l
  where l.group_member_id = v_source.id and exists (
    select 1 from public.participation_logs t where t.group_member_id = v_target.id
      and t.created_date = l.created_date and t.event_type = l.event_type and t.points_awarded = l.points_awarded
  );
  update public.participation_logs l set group_member_id = v_target.id
  where l.group_member_id = v_source.id and not exists (
    select 1 from public.participation_logs t where t.group_member_id = v_target.id
      and t.created_date = l.created_date and t.event_type = l.event_type and t.points_awarded = l.points_awarded
  );
  get diagnostics v_result.moved_logs = row_count;

  select count(*) into v_attendance_conflicts from public.attendances a
  where a.group_member_id = v_source.id and exists (
    select 1 from public.attendances t where t.group_member_id = v_target.id and t.attendance_date = a.attendance_date
  );
  update public.attendances a set group_member_id = v_target.id
  where a.group_member_id = v_source.id and not exists (
    select 1 from public.attendances t where t.group_member_id = v_target.id and t.attendance_date = a.attendance_date
  );
  get diagnostics v_result.moved_attendance = row_count;

  select count(*) into v_score_conflicts from public.activity_scores s
  where s.group_member_id = v_source.id and exists (
    select 1 from public.activity_scores t where t.group_member_id = v_target.id and t.activity_id = s.activity_id
  );
  update public.activity_scores s set group_member_id = v_target.id
  where s.group_member_id = v_source.id and not exists (
    select 1 from public.activity_scores t where t.group_member_id = v_target.id and t.activity_id = s.activity_id
  );
  get diagnostics v_result.moved_scores = row_count;

  update public.activity_evidence set group_member_id = v_target.id where group_member_id = v_source.id;
  update public.activity_score_edit_requests set group_member_id = v_target.id where group_member_id = v_source.id;

  select count(*) into v_submission_conflicts from public.mission_submissions s
  where s.group_member_id = v_source.id and exists (
    select 1 from public.mission_submissions t where t.group_member_id = v_target.id and t.mission_id = s.mission_id
  );
  update public.mission_submissions s set group_member_id = v_target.id
  where s.group_member_id = v_source.id and not exists (
    select 1 from public.mission_submissions t where t.group_member_id = v_target.id and t.mission_id = s.mission_id
  );
  get diagnostics v_result.moved_submissions = row_count;

  select count(*) into v_badge_conflicts from public.badges b
  where b.member_id = v_source.id and exists (
    select 1 from public.badges t where t.member_id = v_target.id and t.badge_type = b.badge_type and t.week_start_date = b.week_start_date
  );
  update public.badges b set member_id = v_target.id
  where b.member_id = v_source.id and not exists (
    select 1 from public.badges t where t.member_id = v_target.id and t.badge_type = b.badge_type and t.week_start_date = b.week_start_date
  );
  get diagnostics v_result.moved_badges = row_count;

  update public.reward_redemptions set group_member_id = v_target.id where group_member_id = v_source.id;
  get diagnostics v_result.moved_rewards = row_count;
  update public.teacher_assessments set group_member_id = v_target.id where group_member_id = v_source.id;

  if v_source_account.user_id is not null and v_target_account.user_id is not null then
    update public.learning_reviews r set user_id = v_target_account.user_id
    where r.user_id = v_source_account.user_id and not exists (
      select 1 from public.learning_reviews t where t.user_id = v_target_account.user_id
        and t.mission_id = r.mission_id and t.prompt_key = r.prompt_key
    );
    get diagnostics v_result.moved_reviews = row_count;
  end if;

  -- Do not delete the old identity. Blocking approval removes its classroom
  -- access while the relationship remains inspectable by the teacher.
  update public.group_accounts
    set is_approved = false, is_representative = false,
        transferred_to_member_id = v_target.id, transferred_at = now()
  where group_member_id = v_source.id and classroom_id = v_source.classroom_id;
  update public.group_members
    set is_transferred = true, transferred_to_member_id = v_target.id, transferred_at = now()
  where id = v_source.id;

  insert into public.student_record_transfers(
    classroom_id, source_member_id, target_member_id, moved_logs, moved_attendance,
    moved_scores, moved_submissions, moved_badges, moved_rewards, moved_reviews,
    performed_by, note, source_member_name, target_member_name, source_account_id,
    target_account_id, source_blocked_at, preserved_conflicts
  ) values (
    v_source.classroom_id, v_source.id, v_target.id, coalesce(v_result.moved_logs, 0),
    coalesce(v_result.moved_attendance, 0), coalesce(v_result.moved_scores, 0),
    coalesce(v_result.moved_submissions, 0), coalesce(v_result.moved_badges, 0),
    coalesce(v_result.moved_rewards, 0), coalesce(v_result.moved_reviews, 0), auth.uid(),
    nullif(trim(coalesce(p_note, '')), ''), concat_ws(', ', v_source.last_name, v_source.first_name),
    concat_ws(', ', v_target.last_name, v_target.first_name), v_source_account.id,
    v_target_account.id, now(), jsonb_build_object('point_entries', v_log_conflicts,
    'attendance', v_attendance_conflicts, 'scores', v_score_conflicts,
    'missions', v_submission_conflicts, 'badges', v_badge_conflicts)
  ) returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.transfer_student_record(uuid, uuid, text) from public;
grant execute on function public.transfer_student_record(uuid, uuid, text) to authenticated;
