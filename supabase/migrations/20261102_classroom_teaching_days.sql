-- Each class declares the weekdays when it normally meets.
-- ISO weekdays are stored as text: Monday = 1 through Sunday = 7.

alter table public.classrooms
  add column if not exists class_days text[];

alter table public.classrooms
  drop constraint if exists classrooms_class_days_check;

alter table public.classrooms
  add constraint classrooms_class_days_check
  check (
    class_days is null or (
      cardinality(class_days) between 1 and 7
      and class_days <@ array['1', '2', '3', '4', '5', '6', '7']::text[]
    )
  );
