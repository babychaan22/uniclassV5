-- 20261161 — return the class-wide individual leaderboard without exposing
-- every raw participation log to every student.

create index if not exists idx_participation_logs_classroom_member
  on public.participation_logs(classroom_id, group_member_id);

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
    select 1
    from public.group_accounts ga
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
    select
      gm.id,
      gm.last_name,
      gm.first_name,
      coalesce(sum(
        case when l.event_type = 'behavior_penalty'
          then -abs(coalesce(l.points_awarded, 0))
          else coalesce(l.points_awarded, 0)
        end
      ), 0) as points
    from public.group_members gm
    join public.groups g on g.id = gm.group_id and g.classroom_id = p_classroom_id
    left join public.participation_logs l
      on l.group_member_id = gm.id and l.classroom_id = p_classroom_id
    group by gm.id, gm.last_name, gm.first_name
    order by points desc, lower(gm.last_name), lower(gm.first_name), gm.id
    limit v_limit
  ) ranked;
end;
$$;

revoke all on function public.get_classroom_individual_leaderboard(uuid, integer) from public;
grant execute on function public.get_classroom_individual_leaderboard(uuid, integer) to authenticated;
