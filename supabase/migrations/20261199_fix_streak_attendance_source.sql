-- The application stores attendance rows in public.attendances.  The original
-- streak helper used the singular name, which caused every consumer of the
-- personal-reward dashboard (including Student Missions) to fail at runtime.

create or replace function public.get_personal_style_streak(
  p_classroom_id uuid,
  p_group_member_id uuid
)
returns table(streak_days integer, streak_started_on date)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_class_days text[];
  v_cursor date := (now() at time zone 'Asia/Manila')::date;
  v_streak integer := 0;
  v_start date := null;
  v_weekday text;
begin
  select coalesce(nullif(c.class_days, array[]::text[]), array['1','2','3','4','5']::text[])
    into v_class_days
  from public.classrooms c
  where c.id = p_classroom_id;

  if v_class_days is null then
    return query select 0, null::date;
    return;
  end if;

  loop
    v_weekday := extract(isodow from v_cursor)::text;
    if not (v_weekday = any(v_class_days)) then
      v_cursor := v_cursor - 1;
      continue;
    end if;

    if exists (
      select 1 from public.attendances a
      where a.classroom_id = p_classroom_id
        and a.group_member_id = p_group_member_id
        and a.status = 'present'
        and a.attendance_date = v_cursor
    ) or exists (
      select 1 from public.activity_scores s
      where s.classroom_id = p_classroom_id
        and s.group_member_id = p_group_member_id
        and s.created_date::date = v_cursor
    ) or exists (
      select 1 from public.mission_submissions m
      where m.classroom_id = p_classroom_id
        and m.group_member_id = p_group_member_id
        and m.created_date::date = v_cursor
    ) then
      v_streak := v_streak + 1;
      v_start := v_cursor;
      v_cursor := v_cursor - 1;
    else
      exit;
    end if;
  end loop;

  return query select v_streak, v_start;
end;
$$;

revoke all on function public.get_personal_style_streak(uuid, uuid) from public;
