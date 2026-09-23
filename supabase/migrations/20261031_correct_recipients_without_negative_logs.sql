-- Participation logs intentionally reject negative awards. To move an award,
-- preserve the original row as a zero-value audit record and create one
-- positive credit for the corrected recipient.

create or replace function public.correct_participation_recipient(
  p_source_log_id uuid,
  p_target_member_id uuid default null,
  p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_source public.participation_logs%rowtype;
  v_target public.group_members%rowtype;
  v_correction public.point_recipient_corrections%rowtype;
  v_target_recipient text;
begin
  select * into v_source from public.participation_logs where id = p_source_log_id for update;
  if not found then raise exception 'The original point award was not found'; end if;
  if not exists (select 1 from public.classrooms where id = v_source.classroom_id and teacher_id = v_user) then
    raise exception 'Only the classroom teacher can correct point recipients';
  end if;
  if v_source.event_type not in ('scan', 'gacha_win', 'gacha_even', 'mission_redemption') or coalesce(v_source.points_awarded, 0) <= 0 then
    raise exception 'Only positive QR/hash or mission-redemption awards can be corrected';
  end if;
  if exists (select 1 from public.point_recipient_corrections where source_log_id = p_source_log_id) then
    raise exception 'This award has already been corrected';
  end if;
  if p_target_member_id is not null then
    select * into v_target from public.group_members
      where id = p_target_member_id and group_id = v_source.group_id and classroom_id = v_source.classroom_id;
    if not found then raise exception 'Choose a student from the original group'; end if;
  end if;
  if v_source.group_member_id is not distinct from p_target_member_id then
    raise exception 'This award is already assigned to that recipient';
  end if;

  insert into public.point_recipient_corrections(
    source_log_id, classroom_id, group_id, original_member_id, corrected_member_id, points, reason, corrected_by
  ) values (
    v_source.id, v_source.classroom_id, v_source.group_id, v_source.group_member_id,
    p_target_member_id, v_source.points_awarded, 'Recipient correction', v_user
  ) returning * into v_correction;

  v_target_recipient := case when p_target_member_id is null then 'WHOLE GROUP' else 'correct student' end;

  update public.participation_logs
    set points_awarded = 0,
        note = format('Recipient correction: original %s award moved to %s.', v_source.event_type, v_target_recipient)
    where id = v_source.id;

  insert into public.participation_logs(
    group_member_id, group_id, classroom_id, points_awarded, xp_spent,
    event_type, multiplier, recipient_type, note
  ) values (
    p_target_member_id, v_source.group_id, v_source.classroom_id, v_source.points_awarded, 0,
    'point_correction', 1, case when p_target_member_id is null then 'group' else 'member' end,
    format('Correction credit: %s moved to %s.', v_source.event_type, v_target_recipient)
  );

  return jsonb_build_object(
    'correctionId', v_correction.id,
    'points', v_source.points_awarded,
    'groupId', v_source.group_id,
    'memberId', p_target_member_id
  );
end;
$$;

revoke all on function public.correct_participation_recipient(uuid,uuid,text) from public;
grant execute on function public.correct_participation_recipient(uuid,uuid,text) to authenticated;
