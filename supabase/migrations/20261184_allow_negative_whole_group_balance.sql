-- A behavior deduction may take the shared group pool below zero. Only later
-- group-owned rewards and scans repay that balance; personal student points are
-- never consulted or changed by this function.

create or replace function public.apply_behavior_penalty(
  p_group_id uuid,
  p_points numeric,
  p_note text default null
)
returns public.participation_logs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_group public.groups%rowtype;
  v_result public.participation_logs%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_group from public.groups where id = p_group_id;
  if not found then raise exception 'Invalid group'; end if;
  if not auth_is_teacher_of(v_group.classroom_id) then
    raise exception 'Only the classroom teacher may apply a behavior penalty';
  end if;
  if p_points is null or p_points <= 0 or p_points > 100 then
    raise exception 'Enter between 1 and 100 points';
  end if;

  insert into public.participation_logs(
    group_id, classroom_id, group_member_id, points_awarded,
    event_type, multiplier, recipient_type, note
  ) values (
    p_group_id, v_group.classroom_id, null, -abs(p_points),
    'behavior_penalty', 1, 'group',
    nullif(trim(coalesce(p_note, '')), '')
  ) returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.apply_behavior_penalty(uuid, numeric, text) from public;
grant execute on function public.apply_behavior_penalty(uuid, numeric, text) to authenticated;
