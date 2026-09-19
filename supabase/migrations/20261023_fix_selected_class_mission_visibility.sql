-- Explicit mission target_classroom_ids take precedence over the class where
-- the teacher happened to create the mission. Keep the origin-class check
-- only for legacy targeted missions that have no stored class list.
create or replace function public.get_student_missions(p_classroom_id uuid)
returns setof jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.group_accounts
    where user_id=auth.uid() and classroom_id=p_classroom_id and is_approved=true
  ) then raise exception 'Approved student account required'; end if;
  return query
  select to_jsonb(m) - 'answer_key'
  from public.missions m
  where (
      m.is_active
      or exists (
        select 1 from public.mission_submissions s
        join public.group_accounts ga on ga.group_id=s.group_id
        where s.mission_id=m.id and ga.user_id=auth.uid() and ga.classroom_id=p_classroom_id and ga.is_approved=true
      )
    )
    and (
      m.applies_to_all_classes
      or (cardinality(m.target_classroom_ids)>0 and p_classroom_id=any(m.target_classroom_ids))
      or (not m.applies_to_all_classes and cardinality(m.target_classroom_ids)=0 and m.classroom_id=p_classroom_id)
    )
    and exists (select 1 from public.classrooms c where c.id=p_classroom_id and c.teacher_id=m.created_by);
end;
$$;

revoke all on function public.get_student_missions(uuid) from public;
grant execute on function public.get_student_missions(uuid) to authenticated;
