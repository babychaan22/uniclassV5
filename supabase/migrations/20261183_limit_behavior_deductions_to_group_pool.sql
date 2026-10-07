-- Behavior deductions are a group-pool adjustment only. They cannot reduce a
-- learner's personally earned points, ranking, or participation grade.

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
  v_group_pool numeric := 0;
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

  select coalesce(sum(
    case when l.event_type = 'behavior_penalty'
      then -abs(coalesce(l.points_awarded, 0))
      else coalesce(l.points_awarded, 0)
    end
  ), 0) into v_group_pool
  from public.participation_logs l
  where l.group_id = v_group.id
    and l.classroom_id = v_group.classroom_id
    and l.group_member_id is null;

  if p_points > greatest(0, v_group_pool) then
    raise exception 'Only % whole-group point(s) are available to deduct', greatest(0, v_group_pool);
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

create or replace function public.get_classroom_individual_leaderboard(
  p_classroom_id uuid,
  p_limit integer default 12
)
returns setof jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 12), 100));
begin
  if auth.uid() is null or not exists (
    select 1 from public.group_accounts ga
    where ga.user_id = auth.uid()
      and ga.classroom_id = p_classroom_id
      and ga.is_approved = true
  ) then
    raise exception 'Approved student account required';
  end if;

  return query
  select jsonb_build_object(
    'member_id', ranked.id,
    'last_name', ranked.last_name,
    'first_name', ranked.first_name,
    'points', ranked.points
  )
  from (
    select gm.id, gm.last_name, gm.first_name,
      coalesce(sum(coalesce(l.points_awarded, 0)), 0) as points
    from public.group_members gm
    join public.groups g on g.id = gm.group_id and g.classroom_id = p_classroom_id
    left join public.participation_logs l
      on l.group_member_id = gm.id
      and l.classroom_id = p_classroom_id
      and l.event_type <> 'behavior_penalty'
    group by gm.id, gm.last_name, gm.first_name
    order by points desc, lower(gm.last_name), lower(gm.first_name), gm.id
    limit v_limit
  ) ranked;
end;
$$;

revoke all on function public.apply_behavior_penalty(uuid, numeric, text) from public;
grant execute on function public.apply_behavior_penalty(uuid, numeric, text) to authenticated;
revoke all on function public.get_classroom_individual_leaderboard(uuid, integer) from public;
grant execute on function public.get_classroom_individual_leaderboard(uuid, integer) to authenticated;
