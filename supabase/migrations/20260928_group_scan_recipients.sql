-- Allow one-time QR points to belong to the whole group without assigning
-- them to an individual member.

alter table public.participation_logs alter column group_member_id drop not null;
alter table public.participation_logs add column if not exists recipient_type text not null default 'member';
alter table public.participation_logs drop constraint if exists participation_logs_recipient_type_check;
alter table public.participation_logs add constraint participation_logs_recipient_type_check check (recipient_type in ('member', 'group'));

drop function if exists public.scan_qr(text, uuid, boolean);

create or replace function public.scan_qr(
  p_hash text,
  p_group_member_id uuid,
  p_risk boolean default false,
  p_recipient_type text default 'member'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_qr qr_codes%rowtype;
  v_member group_members%rowtype;
  v_classroom_id uuid;
  v_group_id uuid;
  v_recipient text := case when p_recipient_type = 'group' then 'group' else 'member' end;
  v_multiplier numeric := 1;
  v_points numeric;
  v_event text := 'scan';
  v_mood text := 'neutral';
  v_draw integer := 1;
  v_outcome integer := 1;
  v_log participation_logs%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_qr from qr_codes where hash = trim(p_hash) for update;
  if not found or v_qr.is_used then raise exception 'This QR code has already been used or is invalid'; end if;

  if v_recipient = 'member' then
    select * into v_member from group_members where id = p_group_member_id;
    if not found then raise exception 'You cannot scan for this student'; end if;
    v_group_id := v_member.group_id;
  else
    select group_id, classroom_id into v_group_id, v_classroom_id
    from group_accounts where user_id = v_user and is_approved = true limit 1;
    if v_group_id is null then raise exception 'You cannot scan for this group'; end if;
  end if;

  select classroom_id into v_classroom_id
  from group_accounts
  where user_id = v_user and group_id = v_group_id and is_approved = true
  limit 1;
  if v_classroom_id is null then raise exception 'You cannot scan for this group'; end if;
  if v_qr.classroom_id is not null and v_qr.classroom_id <> v_classroom_id then
    raise exception 'This QR code is not available for your class';
  end if;

  if v_qr.qr_type = 'gacha' and coalesce(p_risk, false) then
    v_draw := floor(random() * 20)::integer;
    v_outcome := case when v_draw < 3 then 0 when v_draw < 15 then 1 when v_draw < 19 then 2 else 3 end;
    v_multiplier := (array[0.5, 1, 1.5, 2])[v_outcome + 1];
    v_mood := case when v_outcome = 0 then 'sad' when v_outcome = 1 then 'neutral' else 'happy' end;
    v_event := case when v_outcome = 0 then 'gacha_loss' when v_outcome = 1 then 'gacha_even' else 'gacha_win' end;
  end if;
  v_points := round(v_qr.base_points * v_multiplier);
  update qr_codes set is_used = true, used_by_member_id = case when v_recipient = 'member' then v_member.id else null end, used_at = now() where id = v_qr.id;
  insert into participation_logs(group_member_id, group_id, classroom_id, recipient_type, qr_code_id, points_awarded, event_type, multiplier, note)
    values(case when v_recipient = 'member' then v_member.id else null end, v_group_id, v_classroom_id, v_recipient, v_qr.id, v_points, v_event, v_multiplier,
      case when v_qr.qr_type = 'gacha' then 'Gacha capsule scan' else 'QR scan' end)
    returning * into v_log;
  return jsonb_build_object('points', v_points, 'eventType', v_event, 'multiplier', v_multiplier, 'recipientType', v_recipient,
    'gacha', case when v_qr.qr_type = 'gacha' then jsonb_build_object('mood', v_mood, 'multiplier', v_multiplier, 'index', v_outcome) else null end,
    'groupId', v_group_id, 'memberId', case when v_recipient = 'member' then v_member.id else null end, 'log', to_jsonb(v_log));
end;
$$;

revoke all on function public.scan_qr(text, uuid, boolean, text) from public;
grant execute on function public.scan_qr(text, uuid, boolean, text) to authenticated;
