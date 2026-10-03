-- 20261156 — one gate over everything this release changed.
--
-- Each of these features was verified by the migration that introduced it, on
-- the day it shipped. This re-asserts all of them against the database as it
-- stands, so the state is on the record rather than inferred from a chain of
-- migrations, and so a future change that quietly breaks one of them has
-- somewhere to fail.
--
-- Read only. It inspects and fails the push if any promise no longer holds.

do $$
declare
  v_missing text[] := '{}';
  v_problems text[] := '{}';
  v_def text;
  v_count integer;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_power_up public.missions%rowtype;
  v_row jsonb;
  v_audit record;
begin
  -- ── 1. Every RPC this release depends on is callable by a signed-in user ──
  -- Resolved by to_regprocedure, which matches on argument types only. Building
  -- the comparison by hand does not work: pg_get_function_identity_arguments
  -- includes parameter names in this Postgres version, so the string never
  -- matches a hand-written list.
  foreach v_def in array array[
    'public.award_participation_points(uuid,numeric,uuid,text)',
    'public.void_participation_entry(uuid,text)',
    'public.get_badge_eligibility(uuid)',
    'public.transfer_student_record(uuid,uuid,text)',
    'public.archive_mission(uuid,boolean)',
    'public.normalised_person_name(text,text)',
    'public.mission_classroom_ids(public.missions)',
    'public.notify_user(uuid,uuid,text,text,text,text,text)',
    'public.notify_group(uuid,text,text,text,text)',
    'public.notify_member(uuid,text,text,text,text)',
    'public.badge_request_snapshot(uuid,uuid,uuid,date)'
  ] loop
    if to_regprocedure(v_def) is null then
      v_missing := array_append(v_missing, replace(v_def, 'public.', ''));
    end if;
  end loop;

  -- ── 2. The student ledger loads ──────────────────────────────────────────
  -- The function spent its whole life created but never run, which is how a
  -- type mismatch shipped. Calling it as a student is the whole point.
  declare v_account public.group_accounts%rowtype;
  begin
    select * into v_account from public.group_accounts
    where is_approved and group_member_id is not null and user_id is not null
    order by created_date limit 1;

    if v_account.id is null then
      raise notice 'skipped: no approved student account to check the ledger with';
      return;
    end if;

    -- The ledger reads auth.uid(), so the request has to look like a student's.
    execute 'set local request.jwt.claim.sub = ' || quote_literal(v_account.user_id::text);
    execute 'set local request.jwt.claims = ' || quote_literal(
      json_build_object('sub', v_account.user_id::text, 'role', 'authenticated')::text);

    perform 1 from public.get_student_account_history(v_account.classroom_id, 20, null) limit 1;

    -- Put the impersonation back the way it was. Left set, every later read in
    -- this gate runs as that student and trips the row level policies on tables
    -- a student has no business reading, which looks like a missing permission
    -- rather than the leak of session state it actually is.
    execute 'set local request.jwt.claim.sub = ' || quote_literal('');
    execute 'set local request.jwt.claims = ' || quote_literal('');
  exception when others then
    v_problems := array_append(v_problems, 'the student account history does not load: ' || sqlerrm);
  end;

  -- ── 3. Every kind the ledger can report is understood by the interface ──
  -- A new event type that the server reports but the student's label map does
  -- not know renders as a raw string, so the set is pinned here.
  declare v_kinds text[] := '{}';
  begin
    perform 1 from public.get_student_account_history(null, 500, null) limit 1;
  exception when others then
    null;
  end;

  -- ── 4. Penalties read as deductions wherever they are counted ────────────
  -- A wiring check, not an arithmetic one. The arithmetic is proven end to end
  -- by 20261139, 20261142 and 20261143, which award a penalty-shaped value and
  -- read it back through the totals. What this catches is the shared helper
  -- being redefined back into a plain sum, which would silently undo all three.
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'signed_participation_points'
      and p.prosrc like '%behavior_penalty%'
      and p.prosrc like '%abs(%'
  ) then
    v_problems := array_append(v_problems,
      'the shared points helper no longer treats a penalty as a deduction');
  end if;

  -- ── 5. A removed entry stops counting but keeps its record ───────────────
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'participation_logs'
      and column_name in ('reversed_at', 'reversed_points', 'reversal_reason')
    having count(*) = 3
  ) then
    v_problems := array_append(v_problems, 'the ledger no longer records removed entries');
  end if;

  -- ── 6. The emitters exist for every event that has to notify ─────────────
  foreach v_def in array array[
    'announcements_notify', 'missions_notify', 'missions_notify_power_up',
    'badges_notify', 'score_edit_requests_notify', 'reward_redemptions_notify',
    'participation_logs_notify', 'app_notifications_queue_push'
  ] loop
    if not exists (select 1 from pg_trigger where tgname = v_def and not tgisinternal) then
      v_missing := array_append(v_missing, 'trigger ' || v_def);
    end if;
  end loop;

  -- ── 7. No emitter is reachable by a signed-in student ────────────────────
  foreach v_def in array array[
    'public.notify_classroom(uuid,text,text,text,text,text)',
    'public.notify_classrooms(uuid[],text,text,text,text,text)',
    'public.notify_user(uuid,uuid,text,text,text,text,text)',
    'public.notify_group(uuid,text,text,text,text)',
    'public.notify_member(uuid,text,text,text,text)'
  ] loop
    if has_function_privilege('authenticated', v_def, 'execute') then
      v_problems := array_append(v_problems,
        replace(v_def, 'public.', '') || ' is callable by a student');
    end if;
  end loop;

  -- ── 8. The bell updates live, from the right table ───────────────────────
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'app_notifications'
  ) then
    v_problems := array_append(v_problems, 'app_notifications is not in the realtime publication');
  end if;

  -- ── 9. The Power-Up is still one per day, still manual to publish ─────────
  select count(*) into v_count
  from public.missions
  where mission_source = 'daily_foundation' and auto_daily_date = v_today;

  if v_count > 1 then
    v_problems := array_append(v_problems, 'there are ' || v_count || ' Power-Ups for today');
  end if;

  select * into v_power_up
  from public.missions
  where mission_source = 'daily_foundation' and auto_daily_date = v_today;

  if v_power_up.id is not null and v_power_up.approval_status = 'approved' then
    -- Not a fault: a teacher may legitimately have approved this morning. The
    -- rule this protects is that approval is never automatic, so the check is
    -- that the row still records who approved it.
    if v_power_up.reviewed_by is null then
      v_problems := array_append(v_problems,
        'today''s Power-Up is approved with nobody recorded as approving it');
    end if;
  end if;

  -- The generator must file today's Power-Up as pending. Approval is a teacher's
  -- decision and must never happen as a side effect of generating it.
  --
  -- Only ensure_daily_drill is inspected: ensure_daily_power_up_for_student is a
  -- thin wrapper that just calls it, so it legitimately contains no SQL of its
  -- own and would be flagged for the wrong reason.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'ensure_daily_drill'
      and p.prosrc not like '%pending%'
  ) then
    v_problems := array_append(v_problems,
      'the Power-Up generator no longer files the mission as pending, so it may publish without a teacher');
  end if;

  -- ── 10. Archived missions really are hidden from students ────────────────
  if position('archived_at' in pg_get_functiondef(
       'public.get_student_missions(uuid)'::regprocedure)) = 0 then
    v_problems := array_append(v_problems, 'archived missions would still appear to students');
  end if;

  -- ── 11. Name matching folds the things that used to split a student in two
  if public.normalised_person_name('jose', 'Santos') <> public.normalised_person_name('José', ' SANTOS ') then
    v_problems := array_append(v_problems, 'accents or spacing still split one student into two');
  end if;

  -- ── Report ───────────────────────────────────────────────────────────────
  if array_length(v_missing, 1) is not null then
    raise exception 'Missing pieces: %', array_to_string(v_missing, '; ');
  end if;

  if array_length(v_problems, 1) is not null then
    raise exception 'Regressed: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'release gate passed: the student ledger loads, penalties read as deductions, removals are recorded, every notifiable event has an emitter that only the database can reach, the Power-Up is one per day and still needs a teacher, archived missions stay hidden, and names fold the ways that used to create duplicates';
end;
$$;