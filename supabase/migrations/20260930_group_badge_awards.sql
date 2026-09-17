-- Weekend badge claims are atomic, one per group and week. Group awards are
-- stored without a member recipient so they never inflate an individual's
-- points total.

create or replace function public.redeem_badge(
  p_group_id uuid,
  p_badge_type text
)
returns public.badges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_group public.groups%rowtype;
  v_account public.group_accounts%rowtype;
  v_member public.group_members%rowtype;
  v_badge public.badges%rowtype;
  v_week date;
  v_week_end date;
  v_eligible boolean := false;
  v_points numeric := 0;
  v_score numeric;
  v_max_score numeric;
  v_group_total numeric;
  v_max_group_total numeric;
  v_member_total numeric;
  v_max_member_total numeric;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_badge_type not in ('weekly_90_activity','weekly_full_attendance','weekly_top_group_points','weekly_top_individual_points') then
    raise exception 'Invalid badge type';
  end if;
  if extract(dow from (now() at time zone 'Asia/Manila')) not in (0, 6) then
    raise exception 'Badges are only available at the end of the week (Saturday–Sunday).';
  end if;

  select * into v_group from public.groups where id = p_group_id for update;
  if not found then raise exception 'Invalid group'; end if;
  select * into v_account from public.group_accounts
    where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if not found then raise exception 'Approved classroom account required'; end if;

  v_week := (now() at time zone 'Asia/Manila')::date - extract(isodow from (now() at time zone 'Asia/Manila'))::integer + 1;
  v_week_end := v_week + 6;

  if p_badge_type = 'weekly_90_activity' then
    v_points := 20;
    v_eligible := true;
    for v_member in select * from public.group_members where group_id = p_group_id loop
      select coalesce(sum(s.score), 0), coalesce(sum(a.max_score), 0)
        into v_score, v_max_score
      from public.activity_scores s
      join public.activities a on a.id = s.activity_id
      where s.group_member_id = v_member.id
        and s.created_date::date between v_week and v_week_end;
      if v_max_score = 0 or v_score / v_max_score < 0.9 then v_eligible := false; exit; end if;
    end loop;
  elsif p_badge_type = 'weekly_full_attendance' then
    v_points := 10;
    select count(*) = count(*) filter (where a.status = 'present')
      and count(*) > 0 into v_eligible
    from public.attendances a
    where a.group_id = p_group_id and a.attendance_date between v_week and v_week_end;
    v_eligible := v_eligible and not exists (
      select 1 from public.group_members gm
      where gm.group_id = p_group_id
        and not exists (
          select 1 from public.attendances a
          where a.group_member_id = gm.id
            and a.attendance_date between v_week and v_week_end
        )
    );
  elsif p_badge_type = 'weekly_top_group_points' then
    v_points := 20;
    select coalesce(sum(points_awarded), 0) into v_group_total
      from public.participation_logs where group_id = p_group_id and created_date::date between v_week and v_week_end;
    select max(total) into v_max_group_total from (
      select g.id, coalesce(sum(l.points_awarded), 0) as total
      from public.groups g left join public.participation_logs l
        on l.group_id = g.id and l.created_date::date between v_week and v_week_end
      where g.classroom_id = v_group.classroom_id group by g.id
    ) totals;
    v_eligible := v_group_total > 0 and v_group_total = v_max_group_total;
  else
    v_points := 20;
    select max(total) into v_max_member_total from (
      select gm.id, coalesce(sum(l.points_awarded), 0) as total
      from public.group_members gm left join public.participation_logs l
        on l.group_member_id = gm.id and l.created_date::date between v_week and v_week_end
      where gm.classroom_id = v_group.classroom_id group by gm.id
    ) totals;
    select coalesce(sum(points_awarded), 0) into v_member_total
      from public.participation_logs where group_member_id = v_account.group_member_id and created_date::date between v_week and v_week_end;
    v_eligible := v_member_total > 0 and v_member_total = v_max_member_total;
  end if;

  if not v_eligible then raise exception 'Not eligible for this badge this week.'; end if;

  insert into public.badges(group_id, classroom_id, badge_type, week_start_date, points_awarded, redeemed_by)
    values (p_group_id, v_group.classroom_id, p_badge_type, v_week, v_points, v_user)
    returning * into v_badge;

  insert into public.participation_logs(
    group_member_id, group_id, classroom_id, qr_code_id, points_awarded, event_type, multiplier, recipient_type, note
  ) values (
    null, p_group_id, v_group.classroom_id, v_badge.id, v_points, 'badge', 1, 'group', 'Weekly group badge'
  );

  return v_badge;
exception when unique_violation then
  raise exception 'This badge has already been claimed this week.';
end;
$$;

revoke all on function public.redeem_badge(uuid, text) from public;
grant execute on function public.redeem_badge(uuid, text) to authenticated;

-- Group custom badges follow the same rule; personal custom badges remain per student.
create or replace function public.claim_badge_definition(p_definition_id uuid, p_group_id uuid, p_member_id uuid default null)
returns public.badges language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_def public.badge_definitions%rowtype; v_group public.groups%rowtype;
  v_account public.group_accounts%rowtype; v_result public.badges%rowtype; v_week date; v_badge_type text;
begin
  if extract(dow from (now() at time zone 'Asia/Manila')) not in (0, 6) then raise exception 'Badges can be claimed on Saturday or Sunday.'; end if;
  select * into v_def from public.badge_definitions where id = p_definition_id and is_active = true;
  if not found then raise exception 'Badge is no longer available'; end if;
  select * into v_group from public.groups where id = p_group_id and classroom_id = v_def.classroom_id;
  if not found then raise exception 'Invalid group'; end if;
  select * into v_account from public.group_accounts where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if not found then raise exception 'Approved classroom account required'; end if;
  if v_def.badge_scope = 'personal' and (p_member_id is null or p_member_id <> v_account.group_member_id) then raise exception 'Personal badges can only be claimed for your own student profile'; end if;
  v_week := (now() at time zone 'Asia/Manila')::date - extract(isodow from (now() at time zone 'Asia/Manila'))::integer + 1;
  v_badge_type := 'custom:' || v_def.id::text || case when v_def.badge_scope = 'personal' then ':' || p_member_id::text else '' end;
  insert into public.badges(group_id, classroom_id, badge_type, week_start_date, points_awarded, redeemed_by, badge_definition_id, member_id)
    values(p_group_id, v_def.classroom_id, v_badge_type, v_week, v_def.points, v_user, p_definition_id, case when v_def.badge_scope = 'personal' then p_member_id else null end)
    returning * into v_result;
  if v_def.badge_scope = 'group' then
    insert into public.participation_logs(group_member_id, group_id, classroom_id, points_awarded, event_type, multiplier, recipient_type, note)
      values(null, p_group_id, v_def.classroom_id, v_def.points, 'badge', 1, 'group', v_def.title);
  else
    insert into public.participation_logs(group_member_id, group_id, classroom_id, points_awarded, event_type, multiplier, recipient_type, note)
      values(p_member_id, p_group_id, v_def.classroom_id, v_def.points, 'badge', 1, 'member', v_def.title);
  end if;
  return v_result;
exception when unique_violation then raise exception 'This badge has already been claimed this week.';
end;
$$;

revoke all on function public.claim_badge_definition(uuid, uuid, uuid) from public;
grant execute on function public.claim_badge_definition(uuid, uuid, uuid) to authenticated;
