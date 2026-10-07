-- Behavior penalties are ledger deductions.  Persist them as negative values
-- so database consumers, exports, and all app readers agree on their sign.

alter table public.participation_logs
  drop constraint if exists participation_points_nonnegative;

-- Normalize older penalties too. All existing readers use a sign-safe
-- conversion, so this keeps their displayed totals unchanged while making the
-- stored ledger value truthful.
update public.participation_logs
set points_awarded = -abs(points_awarded)
where event_type = 'behavior_penalty'
  and points_awarded > 0;

create or replace function public.apply_behavior_penalty(
  p_group_id uuid,
  p_points numeric,
  p_note text default null
)
returns public.participation_logs
language plpgsql security definer set search_path = public as $$
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

  -- One group-scoped record appears in the shared history of every member.
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
