alter table public.activities add column if not exists deadline date;
alter table public.activities add column if not exists is_published boolean not null default true;
create index if not exists idx_activities_classroom_published on public.activities(classroom_id, is_published, deadline);
