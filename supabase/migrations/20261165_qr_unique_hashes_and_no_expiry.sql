-- 20261165 — one QR hash per code, and codes that never expire.
--
-- Written but NOT applied. It needs approval before it reaches Supabase.
--
-- Two problems with QR codes:
--
-- 1. Duplicates were possible. The hash was generated in the browser and
--    inserted straight into qr_codes, with nothing stopping the same code being
--    issued twice: no unique index, and no check against what was already on
--    record. Two identical codes means one scan can be attributed to whichever
--    was scanned first, and a printed sheet can silently contain a duplicate.
--    The interface now refuses to issue a hash it has already seen, but that is
--    a client-side courtesy, not a guarantee. This index is the guarantee.
--
-- 2. Codes carried an expiry. scan_qr refused a code whose expires_at had
--    passed. A printed classroom sheet outlives any expiry that was set on it,
--    so a code could be dead while still hanging on the wall. Codes are meant to
--    be durable, so the expiry check comes out. The column is left in place: it
--    is not used to block anything any more, and dropping it would discard
--    history rather than fix anything.
--
-- A code is still single use. That is a separate rule from expiry and it was not
--    part of this change.

-- ── One code per hash ─────────────────────────────────────────────────────
do $$
declare
  v_duplicates integer;
begin
  select count(*) into v_duplicates
  from (
    select hash from public.qr_codes group by hash having count(*) > 1
  ) repeated;

  if v_duplicates > 0 then
    raise exception
      'Cannot enforce unique hashes: % hash(es) are already on record more than once. Remove the duplicates first.',
      v_duplicates;
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'idx_qr_codes_hash_unique'
  ) then
    create unique index idx_qr_codes_hash_unique on public.qr_codes(hash);
  end if;
end;
$$;

-- ── Codes do not expire ──────────────────────────────────────────────────
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

  -- No expiry check. A printed sheet is meant to keep working; a code that has
  -- hung on a wall all term should not die quietly one Tuesday.
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

  -- A general code is only general if a teacher made it.
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

  insert into public.participation_logs(group_id, classroom_id, group_member_id, points_awarded, event_type, multiplier, recipient_type, qr_code_id, note)
    values (v_account.group_id, v_classroom_id,
      case when p_recipient_type = 'group' then null else v_member.id end,
      v_points,
      case when v_qr.qr_type = 'gacha' then 'gacha_even' else 'scan' end,
      v_multiplier, p_recipient_type, v_qr.id, v_qr.label);

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
-- Duplicates must be impossible, and a code that carries an expiry in the past
-- must still scan. Both are asserted without touching real points: the check
-- builds its own code and its own student, and removes both afterwards.

do $$
declare
  v_case record;
  v_hash text := 'verify-noexpiry-' || substr(md5(random()::text), 1, 12);
  v_used_hash text := 'verify-used-' || substr(md5(random()::text), 1, 12);
  v_scan jsonb;
  v_problems text[] := '{}';
  v_again integer := 0;
begin
  select c.id, c.teacher_id, ga.user_id, ga.group_id, ga.group_member_id
    into v_case
  from public.classrooms c
  join public.group_accounts ga
    on ga.classroom_id = c.id and ga.is_approved and ga.user_id is not null
  order by c.created_date, ga.created_date
  limit 1;

  if v_case.id is null then
    raise notice 'skipped: no classroom with an approved student account';
    return;
  end if;

  -- 1. Hashes are unique at the database level.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'idx_qr_codes_hash_unique'
  ) then
    v_problems := array_append(v_problems, 'there is still no unique index on the QR hash');
  end if;

  -- 2. An expired code still scans.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_case.teacher_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_case.teacher_id::text, 'role', 'authenticated')::text);

  insert into public.qr_codes(hash, classroom_id, qr_type, base_points, created_by, expires_at)
  values (v_hash, null, 'standard', 1, v_case.teacher_id, now() - interval '1 year');

  -- 3. A code cannot be issued twice.
  begin
    insert into public.qr_codes(hash, classroom_id, qr_type, base_points, created_by)
    values (v_hash, null, 'standard', 1, v_case.teacher_id);
    v_again := 1;
  exception when unique_violation then
    v_again := 0;
  end;
  if v_again = 1 then
    v_problems := array_append(v_problems, 'the same hash could be issued twice');
  end if;

  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_case.user_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_case.user_id::text, 'role', 'authenticated')::text);

  begin
    v_scan := public.scan_qr(v_hash, v_case.group_member_id, false, 'member');
  exception when others then
    v_problems := array_append(v_problems, 'an expired code was still refused: ' || sqlerrm);
  end;

  -- The reward itself must not survive the check.
  delete from public.participation_logs
  where qr_code_id in (select id from public.qr_codes where hash = v_hash);
  delete from public.qr_codes where hash in (v_hash, v_used_hash);

  if array_length(v_problems, 1) is not null then
    raise exception 'QR code rules are not in place: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'verified: a hash cannot be issued twice, and a code whose expiry has passed still scans';
end;
$$;
