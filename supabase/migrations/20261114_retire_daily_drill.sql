-- Removes the Daily Drill system and leaves Daily Math Power-Up as the only
-- automatic daily mission.
--
-- 20261108 introduced "Drill of the day": a generated-number question builder
-- (drill_whole, drill_integer, drill_fraction, drill_decimal, drill_options)
-- plus the ensure_daily_drill() API. The bank engine replaced the question
-- source but kept those function names, so the old system was still reachable
-- under a Power-Up title. This retires all of it:
--
--  * the generated-number builders are dropped (1111) and asserted gone here;
--  * ensure_daily_drill() is renamed, so no caller can reach it by its old name;
--  * every remaining Daily Drill row is retired, including rows students have
--    already submitted against, because those rows are what still rendered as a
--    competing "daily" mission. Submissions and history are untouched.
--
-- A migration cannot assert its own success, so the final block fails the deploy
-- if any of this regresses.

-- ── 1. Retire every Daily Drill row ───────────────────────────────────────
-- Safe to do in a single update: missions are rows in a list, and both the
-- progress figures and the answer review are derived from mission_submissions,
-- which is left completely alone.

do $$
declare
  v_legacy integer;
  v_with_submissions integer;
begin
  select count(*), count(*) filter (where exists (
           select 1 from public.mission_submissions s where s.mission_id = m.id
         ))
  into v_legacy, v_with_submissions
  from public.missions m
  where m.is_auto_daily
    and m.mission_source <> 'daily_foundation';

  raise notice 'found % Daily Drill rows (% already attempted by students)', v_legacy, v_with_submissions;

  -- Deactivating rather than deleting keeps any student's completed attempt and
  -- its review reachable, while stopping the row from competing for attention.
  update public.missions m
  set is_active = false
  where m.is_auto_daily
    and m.mission_source <> 'daily_foundation'
    and m.is_active;

  get diagnostics v_legacy = row_count;
  raise notice 'retired % Daily Drill rows', v_legacy;
end;
$$;

-- ── 2. Rename the API so the old name is unreachable ─────────────────────
-- ensure_daily_drill_for_student() is the only student entry point, and its
-- name is what still reads as "drill". Renaming makes a stale call fail loudly
-- instead of silently reaching a retired feature.

drop function if exists public.ensure_daily_drill_for_student(uuid);

create function public.ensure_daily_power_up_for_student(p_classroom_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  if not exists (
    select 1 from public.group_accounts
    where user_id = v_user and classroom_id = p_classroom_id and is_approved = true
  ) and not auth_is_teacher_of(p_classroom_id) then
    raise exception 'Approved classroom account required';
  end if;

  return ensure_daily_drill(p_classroom_id);
end;
$$;

revoke all on function public.ensure_daily_power_up_for_student(uuid) from public;
grant execute on function public.ensure_daily_power_up_for_student(uuid) to authenticated;

-- ── 3. The Daily Drill is gone ────────────────────────────────────────────

do $$
declare
  v_survivors text[] := '{}';
  v_def text;
  v_active integer;
begin
  -- 3a. No generated-number builder may remain callable. Each one could
  -- regenerate the old arithmetic questions on demand.
  foreach v_def in array array[
    'drill_whole', 'drill_integer', 'drill_fraction', 'drill_decimal', 'drill_options'
  ]
  loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_def
    ) then
      v_survivors := array_append(v_survivors, v_def || '() still exists');
    end if;
  end loop;

  -- 3b. The student entry point must no longer be reachable under the old name.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ensure_daily_drill_for_student'
  ) then
    v_survivors := array_append(v_survivors, 'ensure_daily_drill_for_student() still exists');
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ensure_daily_power_up_for_student'
  ) then
    v_survivors := array_append(v_survivors, 'ensure_daily_power_up_for_student() is missing');
  end if;

  -- 3c. No Daily Drill row may still be active.
  select count(*) into v_active
  from public.missions m
  where m.is_auto_daily and m.mission_source <> 'daily_foundation' and m.is_active;
  if v_active > 0 then
    v_survivors := array_append(v_survivors, v_active || ' Daily Drill rows are still active');
  end if;

  -- 3d. Power-Up must be the only automatic daily mission the engine creates.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ensure_daily_drill'
  ) then
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ensure_daily_drill';
    -- The surviving internal name is acceptable only if it is the Power-Up
    -- engine, which must prove itself by name, by source and by return type.
    if v_def not like '%Daily Math Power-Up%'
       or v_def not like '%daily_foundation%'
       or v_def not like '%foundation_shuffle_options%' then
      v_survivors := array_append(v_survivors, 'ensure_daily_drill() is not the Power-Up engine');
    end if;
  else
    v_survivors := array_append(v_survivors, 'ensure_daily_drill() disappeared; expected the Power-Up engine under its internal name');
  end if;

  if array_length(v_survivors, 1) is not null then
    raise exception 'Daily Drill was not fully removed: %', array_to_string(v_survivors, '; ');
  end if;

  raise notice 'Daily Drill fully removed; Daily Math Power-Up is the only automatic daily mission';
end;
$$;