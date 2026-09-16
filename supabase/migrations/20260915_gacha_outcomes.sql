-- Four classroom-friendly outcomes. The 1.0x result is intentionally most likely.
create or replace function public.scan_qr(p_hash text, p_group_member_id uuid, p_risk boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_qr qr_codes%rowtype; v_member group_members%rowtype;
  v_multiplier numeric := 1; v_points numeric; v_event text := 'scan'; v_mood text := 'neutral';
  v_draw integer := 1; v_outcome integer := 1; v_log participation_logs%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_qr from qr_codes where hash=trim(p_hash) for update;
  if not found or v_qr.is_used then raise exception 'This QR code has already been used or is invalid'; end if;
  select * into v_member from group_members where id=p_group_member_id;
  if not found or not exists (select 1 from group_accounts where user_id=v_user and group_id=v_member.group_id and classroom_id=v_qr.classroom_id and is_approved=true) then raise exception 'You cannot scan for this student'; end if;
  if v_qr.qr_type='gacha' and coalesce(p_risk,false) then
    v_draw := floor(random()*20)::integer;
    v_outcome := case when v_draw < 3 then 0 when v_draw < 15 then 1 when v_draw < 19 then 2 else 3 end;
    v_multiplier := (array[0.5,1,1.5,2])[v_outcome+1];
    v_mood := case when v_outcome = 0 then 'sad' when v_outcome = 1 then 'neutral' else 'happy' end;
    v_event := case when v_outcome = 0 then 'gacha_loss' when v_outcome = 1 then 'gacha_even' else 'gacha_win' end;
  end if;
  v_points := round(v_qr.base_points * v_multiplier);
  update qr_codes set is_used=true, used_by_member_id=v_member.id, used_at=now() where id=v_qr.id;
  insert into participation_logs(group_member_id,group_id,classroom_id,qr_code_id,points_awarded,event_type,multiplier,note)
    values(v_member.id,v_member.group_id,v_qr.classroom_id,v_qr.id,v_points,v_event,v_multiplier,case when v_qr.qr_type='gacha' then 'Gacha capsule scan' else 'QR scan' end)
    returning * into v_log;
  return jsonb_build_object('points',v_points,'eventType',v_event,'multiplier',v_multiplier,'gacha',case when v_qr.qr_type='gacha' then jsonb_build_object('mood',v_mood,'multiplier',v_multiplier,'index',v_outcome) else null end,'groupId',v_member.group_id,'memberId',v_member.id,'log',to_jsonb(v_log));
end;
$$;
