# UniClass

Gamified classroom management app (QR gacha scans, XP/badges, group leaderboards)
built with **React + Vite + Supabase**.

## Prerequisites

- [Node.js 18+](https://nodejs.org/)
- A [Supabase](https://supabase.com) project

## 1. Install Node.js

See [`setup-node.ps1`](./setup-node.ps1) for an automated Windows installer script, or install manually from https://nodejs.org/.

## 2. Install dependencies

```bash
npm install
```

## 2. Configure environment variables

Create a `.env.local` file in the project root:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

You'll find both values in your Supabase dashboard under **Settings → API**.

## 3. Set up the database

Open **Supabase Dashboard → SQL Editor** and run the schema in
[`SUPABASE_MIGRATION.md`](./SUPABASE_MIGRATION.md) (Step 3). It creates every
table the app needs (classrooms, groups, activities, QR codes, badges,
missions, rewards, etc.), enables Row-Level Security, and sets up a trigger
that creates a `profiles` row for every new signup.

## 4. (Optional) Enable Google sign-in

Supabase Dashboard → **Authentication → Providers → Google**. See
`SUPABASE_MIGRATION.md` Step 4 for details.

## 5. (Optional) AI mission generation — OpenRouter free tier

The Teacher → Missions "Generate with AI" button uses free OpenRouter
models. Get a free key at <https://openrouter.ai/keys> and set it as
a Supabase secret so it stays server-side:

```bash
supabase secrets set OPENROUTER_API_KEY=sk-or-...
```

Without a key, the rest of the app works fine — AI mission generation just
shows a friendly "not configured" message. See `SUPABASE_MIGRATION.md`
Step 3c for details on the free-model fallback chain.

## 6. Run the app

```bash
npm run dev
```

Open the local URL printed by Vite.

## Production hardening

After the base schema and `20260802_rls_tighten.sql` are installed, run
`supabase/migrations/20260913_hardening.sql`. This migration moves class
joining, QR scans, mission submissions, XP redemption, and reward redemption
into transactional database functions. Do not deploy the earlier permissive
RLS block by itself in a production project.

Set `APP_ORIGIN` as a Supabase secret to the exact deployed app origin before
deploying the AI edge functions. The functions reject oversized prompts and
should be protected with a per-user rate limit at the edge or gateway.

## Build for production

```bash
npm run build
npm run preview
```

## Deploy to Vercel

1. Push your repository to GitHub/GitLab/Bitbucket.
2. Import the project at [vercel.com](https://vercel.com/new).
3. Set the following environment variables in the Vercel dashboard:
   - `VITE_SUPABASE_URL` — your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` — your Supabase anon key
4. Deploy. Vercel automatically detects the Vite framework and runs `npm run build`.

## Project structure

```
src/
├── api/
│   └── supabaseClient.js   # Supabase client + entity/auth wrapper (db)
├── components/              # Shared UI (Clay design system) + feature components
├── hooks/
├── lib/                     # AuthContext, business logic, services
├── pages/
│   ├── student/               # Student-facing screens
│   └── teacher/                # Teacher-facing screens
├── App.jsx
└── main.jsx
```

All data access goes through the `db` object exported from
`src/api/supabaseClient.js` (also attached to `globalThis.__B44_DB__` for
backward compatibility with existing page code):

```js
const db = globalThis.__B44_DB__;
const classrooms = await db.entities.Classroom.filter({ teacher_id: user.id });
```

See [`SUPABASE_MIGRATION.md`](./SUPABASE_MIGRATION.md) for the full schema,
the entity → table map, and guidance on tightening Row-Level Security
policies once you're ready to enforce per-user ownership.
