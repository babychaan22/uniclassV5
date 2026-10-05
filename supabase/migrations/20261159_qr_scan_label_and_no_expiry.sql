-- 20261159 — QR scans must not reference a column the table does not own.
--
-- qr_codes has no `label` column.  The previous scan function tried to read
-- v_qr.label while writing the ledger and building its response, so every
-- otherwise-valid scan failed with "record v_qr has no field label".
-- General printed codes are intentionally perpetual. Clear any historical
-- expiration and remove a default that could put an expiry back on new codes.

update public.qr_codes
set expires_at = null
where expires_at is not null;

alter table public.qr_codes
  alter column expires_at drop default;

create or replace function public.scan_qr(
  p_hash text,
  p_group_member_id uuid default null,
  p_risk boolean default false,
  p_recipient_type text default 'member'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_qr public.qr_codes%rowtype;
  v_account public.group_accounts%rowtype;
  v_member public.group_members%rowtype;
  v_group public.groups%rowtype;
  v_multiplier numeric := 1;
  v_points numeric;
  v_classroom_id uuid;
  v_label text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_qr from public.qr_codes where hash = trim(p_hash) for update;
  if not found then raise exception 'That code is not valid'; end if;
  if v_qr.is_used and v_qr.qr_type <> 'gacha' then
    raise exception 'That code has already been used';
  end if;

  select * into v_account from public.group_accounts
    where user_id = v_user and is_approved = true
  order by created_date limit 1;
  if not found then raise exception 'Approved classroom account required'; end if;
  v_classroom_id := v_account.classroom_id;

  if v_qr.classroom_id is not null and v_qr.classroom_id <> v_classroom_id then
    raise exception 'This QR code is not available for your class';
  end if;
  if v_qr.classroom_id is null and not exists (
    select 1 from public.classrooms c where c.teacher_id = v_qr.created_by
  ) then
    raise exception 'That code is not available';
  end if;

  if p_recipient_type = 'group' then
    select * into v_group from public.groups where id = v_account.group_id;
    if not found then raise exception 'Your group is not available'; end if;
  elsif p_recipient_type = 'member' then
    select * into v_member from public.group_members
      where id = p_group_member_id and group_id = v_account.group_id;
    if not found then raise exception 'Choose a member from your group'; end if;
  else
    raise exception 'Choose either a group or a member recipient';
  end if;

  if p_risk and v_qr.qr_type <> 'gacha' then v_multiplier := 2; end if;
  v_points := round(coalesce(v_qr.base_points, 0) * v_multiplier);
  v_label := case when v_qr.qr_type = 'gacha' then 'Gacha capsule scan' else 'QR scan' end;

  insert into public.participation_logs(
    group_id, classroom_id, group_member_id, points_awarded, event_type,
    multiplier, recipient_type, qr_code_id, note
  ) values (
    v_account.group_id, v_classroom_id,
    case when p_recipient_type = 'group' then null else v_member.id end,
    v_points,
    case when v_qr.qr_type = 'gacha' then 'gacha_even' else 'scan' end,
    v_multiplier, p_recipient_type, v_qr.id, v_label
  );

  update public.qr_codes
    set is_used = true,
        used_by_member_id = case when p_recipient_type = 'member' then v_member.id else null end,
        used_at = now()
  where id = v_qr.id;

  return jsonb_build_object(
    'event', v_qr.qr_type,
    'label', v_label,
    'points', v_points,
    'multiplier', v_multiplier,
    'groupId', v_account.group_id
  );
end;
$$;

revoke all on function public.scan_qr(text, uuid, boolean, text) from public;
grant execute on function public.scan_qr(text, uuid, boolean, text) to authenticated;
