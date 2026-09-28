-- Preserve the eligibility week on badges while displaying weekend claims during
-- the following Monday-Friday school week.
alter table public.badges
  add column if not exists visible_week_start_date date;

update public.badges
set visible_week_start_date = week_start_date + 7
where visible_week_start_date is null
  and week_start_date is not null;

create index if not exists idx_badges_classroom_visible_week
  on public.badges(classroom_id, visible_week_start_date, approval_status);

create or replace function public.set_badge_visible_week_start_date()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.week_start_date is not null then
    new.visible_week_start_date := new.week_start_date + 7;
  end if;
  return new;
end;
$$;

drop trigger if exists badges_set_visible_week_start_date on public.badges;
create trigger badges_set_visible_week_start_date
  before insert or update on public.badges
  for each row
  execute function public.set_badge_visible_week_start_date();
