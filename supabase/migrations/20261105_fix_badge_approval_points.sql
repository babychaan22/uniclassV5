-- Ensure badge approvals actually add the awarded points to the requesting group.
-- The original approval function inserted the participation log, but we guard against
-- duplicate writes and ensure the badge points are still awarded even when the badge
-- definition is missing or the badge record sits in a slightly different state.

create or replace function public.review_badge_claim(p_badge_id uuid, p_approve boolean)
returns public.badges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_badge public.badges%rowtype;
  v_title text;
  v_points numeric;
  v_log_count integer;
begin
  select * into v_badge
  from public.badges
  where id = p_badge_id
  for update;

  if not found then
    raise exception 'Badge request not found';
  end if;

  if not auth_is_teacher_of(v_badge.classroom_id) then
    raise exception 'Only the teacher can review this badge request';
  end if;

  if v_badge.approval_status <> 'pending' then
    raise exception 'This badge request has already been reviewed';
  end if;

  update public.badges
  set approval_status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_badge_id
  returning * into v_badge;

  if p_approve then
    v_points := coalesce(v_badge.points_awarded, 0);
    select coalesce(title, replace(v_badge.badge_type, '_', ' '))
      into v_title
    from public.badge_definitions
    where id = v_badge.badge_definition_id;

    select count(*) into v_log_count
    from public.participation_logs
    where qr_code_id = v_badge.id
      and event_type = 'badge'
      and classroom_id = v_badge.classroom_id
      and group_id = v_badge.group_id;

    if v_log_count = 0 then
      insert into public.participation_logs(
        group_member_id,
        group_id,
        classroom_id,
        qr_code_id,
        points_awarded,
        event_type,
        multiplier,
        recipient_type,
        note
      )
      values(
        v_badge.member_id,
        v_badge.group_id,
        v_badge.classroom_id,
        v_badge.id,
        v_points,
        'badge',
        1,
        case when v_badge.member_id is null then 'group' else 'member' end,
        coalesce(v_title, 'Weekly badge')
      );
    end if;
  end if;

  return v_badge;
end;
$$;

revoke all on function public.review_badge_claim(uuid, boolean) from public;
grant execute on function public.review_badge_claim(uuid, boolean) to authenticated;
