# UniClass

Gamified classroom management app (QR gacha scans, XP/badges, group leaderboards)
built with **React + Vite + Supabase**.

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project

## 1. Install dependencies

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
models. Get a free key at <https://openrouter.ai/keys> and add it to
`.env.local`:

```bash
VITE_OPENROUTER_API_KEY=sk-or-...
```

Without a key, the rest of the app works fine — AI mission generation just
shows a friendly "not configured" message. See `SUPABASE_MIGRATION.md`
Step 3c for details on the free-model fallback chain.

## 6. Run the app

```bash
npm run dev
```

Open the local URL printed by Vite.

## Build for production

```bash
npm run build
npm run preview
```

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
