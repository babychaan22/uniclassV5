-- Every mission can be filed away and restored. Archiving preserves the row,
-- submissions, and XP history; it only removes a mission from new student work.
-- A Daily Power-Up is shared, so only a teacher with a Mathematics class may
-- archive or restore it. This affects that shared Power-Up for the current day.

create or replace function public.archive_mission(
  p_mission_id uuid,
  p_archived boolean default true
)
returns public.missions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m public.missions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_m
  from public.missions
  where id = p_mission_id
  for update;

  if not found then
    raise exception 'Mission not found';
  end if;

  if v_m.mission_source = 'daily_foundation' then
    if v_m.classroom_id is not null or not exists (
      select 1
      from public.classrooms c
      where c.teacher_id = auth.uid()
        and public.foundation_class_serves_power_up(c.subject)
    ) then
      raise exception 'Only a Mathematics teacher can archive a Daily Power-Up';
    end if;
  elsif v_m.created_by is distinct from auth.uid() then
    raise exception 'You can only archive missions you created';
  end if;

  update public.missions
  set archived_at = case when p_archived then now() else null end
  where id = p_mission_id
  returning * into v_m;

  return v_m;
end;
$$;

revoke all on function public.archive_mission(uuid, boolean) from public;
grant execute on function public.archive_mission(uuid, boolean) to authenticated;
