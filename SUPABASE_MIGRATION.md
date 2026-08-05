# UniClass → Supabase Migration Guide

## What Changed

| Layer | Before | After |
|---|---|---|
| Backend host | Base44 | Supabase |
| Auth | `@base44/sdk` auth | `@supabase/supabase-js` auth |
| Database | Base44 entity API | Supabase PostgreSQL (same JS API surface) |
| Vite plugin | `@base44/vite-plugin` | Removed |
| Env vars | `VITE_BASE44_APP_ID` etc. | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` |

### Files replaced / added

| File | Action |
|---|---|
| `src/api/supabaseClient.js` | **NEW** — replaces `base44Client.js`; sets `globalThis.__B44_DB__` |
| `src/lib/AuthContext.jsx` | **REPLACED** — uses `supabase.auth.onAuthStateChange` |
| `src/lib/teacherClassroom.js` | **IMPORT ONLY** — one line changed |
| `src/lib/PageNotFound.jsx` | **IMPORT ONLY** — now imports `db` directly |
| `src/pages/Login.jsx` | **REPLACED** — `signInWithPassword` / `signInWithOAuth` |
| `src/pages/Register.jsx` | **REPLACED** — `signUp` / `verifyOtp` / `resend` |
| `src/pages/ForgotPassword.jsx` | **REPLACED** — `resetPasswordForEmail` |
| `src/pages/ResetPassword.jsx` | **REPLACED** — `updateUser` + `PASSWORD_RECOVERY` event |
| `src/main.jsx` | **UPDATED** — imports `supabaseClient` instead of `base44Client` |
| `vite.config.js` | **UPDATED** — base44 plugin removed, `@` alias added |
| `package.json` | **UPDATED** — `@supabase/supabase-js` in, `@base44/*` out |

### Files that need NO changes (zero rewrites)

All page files that use `const db = globalThis.__B44_DB__` continue working
unchanged because `supabaseClient.js` sets the same global on import.
This covers every page in `src/pages/student/`, `src/pages/teacher/`,
`src/pages/Leaderboard.jsx`, `src/pages/RoleRouter.jsx`,
`src/pages/WaitingApproval.jsx`, `src/lib/badgeService.js`,
`src/lib/scanService.js`, and all UI components.

---

## Step 1 — Create a Supabase project

1. Go to <https://supabase.com> and create a new project.
2. Note your **Project URL** and **anon/public API key** (Settings → API).

---

## Step 2 — Environment variables

Create `.env.local` in the project root:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Delete (or leave ignored) the old Base44 env vars:
- `VITE_BASE44_APP_ID`
- `VITE_BASE44_APP_BASE_URL`
- `VITE_BASE44_FUNCTIONS_VERSION`

---

## Step 3 — Run the SQL schema in Supabase SQL Editor

Open **Supabase Dashboard → SQL Editor** and run the script below.

> **Already ran this schema before (fresh project only had one account per
> group)?** Skip the `create table` script and instead run just this
> upgrade block, which adds individual student accounts + group
> representatives without touching existing data:
> ```sql
> alter table group_accounts add column if not exists group_member_id uuid references group_members(id) on delete set null;
> alter table group_accounts add column if not exists is_representative boolean not null default false;
> create unique index if not exists idx_one_representative_per_group
>   on group_accounts(group_id) where is_representative = true;
> create index if not exists idx_group_accounts_member on group_accounts(group_member_id);
> -- Backfill: treat each group's existing sole account as its representative
> -- and link it to the member row it created during onboarding.
> update group_accounts ga set is_representative = true
>   where not exists (
>     select 1 from group_accounts ga2
>     where ga2.group_id = ga.group_id and ga2.id < ga.id
>   );
> update group_accounts ga set group_member_id = (
>   select gm.id from group_members gm
>   where gm.group_id = ga.group_id and gm.is_account_holder = true
>   limit 1
> ) where group_member_id is null;
> ```
> Then run the indexes and RLS blocks near the bottom of the script below
> (everything from `-- Indexes` onward) if you haven't already.

```sql
-- ============================================================
-- UniClass — Supabase schema
-- All tables mirror the Base44 entity definitions exactly.
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Helper: every table gets id + created_date automatically.
-- (created_date keeps the column name the rest of the app expects.)

-- ── classrooms ──────────────────────────────────────────────
create table classrooms (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  teacher_id   uuid not null,
  grade_level  text not null,
  section      text not null,
  school_year  text not null,
  subject      text,
  num_groups   int not null default 8,
  join_code    text not null unique
);

-- ── class_settings ──────────────────────────────────────────
create table class_settings (
  id                       uuid primary key default gen_random_uuid(),
  created_date             timestamptz not null default now(),
  classroom_id             uuid not null references classrooms(id) on delete cascade,
  weight_attendance        numeric not null default 10,
  weight_activity_scores   numeric not null default 20,
  weight_quizzes           numeric not null default 20,
  weight_major_exams       numeric not null default 30,
  weight_performance_tasks numeric not null default 20,
  weight_participation     numeric not null default 0
);

-- ── grading_terms ────────────────────────────────────────────
create table grading_terms (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  classroom_id uuid not null references classrooms(id) on delete cascade,
  term_label   text not null,
  start_date   date not null,
  end_date     date not null,
  is_active    boolean not null default false
);

-- ── groups ───────────────────────────────────────────────────
create table groups (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  classroom_id uuid not null references classrooms(id) on delete cascade,
  group_number int not null,
  group_name   text
);

-- ── group_members ────────────────────────────────────────────
create table group_members (
  id                uuid primary key default gen_random_uuid(),
  created_date      timestamptz not null default now(),
  group_id          uuid not null references groups(id) on delete cascade,
  classroom_id      uuid not null references classrooms(id) on delete cascade,
  last_name         text not null,
  first_name        text not null,
  is_account_holder boolean not null default false
);

-- ── group_accounts ───────────────────────────────────────────
create table group_accounts (
  id                uuid primary key default gen_random_uuid(),
  created_date      timestamptz not null default now(),
  user_id           uuid not null,   -- references auth.users(id)
  group_id          uuid not null references groups(id) on delete cascade,
  classroom_id      uuid not null references classrooms(id) on delete cascade,
  group_member_id   uuid references group_members(id) on delete set null,
  last_name         text not null,
  first_name        text not null,
  email             text,
  is_approved       boolean not null default false,
  is_representative boolean not null default false
);

-- Only one representative per group, enforced at the database level —
-- an insert/update that would create a second one fails with a
-- unique_violation (Postgres error code 23505), which the app catches
-- and turns into a friendly "already claimed" message.
create unique index idx_one_representative_per_group
  on group_accounts(group_id)
  where is_representative = true;

-- ── activities ───────────────────────────────────────────────
create table activities (
  id              uuid primary key default gen_random_uuid(),
  created_date    timestamptz not null default now(),
  classroom_id    uuid not null references classrooms(id) on delete cascade,
  activity_number int,
  title           text not null,
  max_score       numeric not null default 10,
  week_label      text
);

-- ── activity_scores ──────────────────────────────────────────
create table activity_scores (
  id              uuid primary key default gen_random_uuid(),
  created_date    timestamptz not null default now(),
  group_member_id uuid not null references group_members(id) on delete cascade,
  activity_id     uuid not null references activities(id) on delete cascade,
  classroom_id    uuid not null references classrooms(id) on delete cascade,
  group_id        uuid references groups(id) on delete set null,
  score           numeric not null,
  encoded_by      uuid
);

-- ── attendances ──────────────────────────────────────────────
create table attendances (
  id              uuid primary key default gen_random_uuid(),
  created_date    timestamptz not null default now(),
  classroom_id    uuid not null references classrooms(id) on delete cascade,
  group_id        uuid not null references groups(id) on delete cascade,
  group_member_id uuid not null references group_members(id) on delete cascade,
  attendance_date date not null,
  status          text not null default 'present'
                    check (status in ('present','absent','late','excused')),
  marked_by       uuid
);

-- ── teacher_assessments ──────────────────────────────────────
create table teacher_assessments (
  id              uuid primary key default gen_random_uuid(),
  created_date    timestamptz not null default now(),
  group_member_id uuid not null references group_members(id) on delete cascade,
  group_id        uuid references groups(id) on delete set null,
  classroom_id    uuid not null references classrooms(id) on delete cascade,
  category        text not null
                    check (category in ('quiz','major_exam','performance_task')),
  item_label      text,
  score           numeric not null,
  max_score       numeric not null,
  encoded_by      uuid
);

-- ── qr_codes ─────────────────────────────────────────────────
create table qr_codes (
  id                  uuid primary key default gen_random_uuid(),
  created_date        timestamptz not null default now(),
  hash                text not null unique,
  classroom_id        uuid not null references classrooms(id) on delete cascade,
  qr_type             text not null default 'standard'
                        check (qr_type in ('standard','gacha')),
  base_points         numeric not null default 10,
  is_used             boolean not null default false,
  used_by_member_id   uuid references group_members(id) on delete set null,
  used_at             timestamptz,
  created_by          uuid
);

-- ── participation_logs ───────────────────────────────────────
create table participation_logs (
  id              uuid primary key default gen_random_uuid(),
  created_date    timestamptz not null default now(),
  group_member_id uuid references group_members(id) on delete set null,
  group_id        uuid not null references groups(id) on delete cascade,
  classroom_id    uuid not null references classrooms(id) on delete cascade,
  qr_code_id      uuid references qr_codes(id) on delete set null,
  points_awarded  numeric not null,
  event_type      text not null default 'scan'
                    check (event_type in ('scan','gacha_win','gacha_loss',
                                          'gacha_even','behavior_penalty',
                                          'mission_redemption','badge')),
  multiplier      numeric not null default 1,
  note            text
);

-- ── badges ───────────────────────────────────────────────────
create table badges (
  id              uuid primary key default gen_random_uuid(),
  created_date    timestamptz not null default now(),
  group_id        uuid not null references groups(id) on delete cascade,
  classroom_id    uuid not null references classrooms(id) on delete cascade,
  badge_type      text not null
                    check (badge_type in ('weekly_90_activity','weekly_full_attendance',
                                          'weekly_top_group_points','weekly_top_individual_points')),
  week_start_date date not null,
  points_awarded  numeric not null,
  redeemed_by     uuid
);

-- ── missions ─────────────────────────────────────────────────
create table missions (
  id             uuid primary key default gen_random_uuid(),
  created_date   timestamptz not null default now(),
  classroom_id   uuid not null references classrooms(id) on delete cascade,
  title          text not null,
  description    text,
  xp_reward      numeric not null default 100,
  max_score      numeric not null default 10,
  deadline       date,
  is_active      boolean not null default false,
  created_by     uuid,
  formative_type text not null default 'manual'
                   check (formative_type in ('manual','true_false',
                                             'multiple_choice','drag_drop')),
  ai_content     text,
  answer_key     text
);

-- ── mission_submissions ──────────────────────────────────────
create table mission_submissions (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  mission_id   uuid not null references missions(id) on delete cascade,
  group_id     uuid not null references groups(id) on delete cascade,
  classroom_id uuid not null references classrooms(id) on delete cascade,
  score        numeric not null,
  xp_earned    numeric not null,
  graded_by    uuid,
  answers      text
);

-- ── rewards ──────────────────────────────────────────────────
create table rewards (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  classroom_id uuid not null references classrooms(id) on delete cascade,
  title        text not null,
  description  text,
  emoji        text not null default '🎁',
  cost_points  numeric not null default 50,
  is_active    boolean not null default true,
  created_by   uuid
);

-- ── reward_redemptions ───────────────────────────────────────
create table reward_redemptions (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  reward_id    uuid not null references rewards(id) on delete cascade,
  reward_title text,
  group_id     uuid not null references groups(id) on delete cascade,
  classroom_id uuid not null references classrooms(id) on delete cascade,
  points_spent numeric not null,
  redeemed_by  uuid
);

-- ── announcements ────────────────────────────────────────────
create table announcements (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  classroom_id uuid not null references classrooms(id) on delete cascade,
  title        text not null,
  body         text not null,
  is_pinned    boolean not null default true,
  created_by   uuid
);

-- ── profiles (extends auth.users) ───────────────────────────
-- Stores the `role` field from User.jsonc.
-- A trigger keeps it in sync with new signups.
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  created_date timestamptz not null default now(),
  email        text,
  role         text not null default 'user'
                 check (role in ('admin','user'))
);

-- Auto-create a profile row for every new Supabase auth user.
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();


-- ============================================================
-- Indexes — Postgres does NOT auto-index foreign key columns
-- (only primary keys get one). Every page in this app filters by
-- classroom_id/group_id/group_member_id, so without these every
-- such query is a full table scan.
-- ============================================================
create index idx_class_settings_classroom       on class_settings(classroom_id);
create index idx_grading_terms_classroom         on grading_terms(classroom_id);
create index idx_groups_classroom                on groups(classroom_id);
create index idx_group_members_classroom         on group_members(classroom_id);
create index idx_group_members_group             on group_members(group_id);
create index idx_group_accounts_classroom        on group_accounts(classroom_id);
create index idx_group_accounts_group            on group_accounts(group_id);
create index idx_group_accounts_user             on group_accounts(user_id);
create index idx_group_accounts_member            on group_accounts(group_member_id);
create index idx_activities_classroom            on activities(classroom_id);
create index idx_activity_scores_classroom       on activity_scores(classroom_id);
create index idx_activity_scores_member          on activity_scores(group_member_id);
create index idx_attendances_classroom           on attendances(classroom_id);
create index idx_attendances_member              on attendances(group_member_id);
create index idx_teacher_assessments_classroom   on teacher_assessments(classroom_id);
create index idx_teacher_assessments_member      on teacher_assessments(group_member_id);
create index idx_qr_codes_classroom              on qr_codes(classroom_id);
create index idx_participation_logs_classroom    on participation_logs(classroom_id);
create index idx_participation_logs_group        on participation_logs(group_id);
create index idx_participation_logs_member       on participation_logs(group_member_id);
create index idx_badges_classroom                on badges(classroom_id);
create index idx_missions_classroom              on missions(classroom_id);
create index idx_mission_submissions_mission     on mission_submissions(mission_id);
create index idx_mission_submissions_classroom   on mission_submissions(classroom_id);
create index idx_rewards_classroom               on rewards(classroom_id);
create index idx_reward_redemptions_classroom    on reward_redemptions(classroom_id);
create index idx_announcements_classroom         on announcements(classroom_id);

-- ============================================================
-- Data-integrity constraint — prevents the same weekly badge from
-- being awarded to a group twice even under concurrent requests.
-- (The app already checks for an existing badge before inserting,
-- but that check-then-insert has a race window; this closes it at
-- the database level.)
-- ============================================================
alter table badges
  add constraint badges_unique_weekly_award
  unique (group_id, badge_type, week_start_date);


-- ============================================================
-- Row-Level Security (RLS)
-- ============================================================
-- Enable RLS on every table, then open access with anon key
-- (same trust model as Base44's default).
-- Tighten these policies once you are ready to enforce ownership.

alter table classrooms          enable row level security;
alter table class_settings      enable row level security;
alter table grading_terms       enable row level security;
alter table groups              enable row level security;
alter table group_members       enable row level security;
alter table group_accounts      enable row level security;
alter table activities          enable row level security;
alter table activity_scores     enable row level security;
alter table attendances         enable row level security;
alter table teacher_assessments enable row level security;
alter table qr_codes            enable row level security;
alter table participation_logs  enable row level security;
alter table badges              enable row level security;
alter table missions            enable row level security;
alter table mission_submissions enable row level security;
alter table rewards             enable row level security;
alter table reward_redemptions  enable row level security;
alter table announcements       enable row level security;
alter table profiles            enable row level security;

-- Permissive default: authenticated users can read and write everything.
-- Replace with ownership-based policies when you are ready.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'classrooms','class_settings','grading_terms','groups','group_members',
    'group_accounts','activities','activity_scores','attendances',
    'teacher_assessments','qr_codes','participation_logs','badges',
    'missions','mission_submissions','rewards','reward_redemptions',
    'announcements','profiles'
  ]
  loop
    execute format(
      'create policy "authenticated_full_access" on %I
       for all to authenticated using (true) with check (true)', tbl
    );
  end loop;
end $$;
```

---

## Step 3b — Enable Realtime (required for live mission updates)

The Teacher Missions page listens for new mission submissions live. Enable
replication on that table in the SQL Editor:

```sql
alter publication supabase_realtime add table mission_submissions;
```

(Add any other table here later if you wire up more live subscriptions —
see the `.subscribe()` helper in `src/api/supabaseClient.js`.)

---

## Step 3c — AI mission generation (OpenRouter + Gemini fallback)

AI-generated missions (Teacher → Missions → "Generate with AI") route
through Supabase Edge Functions so API keys never reach the browser bundle.

1. **OpenRouter** (primary):
   1. Create a free account at <https://openrouter.ai> and generate an API key.
   2. Set it as a Supabase secret:
      ```bash
      supabase secrets set OPENROUTER_API_KEY=sk-or-...
      ```

2. **Gemini** (fallback — only set this if you have a Gemini API key and want
   a backup when OpenRouter's free models are exhausted):
   1. Get a free API key from <https://aistudio.google.com/> (Google AI Studio
      free tier — no credit card required).
   2. Set it as a Supabase secret:
      ```bash
      supabase secrets set GEMINI_API_KEY=sk-...
      ```
   3. (Optional) Override the model:
      ```bash
      supabase secrets set GEMINI_MODEL=gemini-2.0-flash
      ```
      Default model is `gemini-1.5-flash`.

3. Deploy the edge functions:
   ```bash
   cd project
   supabase functions deploy openrouter-proxy
   supabase functions deploy gemini-proxy
   ```
   Or run the helper script: `deploy-edge-functions.bat` (edit the API
   keys inside first).

   **Project reference**: `rqvrndkhjrammmsdrinz` — your local
   `.env.local` already points to this project.

The `invokeLLM()` function in `src/lib/aiService.js` tries OpenRouter first,
then falls back to Gemini automatically. Both edge functions try a chain of
free models and fall through if one is rate-limited.

#### Remove Google OAuth (Step 3d)

Google OAuth sign-in has been removed from the app to avoid Google Cloud
billing setup. Authentication is now email + OTP only via Supabase Auth.

---

## Step 5 — Supabase Auth email templates

Supabase sends confirmation / password-reset emails automatically.
Customise them in: Dashboard → Authentication → Email Templates.

Make sure the **Confirm signup** template is set to OTP (6-digit code)
style, which matches the OTP input in `Register.jsx`.

---

## Step 6 — Install and run

```bash
# Remove old Base44 packages and install Supabase
npm install

# Start the dev server (no base44 CLI needed anymore)
npm run dev
```

---

## Step 7 — (Optional) Tighten Row-Level Security

The default policy lets any authenticated user read/write any row.
Below are example ownership policies you can swap in:

```sql
-- Teachers can only see their own classrooms
drop policy if exists "authenticated_full_access" on classrooms;

create policy "teacher_own_classroom" on classrooms
  for all to authenticated
  using  (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

-- Students can only see the classroom they belong to
create policy "student_read_classroom" on classrooms
  for select to authenticated
  using (
    id in (
      select classroom_id from group_accounts where user_id = auth.uid()
    )
  );
```

Repeat similar patterns for each table. The `classroom_id` foreign key on
every table makes it straightforward to cascade ownership checks.

---

## Mapping: Base44 SDK → Supabase

| Base44 call | Supabase equivalent (via wrapper) |
|---|---|
| `db.entities.X.filter({ k: v })` | `supabase.from(t).select('*').eq('k',v)` |
| `db.entities.X.get(id)` | `supabase.from(t).select('*').eq('id',id).single()` |
| `db.entities.X.create(obj)` | `supabase.from(t).insert(obj).select().single()` |
| `db.entities.X.update(id, obj)` | `supabase.from(t).update(obj).eq('id',id).select().single()` |
| `db.entities.X.delete(id)` | `supabase.from(t).delete().eq('id',id)` |
| `db.entities.X.bulkCreate([…])` | `supabase.from(t).insert([…]).select()` |
| `db.entities.X.bulkUpdate([…])` | parallel `.update().eq('id',…)` calls |
| `base44.auth.me()` | `supabase.auth.getUser()` |
| `base44.auth.loginViaEmailPassword` | `supabase.auth.signInWithPassword` |
| `base44.auth.loginWithProvider` | `supabase.auth.signInWithOAuth` |
| `base44.auth.logout` | `supabase.auth.signOut` |
| `base44.auth.register` | `supabase.auth.signUp` |
| `base44.auth.verifyOtp` | `supabase.auth.verifyOtp` |
| `base44.auth.resendOtp` | `supabase.auth.resend` |
| `base44.auth.resetPasswordRequest` | `supabase.auth.resetPasswordForEmail` |
| `base44.auth.resetPassword` | `supabase.auth.updateUser({ password })` |

## Entity → Table name map

| Base44 entity | Supabase table |
|---|---|
| Activity | activities |
| ActivityScore | activity_scores |
| Announcement | announcements |
| Attendance | attendances |
| Badge | badges |
| Classroom | classrooms |
| ClassSettings | class_settings |
| GradingTerm | grading_terms |
| Group | groups |
| GroupAccount | group_accounts |
| GroupMember | group_members |
| Mission | missions |
| MissionSubmission | mission_submissions |
| ParticipationLog | participation_logs |
| QRCode | qr_codes |
| Reward | rewards |
| RewardRedemption | reward_redemptions |
| TeacherAssessment | teacher_assessments |
| User | profiles |
