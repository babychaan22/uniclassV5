-- Clean up roster records left behind by the previous account-only removal flow.
-- Representative-created, not-yet-claimed members are is_account_holder=false
-- and are intentionally preserved.

create temp table _orphaned_student_members on commit drop as
  select gm.id
  from public.group_members gm
  where gm.is_account_holder = true
    and not exists (
      select 1 from public.group_accounts ga where ga.group_member_id = gm.id
    );

delete from storage.objects
where bucket_id = 'activity-evidence'
  and name in (
    select ae.storage_path
    from public.activity_evidence ae
    where ae.group_member_id in (select id from _orphaned_student_members)
  );

delete from public.activity_evidence
where group_member_id in (select id from _orphaned_student_members);
delete from public.activity_scores
where group_member_id in (select id from _orphaned_student_members);
delete from public.attendances
where group_member_id in (select id from _orphaned_student_members);
delete from public.teacher_assessments
where group_member_id in (select id from _orphaned_student_members);
delete from public.participation_logs
where group_member_id in (select id from _orphaned_student_members);
delete from public.badges
where member_id in (select id from _orphaned_student_members);
update public.qr_codes
set used_by_member_id = null
where used_by_member_id in (select id from _orphaned_student_members);

delete from public.group_members
where id in (select id from _orphaned_student_members);
