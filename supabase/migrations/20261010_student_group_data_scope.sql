-- Students may work with their own group, but must not download other groups'
-- academic records. Rankings are supplied separately as anonymous aggregates.
drop policy if exists "student_read_group_members" on public.group_members;
create policy "student_read_group_members" on public.group_members for select to authenticated using (
  exists (select 1 from public.group_accounts ga where ga.user_id=auth.uid() and ga.is_approved=true and ga.group_id=group_members.group_id)
);
drop policy if exists "student_read_group_accounts" on public.group_accounts;
create policy "student_read_group_accounts" on public.group_accounts for select to authenticated using (user_id=auth.uid());

drop policy if exists "student_read_activity_scores" on public.activity_scores;
create policy "student_read_activity_scores" on public.activity_scores for select to authenticated using (
  exists (select 1 from public.group_accounts ga where ga.user_id=auth.uid() and ga.is_approved=true and ga.group_id=activity_scores.group_id)
);
drop policy if exists "student_read_attendances" on public.attendances;
create policy "student_read_attendances" on public.attendances for select to authenticated using (
  exists (select 1 from public.group_accounts ga where ga.user_id=auth.uid() and ga.is_approved=true and ga.group_id=attendances.group_id)
);
drop policy if exists "student_read_assessments" on public.teacher_assessments;
create policy "student_read_assessments" on public.teacher_assessments for select to authenticated using (
  exists (select 1 from public.group_accounts ga where ga.user_id=auth.uid() and ga.is_approved=true and ga.group_id=teacher_assessments.group_id)
);
drop policy if exists "student_read_participation_logs" on public.participation_logs;
create policy "student_read_participation_logs" on public.participation_logs for select to authenticated using (
  exists (select 1 from public.group_accounts ga where ga.user_id=auth.uid() and ga.is_approved=true and ga.group_id=participation_logs.group_id)
);
drop policy if exists "student_read_submissions" on public.mission_submissions;
create policy "student_read_submissions" on public.mission_submissions for select to authenticated using (
  exists (select 1 from public.group_accounts ga where ga.user_id=auth.uid() and ga.is_approved=true and ga.group_id=mission_submissions.group_id)
);

create or replace function public.get_classroom_group_leaderboard(p_classroom_id uuid)
returns setof jsonb language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not exists (select 1 from public.group_accounts where user_id=auth.uid() and classroom_id=p_classroom_id and is_approved=true) then
    raise exception 'Approved student account required';
  end if;
  return query
  select jsonb_build_object(
    'group_id', g.id,
    'group_number', g.group_number,
    'points', coalesce((select sum(case when l.event_type='behavior_penalty' then -abs(coalesce(l.points_awarded,0)) else coalesce(l.points_awarded,0) end) from public.participation_logs l where l.group_id=g.id),0),
    'missions_done', (select count(*) from public.mission_submissions s where s.group_id=g.id)
  ) from public.groups g where g.classroom_id=p_classroom_id order by 1;
end;
$$;
revoke all on function public.get_classroom_group_leaderboard(uuid) from public;
grant execute on function public.get_classroom_group_leaderboard(uuid) to authenticated;
