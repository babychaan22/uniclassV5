-- Teachers must be able to review proof uploaded for their classroom. Students
-- may only read proof belonging to their own group.
drop policy if exists classroom_read_activity_evidence on public.activity_evidence;
create policy classroom_read_activity_evidence on public.activity_evidence for select to authenticated using (
  auth_is_teacher_of(classroom_id)
  or exists (
    select 1 from public.group_accounts ga
    where ga.user_id = auth.uid() and ga.is_approved = true and ga.group_id = activity_evidence.group_id
  )
);
