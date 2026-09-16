# Contributing to UniClass

## Setup

1. Clone the repository and navigate to the `project/` directory.
2. Copy `.env.example` to `.env.local` and fill in your values.
3. Install dependencies:

```bash
npm install
```

4. Set up the Supabase database by running the schema in `SUPABASE_MIGRATION.md`.
5. Configure AI API keys as Supabase secrets (not `VITE_` env vars):

```bash
supabase secrets set OPENROUTER_API_KEY=sk-or-...
supabase secrets set GEMINI_API_KEY=your-gemini-api-key
```

## Coding Conventions

- Use `@/` path alias for imports (maps to `./src`). Do not use relative imports for cross-module paths.
- All route paths are centralized in `src/lib/routes.js`. Do not hardcode paths in pages or components.
- Teacher pages must import `getTeacherClassroom` and `getClassroomDataset` from `@/lib/teacherClassroom`. Call `invalidateClassroomDataset()` after any teacher mutation.
- Use `globalThis.__B44_DB__` for data access in existing pages; new code should use the `db` wrapper from `src/api/supabaseClient.js`.
- All lazy-loaded pages are imported in `src/App.jsx` and registered in `src/lib/routes.js`.
- Error handling should follow the try/catch → toast → logger → fallback pattern. Use the shared `handleError` utility where available.
- Component files use `.jsx` extension. Hooks use `.js` extension.
- The Clay design system provides consistent styling. Use `clay-btn`, `clay-card`, etc. for UI elements.

## Deployment

### Edge Functions

```bash
# Link to your Supabase project (run once)
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Set secrets
supabase secrets set OPENROUTER_API_KEY=sk-or-...
supabase secrets set GEMINI_API_KEY=your-gemini-api-key

# Deploy
supabase functions deploy openrouter-proxy
supabase functions deploy gemini-proxy
```

### Frontend Build

```bash
npm run build
npm run preview
```

### Vercel

1. Push your repository to GitHub/GitLab/Bitbucket.
2. Import the project at [vercel.com/new](https://vercel.com/new).
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Vercel dashboard under Settings → Environment Variables.
4. Deploy. Vercel auto-detects the Vite framework.

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/routes.js` | Single source of truth for all route paths |
| `src/api/supabaseClient.js` | Supabase client + `db` wrapper + entity helpers |
| `src/App.jsx` | Lazy-loaded page imports, `ProtectedRoute` wrapper |
| `src/lib/AuthContext.jsx` | Auth state machine with role-based routing |
| `src/lib/teacherClassroom.js` | 30s TTL caches for classroom dataset |
| `src/lib/aiService.js` | Single entry point for AI calls via Edge Functions |
| `src/lib/scanService.js` | Authoritative QR resolution logic |
| `supabase/functions/openrouter-proxy/index.ts` | OpenRouter AI proxy (Edge Function) |
| `supabase/functions/gemini-proxy/index.ts` | Gemini AI fallback (Edge Function) |