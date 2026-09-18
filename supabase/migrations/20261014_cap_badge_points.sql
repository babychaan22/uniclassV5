-- Never let a badge inflate the classroom economy beyond ten points.
update public.badge_definitions set points = least(points, 10) where points > 10;
alter table public.badge_definitions drop constraint if exists badge_definitions_points_cap;
alter table public.badge_definitions add constraint badge_definitions_points_cap check (points between 0 and 10);

create or replace function public.cap_badge_points()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.points_awarded > 10 then new.points_awarded := 10; end if;
  return new;
end; $$;
drop trigger if exists cap_badge_points on public.badges;
create trigger cap_badge_points before insert or update on public.badges for each row execute function public.cap_badge_points();
drop trigger if exists cap_badge_log_points on public.participation_logs;
create trigger cap_badge_log_points before insert or update on public.participation_logs for each row when (new.event_type='badge') execute function public.cap_badge_points();
