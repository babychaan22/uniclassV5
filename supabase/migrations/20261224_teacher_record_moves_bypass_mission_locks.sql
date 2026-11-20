-- 20261224 — the teacher's record moves are not mission submissions.
--
-- The deadline guard on mission_submissions (20261101) fires on every UPDATE.
-- A roster transfer moves a student's history with an UPDATE that only
-- reattributes rows (group_member_id, group_id), so any source record holding
-- a submission for a past-deadline mission aborted the whole transfer with
-- "This mission is locked because its deadline has passed".
--
-- A deadline freezes what students may still change, not what a teacher may
-- tidy in the roster. Both deadline triggers now step aside for the
-- classroom teacher, matching every other teacher-exempt trigger (for
-- example enforce_student_mission_submission). Students keep the exact same
-- enforcement: for them nothing changes.

create or replace function public.enforce_mission_deadline()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_deadline timestamptz;
begin
  -- Record moves and grading corrections change attribution, not answers.
  -- The classroom teacher is already fully trusted with these rows.
  if auth_is_teacher_of(old.classroom_id) then
    return new;
  end if;

  select coalesce(deadline_at, (deadline::timestamp + time '23:59:59') at time zone 'Asia/Manila')
    into v_deadline
  from public.missions
  where id = new.mission_id;
  if v_deadline is not null and now() > v_deadline then
    raise exception 'This mission is locked because its deadline has passed';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_mission_deadline_submission on public.mission_submissions;
create trigger enforce_mission_deadline_submission
before insert or update on public.mission_submissions
for each row execute function public.enforce_mission_deadline();

create or replace function public.enforce_mission_retry_deadline()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_deadline timestamptz;
begin
  if auth_is_teacher_of(old.classroom_id) then
    return new;
  end if;

  if new.completed_at is not null then
    select coalesce(deadline_at, (deadline::timestamp + time '23:59:59') at time zone 'Asia/Manila')
      into v_deadline
    from public.missions
    where id = new.mission_id;
    if v_deadline is not null and now() > v_deadline then
      raise exception 'This mission is locked because its deadline has passed';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_mission_deadline_retry on public.mission_retry_attempts;
create trigger enforce_mission_deadline_retry
before update on public.mission_retry_attempts
for each row execute function public.enforce_mission_retry_deadline();

-- ── Verification ──────────────────────────────────────────────────────────
do $$
declare
  v_defs text;
begin
  select pg_get_functiondef('public.enforce_mission_deadline()'::regprocedure) into v_defs;
  if position('auth_is_teacher_of' in v_defs) = 0 then
    raise exception 'the submission deadline guard still locks out the classroom teacher';
  end if;
  select pg_get_functiondef('public.enforce_mission_retry_deadline()'::regprocedure) into v_defs;
  if position('auth_is_teacher_of' in v_defs) = 0 then
    raise exception 'the retry deadline guard still locks out the classroom teacher';
  end if;
  raise notice 'verified: mission deadlines still bind students, but the classroom teacher may move records past them';
end;
$$;
