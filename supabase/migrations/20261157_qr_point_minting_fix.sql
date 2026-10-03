-- 20261157 — close the point-minting hole in QR codes.
--
-- Two policies compose into unbounded inflation of the currency students spend
-- rewards with.
--
-- 1. teacher_write_qr_codes (20260926) is named as though only teachers can
--    write, but its with check opens on this branch:
--
--      classroom_id is null and created_by = auth.uid()
--
--    A general (classroom-less) QR code is a real feature, so the branch is
--    needed. The problem is that created_by is a column the caller chooses. Any
--    authenticated user could satisfy it by setting created_by to their own id,
--    so auth_is_teacher_of was never actually reached. A student account could
--    insert a QR code worth any amount they liked.
--
-- 2. scan_qr (20260928) only rejects a QR code belonging to a different
--    classroom:
--
--      if v_qr.classroom_id is not null and v_qr.classroom_id <> v_classroom_id
--
--    A row with classroom_id null therefore matched every classroom, so the code
--    a student had just invented could be scanned for its full value.
--
-- Together that is: insert a QR code with an arbitrary base_points, scan it,
-- repeat. The credits are real currency — redeem_reward and the group
-- leaderboard both read participation_logs — so the ceiling is "every reward in
-- the catalogue, and the top of the leaderboard".
--
-- The fix is at the write, which is where authority belongs. Reading a general
-- code from any classroom is intended and is left alone. base_points is also
-- capped, because a teacher should not be able to mint a million points by
-- accident either.

-- Only an actual teacher may create a general, classroom-less QR code.
drop policy if exists teacher_write_qr_codes on public.qr_codes;
create policy teacher_write_qr_codes on public.qr_codes for all to authenticated
  using (
    (classroom_id is null and created_by = auth.uid()
      and exists (select 1 from public.classrooms c where c.teacher_id = auth.uid()))
    or auth_is_teacher_of(classroom_id)
  )
  with check (
    (classroom_id is null and created_by = auth.uid()
      and exists (select 1 from public.classrooms c where c.teacher_id = auth.uid()))
    or auth_is_teacher_of(classroom_id)
  );

-- A point value is a classroom reward, not a treasury. Capped so a mistyped
-- zero does not become a class-wide hole.
do $$
declare
  v_max integer;
begin
  select coalesce(max(base_points), 0) into v_max from public.qr_codes;

  if v_max > 1000 then
    raise exception 'Cannot cap base_points: % of the existing QR codes are worth more than 1000 points.', v_max;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'qr_codes_base_points_sane') then
    alter table public.qr_codes
      add constraint qr_codes_base_points_sane
      check (base_points is null or (base_points > 0 and base_points <= 1000));
  end if;
end;
$$;

-- scan_qr should also refuse a code nobody is entitled to distribute. The
-- classroom-less case is legitimate for a teacher's general code, so the check
-- is that it exists at all and has a sane value, rather than reopening the
-- per-classroom test the feature is built around.
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
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_qr from public.qr_codes where hash = trim(p_hash) for update;
  if not found then raise exception 'That code is not valid'; end if;
  if v_qr.is_used and v_qr.qr_type <> 'gacha' then
    raise exception 'That code has already been used';
  end if;
  if v_qr.expires_at is not null and v_qr.expires_at < now() then
    raise exception 'That code has expired';
  end if;

  select * into v_account from public.group_accounts
    where user_id = v_user and is_approved = true
  order by created_date limit 1;
  if not found then raise exception 'Approved classroom account required'; end if;
  v_classroom_id := v_account.classroom_id;

  if v_qr.classroom_id is not null and v_qr.classroom_id <> v_classroom_id then
    raise exception 'This QR code is not available for your class';
  end if;

  -- A general code is only general if a teacher made it. Without this, anyone
  -- who could get a row into the table could hand their classroom free points.
  if v_qr.classroom_id is null and not exists (
    select 1 from public.classrooms c where c.teacher_id = v_qr.created_by
  ) then
    raise exception 'That code is not available';
  end if;

  if p_recipient_type = 'group' then
    select * into v_group from public.groups where id = v_account.group_id;
  else
    select * into v_member from public.group_members
      where id = p_group_member_id and group_id = v_account.group_id;
    if not found then raise exception 'Choose a member from your group'; end if;
  end if;

  if p_risk and v_qr.qr_type <> 'gacha' then v_multiplier := 2; end if;
  v_points := round(coalesce(v_qr.base_points, 0) * v_multiplier);

  if v_qr.qr_type = 'gacha' then
    -- Gacha outcomes are decided by the caller-supplied weights in qr_codes and
    -- recorded through the same ledger as any other scan.
    insert into public.participation_logs(group_id, classroom_id, group_member_id, points_awarded, event_type, multiplier, recipient_type, qr_code_id, note)
    values (v_account.group_id, v_classroom_id,
      case when p_recipient_type = 'group' then null else v_member.id end,
      v_points, 'gacha_even', v_multiplier, p_recipient_type, v_qr.id, v_qr.label);
  else
    insert into public.participation_logs(group_id, classroom_id, group_member_id, points_awarded, event_type, multiplier, recipient_type, qr_code_id, note)
    values (v_account.group_id, v_classroom_id,
      case when p_recipient_type = 'group' then null else v_member.id end,
      v_points, 'scan', v_multiplier, p_recipient_type, v_qr.id, v_qr.label);
  end if;

  update public.qr_codes
    set is_used = true, used_by_member_id = v_member.id, used_at = now()
  where id = v_qr.id;

  return jsonb_build_object(
    'event', v_qr.qr_type,
    'label', v_qr.label,
    'points', v_points,
    'multiplier', v_multiplier,
    'groupId', v_account.group_id
  );
end;
$$;

revoke all on function public.scan_qr(text, uuid, boolean, text) from public;
grant execute on function public.scan_qr(text, uuid, boolean, text) to authenticated;

-- ── Verification ─────────────────────────────────────────────────────────
-- A student must not be able to create a general QR code, and must not be able
-- to redeem one that a non-teacher created.

do $$
declare
  v_case record;
  v_student uuid;
  v_created integer;
  v_problems text[] := '{}';
begin
  select c.id, c.teacher_id into v_case
  from public.classrooms c
  where exists (select 1 from public.group_accounts ga
                where ga.classroom_id = c.id and ga.is_approved and ga.user_id is not null)
  order by c.created_date limit 1;

  if v_case.id is null then
    raise notice 'skipped: no classroom has an approved student to test with';
    return;
  end if;

  select ga.user_id into v_student
  from public.group_accounts ga
  where ga.classroom_id = v_case.id and ga.is_approved and ga.user_id is not null
  order by ga.created_date limit 1;

  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_student::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_student::text, 'role', 'authenticated')::text);

  -- The insert the student should not be able to make.
  begin
    insert into public.qr_codes(hash, classroom_id, qr_type, base_points, created_by)
    values ('verify-mint-' || gen_random_uuid()::text, null, 'standard', 1000000, v_student);
    v_created := 1;
  exception when others then
    v_created := 0;
  end;

  if v_created = 1 then
    v_problems := array_append(v_problems, 'a student was able to create a general QR code');
    -- Clean up the row if the policy somehow let it through.
    delete from public.qr_codes where hash like 'verify-mint-%';
  end if;

  -- A teacher still can, because the feature depends on it.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_case.teacher_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_case.teacher_id::text, 'role', 'authenticated')::text);

  begin
    insert into public.qr_codes(hash, classroom_id, qr_type, base_points, created_by)
    values ('verify-teacher-' || gen_random_uuid()::text, null, 'standard', 10, v_case.teacher_id);
    delete from public.qr_codes where hash like 'verify-teacher-%';
  exception when others then
    v_problems := array_append(v_problems, 'a teacher can no longer create a general QR code');
  end;

  -- The cap exists and is enforced.
  if not exists (select 1 from pg_constraint where conname = 'qr_codes_base_points_sane') then
    v_problems := array_append(v_problems, 'there is no cap on what a QR code can be worth');
  end if;

  if array_length(v_problems, 1) is not null then
    raise exception 'QR point minting is still possible: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'verified: a student cannot create a general QR code, a teacher still can, and QR codes are capped at 1000 points';
end;
$$;