-- 20261124 — one Power-Up per classroom per day, proven and kept true.
--
-- Reported symptom: "multiple automatic missions for sections/classes." That
-- is not duplication. Each Mathematics classroom gets its own Power-Up, so a
-- teacher listing several classes sees one mission per class, and a student
-- enrolled in two Mathematics rooms correctly gets two.
--
-- What would be a real bug is two Power-Ups for the SAME classroom on the SAME
-- Manila day. That is impossible: 20261119 added
-- idx_missions_one_daily_foundation_per_day over (classroom_id, auto_daily_date)
-- for mission_source = 'daily_foundation', and ensure_daily_drill falls back to
-- reading the winner's row on unique_violation. This migration asserts both.

do $$
declare
  v_dupes     text;
  v_orphans   text;
  v_students  integer;
  v_has_index boolean;
begin
  -- No classroom may hold two Power-Ups on the same day, today or ever.
  select string_agg(classroom_id::text || ' @' || auto_daily_date::text || ' x' || c::text, ', ')
    into v_dupes
  from (
    select classroom_id, auto_daily_date, count(*) as c
    from public.missions
    where mission_source = 'daily_foundation'
      and auto_daily_date is not null
    group by 1, 2
    having count(*) > 1
  ) d;

  if v_dupes is not null then
    raise exception 'Power-Up duplicated for the same classroom/day: %', v_dupes;
  end if;

  -- The index that makes that structural must exist, or a race could
  -- reintroduce duplicates the moment two students load the page together.
  select exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'missions'
      and indexdef like '%UNIQUE%'
      and indexdef like '%auto_daily_date%'
  ) into v_has_index;

  if not v_has_index then
    raise exception 'the one-Power-Up-per-classroom-per-day unique index is missing';
  end if;

  -- Only the Power-Up may be an automatic mission. Any other source showing up
  -- here means a retired Daily Drill is still being generated.
  select string_agg(coalesce(mission_source, '<null>') || '/' || coalesce(formative_type, '<null>'), ', ')
    into v_orphans
  from (
    select distinct mission_source, formative_type
    from public.missions
    where is_auto_daily
      and (mission_source is null or mission_source <> 'daily_foundation')
  ) o;

  if v_orphans is not null then
    raise exception 'non-Power-Up automatic missions still present: %', v_orphans;
  end if;

  select count(*) into v_students
  from public.group_accounts
  where is_approved;

  raise notice
    'verified: no duplicated classroom/day, unique index present, Power-Up is the only automatic mission, % approved accounts',
    v_students;
end;
$$;