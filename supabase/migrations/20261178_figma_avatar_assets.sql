-- Replace the retired built-in avatars with the supplied Figma asset set.
alter table public.student_avatar_preferences
  drop constraint if exists student_avatar_preferences_avatar_key_check;
alter table public.student_avatar_preferences
  add constraint student_avatar_preferences_avatar_key_check check (
    avatar_key in ('avatar-1','avatar-2','avatar-3','avatar-4','avatar-5','avatar-6','avatar-7','avatar-8','avatar-9','avatar-10','avatar-11','avatar-12')
  );

create or replace function public.set_my_student_avatar(p_avatar_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if p_avatar_key not in ('avatar-1','avatar-2','avatar-3','avatar-4','avatar-5','avatar-6','avatar-7','avatar-8','avatar-9','avatar-10','avatar-11','avatar-12') then
    raise exception 'That avatar is not available';
  end if;
  insert into public.student_avatar_preferences (user_id, avatar_key, updated_at)
  values (auth.uid(), p_avatar_key, now())
  on conflict (user_id) do update set avatar_key = excluded.avatar_key, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.get_classroom_student_avatars(p_classroom_id uuid)
returns table (group_member_id uuid, avatar_key text)
language sql security definer set search_path = public stable as $$
  select ga.group_member_id, coalesce(pref.avatar_key, 'avatar-1')
  from public.group_accounts ga
  left join public.student_avatar_preferences pref on pref.user_id = ga.user_id
  where ga.classroom_id = p_classroom_id and ga.is_approved = true and ga.group_member_id is not null
    and (public.auth_is_teacher_of(p_classroom_id) or exists (
      select 1 from public.group_accounts mine where mine.classroom_id = p_classroom_id and mine.user_id = auth.uid() and mine.is_approved = true
    ));
$$;
