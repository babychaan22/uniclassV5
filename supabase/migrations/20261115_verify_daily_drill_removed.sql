-- Independent check that the Daily Drill retirement held, kept separate from
-- the migration that performs it so this asserts against the committed state
-- rather than the run that created it.

do $$
declare
  v_problems text[] := '{}';
  v_legacy_active integer;
  v_legacy_total integer;
  v_power_up_active integer;
  v_builder integer;
  v_dangling integer;
begin
  -- No Daily Drill row may still be active.
  select count(*) into v_legacy_total
  from public.missions m
  where m.is_auto_daily and m.mission_source <> 'daily_foundation';

  select count(*) into v_legacy_active
  from public.missions m
  where m.is_auto_daily and m.mission_source <> 'daily_foundation' and m.is_active;

  if v_legacy_active > 0 then
    v_problems := array_append(v_problems, v_legacy_active || ' of ' || v_legacy_total || ' Daily Drill rows are still active');
  end if;
  raise notice 'Daily Drill rows: % total, % still active', v_legacy_total, v_legacy_active;

  -- Every generated-number builder must be gone. These could rebuild the old
  -- arithmetic questions at any time if they survived.
  select count(*) into v_builder
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('drill_whole', 'drill_integer', 'drill_fraction', 'drill_decimal', 'drill_options');

  if v_builder > 0 then
    v_problems := array_append(v_problems, v_builder || ' generated-number builder(s) survived retirement');
  end if;

  -- The retired student entry point must be unreachable under its old name,
  -- otherwise a stale client call could still reach it.
  select count(*) into v_builder
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ensure_daily_drill_for_student';

  if v_builder > 0 then
    v_problems := array_append(v_problems, 'ensure_daily_drill_for_student() is still callable');
  end if;

  -- The replacement must exist and be executable by students, otherwise
  -- renaming broke the feature.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ensure_daily_power_up_for_student'
  ) then
    v_problems := array_append(v_problems, 'ensure_daily_power_up_for_student() is missing');
  elsif not exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'ensure_daily_power_up_for_student'
      and grantee = 'authenticated'
  ) then
    v_problems := array_append(v_problems, 'students cannot call ensure_daily_power_up_for_student()');
  end if;

  -- The surviving internal name must be the Power-Up engine in substance, not
  -- just in name: bank selection, option shuffling, and the sanitised return.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'ensure_daily_drill'
      -- Title written into ai_content.
      and pg_get_functiondef(p.oid) like '%Daily Math Power-Up%'
      -- Selection comes from the approved bank, not a generator.
      and pg_get_functiondef(p.oid) like '%foundation_questions%'
      -- Options are shuffled per mission with the key realigned.
      and pg_get_functiondef(p.oid) like '%foundation_shuffle_options%'
      -- The response is stripped of answers.
      and pg_get_functiondef(p.oid) like '%sanitize_mission_for_student%'
      -- The old generated title must be gone for good.
      and pg_get_functiondef(p.oid) not like '%Drill of the day%'
  ) then
    v_problems := array_append(v_problems, 'ensure_daily_drill() is not the Power-Up engine');
  end if;

  -- Nothing may reference a dropped function, or the next call errors at runtime.
  select count(*) into v_dangling
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname <> 'ensure_daily_drill'
    and (
      pg_get_functiondef(p.oid) like '%drill_whole(%'
      or pg_get_functiondef(p.oid) like '%drill_integer(%'
      or pg_get_functiondef(p.oid) like '%drill_fraction(%'
      or pg_get_functiondef(p.oid) like '%drill_decimal(%'
      or pg_get_functiondef(p.oid) like '%drill_options(%'
      or pg_get_functiondef(p.oid) like '%ensure_daily_drill_for_student(%'
    );

  if v_dangling > 0 then
    v_problems := array_append(v_problems, v_dangling || ' function(s) still call a dropped function');
  end if;

  -- A Power-Up that was already generated must still be intact and current.
  select count(*) into v_power_up_active
  from public.missions m
  where m.mission_source = 'daily_foundation' and m.is_active;
  raise notice 'active Daily Math Power-Up rows right now: %', v_power_up_active;

  if array_length(v_problems, 1) is not null then
    raise exception 'Daily Drill retirement incomplete: %', array_to_string(v_problems, '; ');
  end if;

  raise notice 'verified: Daily Drill removed, Daily Math Power-Up is the only automatic daily mission';
end;
$$;