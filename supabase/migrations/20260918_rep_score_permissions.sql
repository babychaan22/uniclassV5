-- Representatives may submit scores for members of their own group.
drop policy if exists rep_insert_activity_scores on public.activity_scores;
create policy rep_insert_activity_scores on public.activity_scores for insert to authenticated
  with check (
    auth_rep_group_id(classroom_id) = group_id
    and exists (select 1 from public.group_members gm where gm.id = group_member_id and gm.group_id = activity_scores.group_id)
  );

drop policy if exists rep_update_activity_scores on public.activity_scores;
create policy rep_update_activity_scores on public.activity_scores for update to authenticated
  using (auth_rep_group_id(classroom_id) = group_id)
  with check (auth_rep_group_id(classroom_id) = group_id);
