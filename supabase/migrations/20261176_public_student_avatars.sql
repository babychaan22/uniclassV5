-- A student's chosen avatar is a classroom-facing cosmetic. Keep it separate
-- from private auth metadata so classmates can render the same avatar safely.
create table if not exists public.student_avatar_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  avatar_key text not null,
  updated_at timestamptz not null default now(),
  constraint student_avatar_preferences_avatar_key_check check (
    avatar_key in ('avatar-1','avatar-2','avatar-3','avatar-4','avatar-5','avatar-6','avatar-7','avatar-8','avatar-9','avatar-10','avatar-11','avatar-12')
  )
);

alter table public.student_avatar_preferences enable row level security;

drop policy if exists "student_manage_own_avatar_preference" on public.student_avatar_preferences;
create policy "student_manage_own_avatar_preference"
  on public.student_avatar_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.set_my_student_avatar(p_avatar_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if p_avatar_key not in ('avatar-1','avatar-2','avatar-3','avatar-4','avatar-5','avatar-6','avatar-7','avatar-8','avatar-9','avatar-10','avatar-11','avatar-12') then
    raise exception 'That avatar is not available';
  end if;

  insert into public.student_avatar_preferences (user_id, avatar_key, updated_at)
  values (auth.uid(), p_avatar_key, now())
  on conflict (user_id) do update
    set avatar_key = excluded.avatar_key, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.set_my_student_avatar(text) from public;
grant execute on function public.set_my_student_avatar(text) to authenticated;

-- Only people in the same classroom (and its teacher) can retrieve the small
-- public-profile projection needed to render classroom rosters and rankings.
create or replace function public.get_classroom_student_avatars(p_classroom_id uuid)
returns table (group_member_id uuid, avatar_key text)
language sql
security definer
set search_path = public
stable
as $$
  select ga.group_member_id, coalesce(pref.avatar_key, 'avatar-1')
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
