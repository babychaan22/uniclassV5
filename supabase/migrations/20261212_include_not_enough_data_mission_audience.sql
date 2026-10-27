-- A newly enrolled learner may not yet have enough records for a calculated
-- learning status.  When a teacher selects the three standard statuses, that
-- means the mission is for the whole selected class, so include these learners
-- as well instead of hiding the work from them.

create or replace function public.normalize_mission_target_statuses()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.target_statuses := coalesce(new.target_statuses, array['On Track', 'Developing', 'At Risk', 'Not enough data']);
  if new.target_statuses @> array['On Track', 'Developing', 'At Risk']
     and not new.target_statuses @> array['Not enough data'] then
    new.target_statuses := array_append(new.target_statuses, 'Not enough data');
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_mission_target_statuses on public.missions;
create trigger normalize_mission_target_statuses
  before insert or update of target_statuses on public.missions
  for each row execute function public.normalize_mission_target_statuses();

-- Preserve the intended "all learners" audience for already-published work.
update public.missions
set target_statuses = array_append(target_statuses, 'Not enough data')
where target_statuses @> array['On Track', 'Developing', 'At Risk']
  and not target_statuses @> array['Not enough data'];

create or replace function public.get_student_missions(p_classroom_id uuid)
returns setof jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_member_id uuid;
  v_status text;
begin
  select group_member_id into v_member_id from public.group_accounts
  where user_id = auth.uid() and classroom_id = p_classroom_id and is_approved = true
  order by created_date limit 1;
  if v_member_id is null then raise exception 'Approved student account required'; end if;
  v_status := public.student_mission_status(p_classroom_id, v_member_id);

  return query
  select public.sanitize_mission_for_student(m)
  from public.missions m
  where (
      ((m.is_active and m.archived_at is null)
        or exists (select 1 from public.mission_submissions s where s.mission_id = m.id and s.group_member_id = v_member_id))
    )
    and (
      m.applies_to_all_classes
      or (cardinality(m.target_classroom_ids) > 0 and p_classroom_id = any(m.target_classroom_ids))
      or (not m.applies_to_all_classes and cardinality(m.target_classroom_ids) = 0 and m.classroom_id = p_classroom_id)
    )
    and (
      (m.mission_source = 'daily_foundation' and m.classroom_id is null and m.approval_status = 'approved'
       and coalesce((select public.foundation_class_serves_power_up(c.subject) from public.classrooms c where c.id = p_classroom_id), false))
      or exists (select 1 from public.classrooms c where c.id = p_classroom_id and c.teacher_id = m.created_by)
    )
    and (m.mission_source = 'daily_foundation'
      or exists (select 1 from public.mission_submissions s where s.mission_id = m.id and s.group_member_id = v_member_id)
      or coalesce(m.target_statuses, array['On Track', 'Developing', 'At Risk', 'Not enough data']) @> array[v_status]);
end;
$$;

create or replace function public.enforce_student_mission_submission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mission public.missions%rowtype;
  v_account public.group_accounts%rowtype;
  v_status text;
begin
  select * into v_mission from public.missions where id = new.mission_id;
  if not found then raise exception 'Mission not found'; end if;
  if auth_is_teacher_of(new.classroom_id) then return new; end if;

  select * into v_account from public.group_accounts
  where user_id = auth.uid() and group_id = new.group_id and group_member_id = new.group_member_id
    and classroom_id = new.classroom_id and is_approved = true limit 1;
  if not found then raise exception 'Approved student account required'; end if;
  if v_mission.formative_type = 'manual' then
    raise exception 'Teacher-graded missions cannot be self-submitted';
  end if;
  if v_mission.mission_source <> 'daily_foundation' then
    v_status := public.student_mission_status(new.classroom_id, new.group_member_id);
    if not (coalesce(v_mission.target_statuses, array['On Track', 'Developing', 'At Risk', 'Not enough data']) @> array[v_status]) then
      raise exception 'This mission is not assigned to your current learning status';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.get_student_missions(uuid) from public;
grant execute on function public.get_student_missions(uuid) to authenticated;
