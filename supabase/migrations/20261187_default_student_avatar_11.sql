-- Learners who have not spent an avatar style choice use Avatar 11 everywhere.
-- Existing saved preferences remain untouched.
create or replace function public.get_classroom_student_avatars(p_classroom_id uuid)
returns table (group_member_id uuid, avatar_key text)
language sql
security definer
set search_path = public
stable
as $$
  select ga.group_member_id, coalesce(pref.avatar_key, 'avatar-11')
  from public.group_accounts ga
  left join public.student_avatar_preferences pref on pref.user_id = ga.user_id
  where ga.classroom_id = p_classroom_id
    and ga.is_approved = true
    and ga.group_member_id is not null
    and (
      public.auth_is_teacher_of(p_classroom_id)
      or exists (
        select 1 from public.group_accounts mine
        where mine.classroom_id = p_classroom_id
          and mine.user_id = auth.uid()
          and mine.is_approved = true
      )
    );
$$;

revoke all on function public.get_classroom_student_avatars(uuid) from public;
grant execute on function public.get_classroom_student_avatars(uuid) to authenticated;
