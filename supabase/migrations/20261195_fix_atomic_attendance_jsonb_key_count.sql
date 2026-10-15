-- The hosted PostgreSQL runtime does not provide jsonb_object_length().
-- Count the submitted keys explicitly so the group-attendance transaction
-- works consistently in Supabase.

create or replace function public.submit_group_attendance(
  p_group_id uuid,
  p_attendance_date date,
  p_statuses jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_classroom_id uuid;
  v_member_count integer;
  v_status_count integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in before submitting attendance';
  end if;

  if p_attendance_date is distinct from timezone('Asia/Manila', now())::date then
    raise exception 'Attendance may only be submitted for today';
  end if;

  if jsonb_typeof(p_statuses) <> 'object' then
    raise exception 'Attendance statuses must be supplied for the whole group';
  end if;

  select g.classroom_id into v_classroom_id
  from public.groups g
  where g.id = p_group_id;

  if v_classroom_id is null or public.auth_rep_group_id(v_classroom_id) is distinct from p_group_id then
    raise exception 'Only the approved representative for this group may submit attendance'
      using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_group_id::text || ':' || p_attendance_date::text, 0));

  if exists (
    select 1 from public.attendances a
    where a.group_id = p_group_id and a.attendance_date = p_attendance_date
  ) then
    raise exception 'Attendance has already been submitted for this group';
  end if;

  select count(*) into v_member_count
  from public.group_members gm
  where gm.group_id = p_group_id and coalesce(gm.is_transferred, false) = false;

  select count(*) into v_status_count
  from jsonb_object_keys(p_statuses);

  if v_status_count <> v_member_count
     or exists (
       select 1 from public.group_members gm
       where gm.group_id = p_group_id
         and coalesce(gm.is_transferred, false) = false
         and not (p_statuses ? gm.id::text)
     )
     or exists (
       select 1 from jsonb_each_text(p_statuses) as status(member_id, value)
       where value not in ('present', 'absent')
     ) then
    raise exception 'Provide one present or absent status for every active group member';
  end if;

  insert into public.attendances (
    classroom_id, group_id, group_member_id, attendance_date, status, marked_by
  )
  select v_classroom_id, p_group_id, gm.id, p_attendance_date,
         p_statuses ->> gm.id::text, auth.uid()
  from public.group_members gm
  where gm.group_id = p_group_id and coalesce(gm.is_transferred, false) = false;

  return jsonb_build_object('saved', true, 'recorded_count', v_member_count);
end;
$$;

revoke all on function public.submit_group_attendance(uuid, date, jsonb) from public;
grant execute on function public.submit_group_attendance(uuid, date, jsonb) to authenticated;
