-- Teachers can correct a mission or QR/hash award without erasing history.
-- Each source award may be moved once; the matching negative and positive
-- adjustment entries preserve group totals and provide a complete audit trail.

create table if not exists public.point_recipient_corrections (
  id uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  source_log_id uuid not null unique references public.participation_logs(id) on delete restrict,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  original_member_id uuid references public.group_members(id) on delete set null,
  corrected_member_id uuid references public.group_members(id) on delete set null,
  points numeric not null check (points > 0),
  reason text not null check (char_length(trim(reason)) >= 3),
  corrected_by uuid not null references auth.users(id) on delete restrict
);

alter table public.point_recipient_corrections enable row level security;
drop policy if exists point_recipient_corrections_no_direct_access on public.point_recipient_corrections;
create policy point_recipient_corrections_no_direct_access
  on public.point_recipient_corrections for all to authenticated
  using (false) with check (false);

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
  v_original_recipient text;
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
  if coalesce(char_length(trim(p_reason)), 0) < 3 then raise exception 'Add a short reason for the correction'; end if;

  if p_target_member_id is not null then
    select * into v_target from public.group_members
      where id = p_target_member_id and group_id = v_source.group_id and classroom_id = v_source.classroom_id;
    if not found then raise exception 'Choose a student from the original group'; end if;
  end if;
  if v_source.group_member_id is not distinct from p_target_member_id then
    raise exception 'Choose a different student or Whole Group';
  end if;

  insert into public.point_recipient_corrections(
    source_log_id, classroom_id, group_id, original_member_id, corrected_member_id, points, reason, corrected_by
  ) values (
    v_source.id, v_source.classroom_id, v_source.group_id, v_source.group_member_id,
    p_target_member_id, v_source.points_awarded, trim(p_reason), v_user
  ) returning * into v_correction;

  v_original_recipient := case when v_source.group_member_id is null then 'WHOLE GROUP' else 'original student' end;
  v_target_recipient := case when p_target_member_id is null then 'WHOLE GROUP' else 'correct student' end;

  -- Reverse the original recipient, then credit the corrected recipient.
  insert into public.participation_logs(
    group_member_id, group_id, classroom_id, points_awarded, xp_spent,
    event_type, multiplier, recipient_type, note
  ) values (
    v_source.group_member_id, v_source.group_id, v_source.classroom_id, -v_source.points_awarded, 0,
    'point_correction', 1, case when v_source.group_member_id is null then 'group' else 'member' end,
    format('Correction reversal: %s moved from %s. Reason: %s', v_source.event_type, v_original_recipient, trim(p_reason))
  );
  insert into public.participation_logs(
    group_member_id, group_id, classroom_id, points_awarded, xp_spent,
    event_type, multiplier, recipient_type, note
  ) values (
    p_target_member_id, v_source.group_id, v_source.classroom_id, v_source.points_awarded, 0,
    'point_correction', 1, case when p_target_member_id is null then 'group' else 'member' end,
    format('Correction credit: %s moved to %s. Reason: %s', v_source.event_type, v_target_recipient, trim(p_reason))
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
