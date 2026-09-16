drop policy if exists student_upload_activity_evidence on public.activity_evidence;
create policy student_upload_activity_evidence on public.activity_evidence for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and auth_in_classroom(classroom_id)
    and (exists (select 1 from public.group_accounts ga where ga.user_id = auth.uid() and ga.group_id = activity_evidence.group_id and ga.is_approved = true and ga.is_representative = true)
      or exists (select 1 from public.group_accounts ga where ga.user_id = auth.uid() and ga.group_member_id = activity_evidence.group_member_id and ga.group_id = activity_evidence.group_id and ga.is_approved = true))
  );
