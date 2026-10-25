-- Allow the mission type already supported by the assessment and grading UI.
alter table public.missions drop constraint if exists missions_formative_type_check;
alter table public.missions add constraint missions_formative_type_check
  check (formative_type in ('manual', 'true_false', 'multiple_choice', 'drag_drop', 'fill_in_blank'));
