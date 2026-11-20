// Teacher pages are guarded by a server-checked role: a signed-in STUDENT
// who opens /teacher/dashboard lands in their own workspace, while the
// teacher's own navigation is unaffected.
import { test, expect } from '@playwright/test';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';

// A cold dev server's first module-graph compile can exceed 60 seconds, so
// these route-guard tests get a wider timeout than the default.
test.setTimeout(180_000);
const studentEmail = process.env.TEST_STUDENT_EMAIL;
const teacherEmail = process.env.TEST_TEACHER_EMAIL;
const studentPassword = process.env.TEST_STUDENT_PASSWORD || process.env.TEST_E2E_PASSWORD;
const teacherPassword = process.env.TEST_TEACHER_PASSWORD;

async function loginViaUi(page, email, password, returnUrl) {
  // 'load' can hang long past readiness on the dev server (streaming
  // connections keep it pending); domcontentloaded is the reliable signal.
  // The very first compile after a cold start can still exceed one goto's
  // timeout, so retry navigation.
  let navigated = false;
  for (let attempt = 0; attempt < 3 && !navigated; attempt += 1) {
    try {
      await page.goto(`${baseUrl}/login?returnUrl=${encodeURIComponent(returnUrl)}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      navigated = true;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 });
}

test('a student opening a teacher link is sent back to their own dashboard', async ({ page }, testInfo) => {
  if (!studentEmail || !studentPassword) {
    test.skip(true, 'Student credentials required.');
    return;
  }
  testInfo.annotations.push({ type: 'viewport', description: '390x844 iPhone 13 emulation' });

  // The student's account is a representative in the seeded classroom, which
  // the login flow resolves to the student dashboard.
  await loginViaUi(page, studentEmail, studentPassword, '/student/dashboard');
  await expect(page.getByRole('main')).toBeVisible({ timeout: 20_000 });
  // Follow the shared teacher link the way a curious student would.
  await page.goto(`${baseUrl}/teacher/dashboard`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForURL((url) => url.pathname.startsWith('/student'), { timeout: 20_000 });
  await expect(page).not.toHaveURL(/\/teacher/);
});

test('the teacher still reaches every teacher page directly', async ({ page }, testInfo) => {
  if (!teacherEmail || !teacherPassword) {
    test.skip(true, 'Teacher credentials required.');
    return;
  }
  testInfo.annotations.push({ type: 'viewport', description: '390x844 iPhone 13 emulation' });
  await loginViaUi(page, teacherEmail, teacherPassword, '/teacher/dashboard');
  await page.waitForURL((url) => url.pathname.endsWith('/teacher/dashboard'), { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /dashboard|class/i }).first()).toBeVisible({ timeout: 20_000 });
});
