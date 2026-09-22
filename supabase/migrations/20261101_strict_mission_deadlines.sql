-- A mission deadline is a precise Manila date and time. The database guards
-- both first submissions and feedback-only retry submissions so a stale client
-- cannot submit after the teacher's deadline.
alter table public.missions add column if not exists deadline_at timestamptz;

update public.missions
set deadline_at = (deadline::timestamp + time '23:59:59') at time zone 'Asia/Manila'
where deadline_at is null and deadline is not null;

create or replace function public.enforce_mission_deadline()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_deadline timestamptz;
begin
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
