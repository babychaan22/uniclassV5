# Automated mobile E2E setup

Install the browser once:

```bash
npx playwright install chromium
```

Set credentials for a seeded Supabase test classroom. In PowerShell:

```powershell
$env:TEST_STUDENT_EMAIL = "student-test@example.com"
$env:TEST_STUDENT_PASSWORD = "your-password"
$env:TEST_TEACHER_EMAIL = "teacher-test@example.com"
$env:TEST_TEACHER_PASSWORD = "your-password"
$env:TEST_STUDENT_HAS_MULTIPLE_CLASSES = "1" # only when two approved memberships exist
npm run test:e2e
```

The suite uses an iPhone 13 profile (390×844), starts the local Vite server automatically, captures screenshots/traces on failure, and stores the HTML report in `playwright-report/`. Tests that require unavailable seeded data are skipped with an explicit reason rather than producing false failures.
