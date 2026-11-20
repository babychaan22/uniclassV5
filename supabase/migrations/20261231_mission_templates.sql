-- ────────────────────────────────────────────────────────────────────────────
-- Mission templates (audit item #4)
--
-- Teachers rebuild the same weekly quizzes and sorting drills class after
-- class. This gives Missions a personal template shelf: any saved mission can
-- be bookmarked as a template, and a template prefills the creation form
-- (learning target, questions, answers, scoring) so publishing a fresh copy is
-- a few taps.
--
-- Deliberately simple: a plain teacher-owned table, not a mission mirror.
-- Templates are personal (each teacher only sees their own), so no sharing,
-- approval, or guard triggers are needed here.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.mission_templates (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid not null references auth.users(id) on delete cascade,
  title          text not null,
  description    text,
  -- Mirror the missions constraint (20261204) so a template can always be
  -- turned into a mission without tripping that check.
  formative_type text not null default 'manual'
    check (formative_type in ('manual', 'true_false', 'multiple_choice', 'drag_drop', 'fill_in_blank')),
  xp_reward      int not null default 100 check (xp_reward >= 0),
  max_score      int not null default 10 check (max_score >= 1),
  -- Same payload shapes as missions.ai_content / missions.answer_key for the
  -- AI-assessed formats; learning_target etc. for manual ones.
  ai_content     jsonb,
  answer_key     jsonb,
  target_statuses jsonb not null default '["On Track","Developing","At Risk","Not enough data"]'::jsonb,
  subject        text,
  use_count      int not null default 0 check (use_count >= 0),
  created_date   timestamptz not null default now()
);

alter table public.mission_templates enable row level security;

drop policy if exists "teacher_crud_own_templates" on public.mission_templates;
create policy "teacher_crud_own_templates"
  on public.mission_templates for all to authenticated
  using  (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

grant select, insert, update, delete on public.mission_templates to authenticated;

create index if not exists idx_mission_templates_teacher
  on public.mission_templates (teacher_id, created_date desc);

-- ── Verification ──────────────────────────────────────────────────────────
do $$
declare
  v_policies int;
  v_type_check boolean;
begin
  select count(*) into v_policies from pg_policies
    where schemaname = 'public' and tablename = 'mission_templates';
  if v_policies <> 1 then
    raise exception 'mission_templates must expose exactly one teacher-CRUD policy; found %', v_policies;
  end if;

  select exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'mission_templates'
      and c.conname like '%formative_type%'
      and c.contype = 'c'
  ) into v_type_check;
  if not v_type_check then
    raise exception 'mission_templates is missing the formative_type check constraint';
  end if;

  raise notice 'mission_templates ready (RLS: teacher-owned CRUD)';
end $$;
