create or replace function public.claim_badge_definition(p_definition_id uuid, p_group_id uuid, p_member_id uuid default null)
returns badges language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_def badge_definitions%rowtype; v_group groups%rowtype;
  v_account group_accounts%rowtype; v_result badges%rowtype; v_week date;
begin
  if extract(dow from (now() at time zone 'Asia/Manila')) not in (0, 6) then raise exception 'Optional badges can be claimed on Saturday or Sunday.'; end if;
  select * into v_def from badge_definitions where id=p_definition_id and is_active=true;
  if not found then raise exception 'Badge is no longer available'; end if;
  select * into v_group from groups where id=p_group_id and classroom_id=v_def.classroom_id;
  if not found then raise exception 'Invalid group'; end if;
  select * into v_account from group_accounts where user_id=v_user and group_id=p_group_id and is_approved=true limit 1;
  if not found then raise exception 'Approved classroom account required'; end if;
  if v_def.badge_scope='personal' and (p_member_id is null or p_member_id <> v_account.group_member_id) then raise exception 'Personal badges can only be claimed for your own student profile'; end if;
  v_week := (now() at time zone 'Asia/Manila')::date - extract(isodow from (now() at time zone 'Asia/Manila'))::integer + 1;
  insert into badges(group_id,classroom_id,badge_type,week_start_date,points_awarded,redeemed_by,badge_definition_id,member_id)
    values(p_group_id,v_def.classroom_id,'custom:'||v_def.id::text,v_week,v_def.points,v_user,p_definition_id,case when v_def.badge_scope='personal' then p_member_id else null end)
    returning * into v_result;
  if v_def.badge_scope='group' then
    insert into participation_logs(group_member_id,group_id,classroom_id,points_awarded,event_type,multiplier,note)
      select gm.id,p_group_id,v_def.classroom_id,v_def.points / nullif((select count(*) from group_members where group_id=p_group_id),0),'badge',1,v_def.title
      from group_members gm where gm.group_id=p_group_id;
  else
    insert into participation_logs(group_member_id,group_id,classroom_id,points_awarded,event_type,multiplier,note)
      values(p_member_id,p_group_id,v_def.classroom_id,v_def.points,'badge',1,v_def.title);
  end if;
  return v_result;
exception when unique_violation then raise exception 'This badge has already been claimed this week.';
end;
$$;
revoke all on function public.claim_badge_definition(uuid,uuid,uuid) from public;
grant execute on function public.claim_badge_definition(uuid,uuid,uuid) to authenticated;
