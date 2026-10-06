-- Restore the server-chosen Gacha outcome payload consumed by the student
-- spinner/reveal UI. The 20261159/20261165 QR hardening rewrite retained the
-- points record but accidentally flattened every Gacha scan into plain points.
-- The draw stays exclusively in the database so a student cannot select an
-- outcome from the browser.

create or replace function public.scan_qr(
  p_hash text,
  p_group_member_id uuid default null,
  p_risk boolean default false,
  p_recipient_type text default 'member'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
  v_event text := 'scan';
  v_mood text := 'neutral';
  v_outcome integer := 1;
  v_draw integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_qr from public.qr_codes where hash = trim(p_hash) for update;
  if not found then raise exception 'That code is not valid'; end if;
  -- Every printed code awards exactly once, including a Gacha code. Allowing
  -- a spent capsule to be rescanned would let a student mint points repeatedly.
  if v_qr.is_used then raise exception 'That code has already been used'; end if;

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

  if v_qr.qr_type = 'gacha' then
    if p_risk then
      -- 0.5× 15%, 1× 60%, 1.5× 20%, 2× 5%.
      v_draw := floor(random() * 20)::integer;
      v_outcome := case when v_draw < 3 then 0 when v_draw < 15 then 1 when v_draw < 19 then 2 else 3 end;
      v_multiplier := (array[0.5, 1, 1.5, 2])[v_outcome + 1];
      v_mood := case when v_outcome = 0 then 'sad' when v_outcome = 1 then 'neutral' else 'happy' end;
      v_event := case when v_outcome = 0 then 'gacha_loss' when v_outcome = 1 then 'gacha_even' else 'gacha_win' end;
    else
      -- Keeping it safe still earns the code's base points and reveals the
      -- capsule result, but never changes the multiplier.
      v_event := 'gacha_even';
    end if;
  end if;

  v_points := round(coalesce(v_qr.base_points, 0) * v_multiplier);
  v_label := case when v_qr.qr_type = 'gacha' then 'Gacha capsule scan' else 'QR scan' end;

  insert into public.participation_logs(
    group_id, classroom_id, group_member_id, points_awarded, event_type,
    multiplier, recipient_type, qr_code_id, note
  ) values (
    v_account.group_id, v_classroom_id,
    case when p_recipient_type = 'group' then null else v_member.id end,
    v_points, v_event, v_multiplier, p_recipient_type, v_qr.id, v_label
  );

  update public.qr_codes
  set is_used = true,
      used_by_member_id = case when p_recipient_type = 'member' then v_member.id else null end,
      used_at = now()
  where id = v_qr.id;

  return jsonb_build_object(
    'event', v_qr.qr_type,
    'eventType', v_event,
    'label', v_label,
    'points', v_points,
    'multiplier', v_multiplier,
    'recipientType', p_recipient_type,
    'groupId', v_account.group_id,
    'memberId', case when p_recipient_type = 'member' then v_member.id else null end,
    'gacha', case when v_qr.qr_type = 'gacha'
      then jsonb_build_object('mood', v_mood, 'multiplier', v_multiplier, 'index', v_outcome)
      else null end
  );
end;
$$;

revoke all on function public.scan_qr(text, uuid, boolean, text) from public;
grant execute on function public.scan_qr(text, uuid, boolean, text) to authenticated;
