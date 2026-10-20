-- A teacher removing a learner should remove every individual record owned by
-- that learner in this classroom, without touching their Auth identity or any
-- enrolment in another classroom. Group-wide history remains intact.

create or replace function public.remove_student_from_class(p_group_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.group_accounts%rowtype;
  v_member_id uuid;
  v_evidence_paths jsonb := '[]'::jsonb;
  v_evidence_count integer := 0;
  v_deleted_member boolean := false;
  v_removed_submissions integer := 0;
  v_removed_rewards integer := 0;
begin
  select * into v_account from public.group_accounts
  where id = p_group_account_id for update;
  if not found then raise exception 'Student class membership not found'; end if;
  if not public.auth_is_teacher_of(v_account.classroom_id) then
    raise exception 'Only the class teacher can remove a student';
  end if;

  v_member_id := v_account.group_member_id;

  if v_member_id is not null then
    select count(*), coalesce(jsonb_agg(storage_path), '[]'::jsonb)
      into v_evidence_count, v_evidence_paths
      from public.activity_evidence where group_member_id = v_member_id;

    -- Remove dependent review rows explicitly, so no old correction request
    -- is left visible if a learner later joins the class again.
    delete from public.activity_score_edit_requests where group_member_id = v_member_id;
    delete from public.activity_evidence where group_member_id = v_member_id;
    delete from public.activity_scores where group_member_id = v_member_id;
    delete from public.attendances where group_member_id = v_member_id;
    delete from public.teacher_assessments where group_member_id = v_member_id;
    delete from public.participation_logs where group_member_id = v_member_id;
    delete from public.badges where member_id = v_member_id;
    delete from public.foundation_question_attempts where group_member_id = v_member_id;
    delete from public.mission_submissions where group_member_id = v_member_id;
    get diagnostics v_removed_submissions = row_count;
    update public.qr_codes set used_by_member_id = null where used_by_member_id = v_member_id;
  end if;

  delete from public.personal_reward_claims
    where classroom_id = v_account.classroom_id
      and (group_member_id = v_member_id or user_id = v_account.user_id);
  get diagnostics v_removed_rewards = row_count;

  delete from public.learning_reviews
    where user_id = v_account.user_id and classroom_id = v_account.classroom_id;
  delete from public.app_notifications
    where recipient_user_id = v_account.user_id and classroom_id = v_account.classroom_id;

  delete from public.group_accounts where id = v_account.id;

  if v_member_id is not null and not exists (
    select 1 from public.group_accounts where group_member_id = v_member_id
  ) then
    delete from public.group_members where id = v_member_id;
    v_deleted_member := true;
  elsif v_member_id is not null then
    update public.group_members set is_account_holder = false where id = v_member_id;
  end if;

  return jsonb_build_object(
    'removed', true,
    'classroomId', v_account.classroom_id,
    'userId', v_account.user_id,
    'groupMemberId', v_member_id,
    'rosterMemberDeleted', v_deleted_member,
    'evidenceFilesDeleted', v_evidence_count,
    'evidencePaths', v_evidence_paths,
    'missionSubmissionsDeleted', v_removed_submissions,
    'rewardClaimsDeleted', v_removed_rewards
  );
end;
$$;

create or replace function public.remove_roster_member(p_group_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.group_members%rowtype;
  v_account public.group_accounts%rowtype;
  v_paths jsonb := '[]'::jsonb;
  v_removed_submissions integer := 0;
begin
  select * into v_member from public.group_members where id = p_group_member_id for update;
  if not found then raise exception 'Roster member not found'; end if;
  if not public.auth_is_teacher_of(v_member.classroom_id) then
    raise exception 'Only the class teacher can remove a roster member';
  end if;

  select * into v_account from public.group_accounts where group_member_id = v_member.id limit 1;
  if found then return public.remove_student_from_class(v_account.id); end if;

  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_paths
    from public.activity_evidence where group_member_id = v_member.id;
  delete from public.activity_score_edit_requests where group_member_id = v_member.id;
  delete from public.activity_evidence where group_member_id = v_member.id;
  delete from public.activity_scores where group_member_id = v_member.id;
  delete from public.attendances where group_member_id = v_member.id;
  delete from public.teacher_assessments where group_member_id = v_member.id;
  delete from public.participation_logs where group_member_id = v_member.id;
  delete from public.badges where member_id = v_member.id;
  delete from public.foundation_question_attempts where group_member_id = v_member.id;
  delete from public.mission_submissions where group_member_id = v_member.id;
  get diagnostics v_removed_submissions = row_count;
  update public.qr_codes set used_by_member_id = null where used_by_member_id = v_member.id;
  delete from public.group_members where id = v_member.id;
  return jsonb_build_object(
    'removed', true,
    'rosterMemberDeleted', true,
    'evidencePaths', v_paths,
    'missionSubmissionsDeleted', v_removed_submissions
  );
end;
$$;

revoke all on function public.remove_student_from_class(uuid) from public;
revoke all on function public.remove_roster_member(uuid) from public;
grant execute on function public.remove_student_from_class(uuid) to authenticated;
grant execute on function public.remove_roster_member(uuid) to authenticated;
