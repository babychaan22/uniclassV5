-- Individual classes intentionally have zero groups. Grouped classes still require 1–12 groups.
alter table public.classrooms drop constraint if exists classrooms_num_groups_check;
alter table public.classrooms
  add constraint classrooms_num_groups_check
  check (
    (coalesce(uses_groups, true) and num_groups between 1 and 12)
    or (not coalesce(uses_groups, true) and num_groups = 0)
  );
