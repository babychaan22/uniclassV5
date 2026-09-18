-- Removing a student membership also removes the student's class-scoped data
-- and the roster member record. Group-level history is intentionally retained
-- because it belongs to the whole group, not to one student.

create or replace function public.remove_student_from_class(p_group_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account group_accounts%rowtype;
  v_member_id uuid;
  v_evidence_count integer := 0;
  v_deleted_member boolean := false;
begin
  select * into v_account
    from public.group_accounts
    where id = p_group_account_id
    for update;
  if not found then raise exception 'Student class membership not found'; end if;
  if not auth_is_teacher_of(v_account.classroom_id) then
    raise exception 'Only the class teacher can remove a student';
  end if;

  v_member_id := v_account.group_member_id;

  if v_member_id is not null then
    -- Remove private evidence files before their database rows.
    select count(*) into v_evidence_count
      from public.activity_evidence
      where group_member_id = v_member_id;
    delete from storage.objects
      where bucket_id = 'activity-evidence'
        and name in (
          select storage_path from public.activity_evidence
          where group_member_id = v_member_id
        );
    delete from public.activity_evidence where group_member_id = v_member_id;

    delete from public.activity_scores where group_member_id = v_member_id;
    delete from public.attendances where group_member_id = v_member_id;
    delete from public.teacher_assessments where group_member_id = v_member_id;
    delete from public.participation_logs where group_member_id = v_member_id;
    delete from public.badges where member_id = v_member_id;
    update public.qr_codes set used_by_member_id = null where used_by_member_id = v_member_id;
  end if;

  -- Learning reviews are user- and class-scoped, unlike group submissions.
  delete from public.learning_reviews
    where user_id = v_account.user_id
      and classroom_id = v_account.classroom_id;

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
    'evidenceFilesDeleted', v_evidence_count
  );
end;
$$;

revoke all on function public.remove_student_from_class(uuid) from public;
grant execute on function public.remove_student_from_class(uuid) to authenticated;
