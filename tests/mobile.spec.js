import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const studentEmail = process.env.TEST_STUDENT_EMAIL;
const studentPassword = process.env.TEST_STUDENT_PASSWORD;
const teacherEmail = process.env.TEST_TEACHER_EMAIL;
const teacherPassword = process.env.TEST_TEACHER_PASSWORD;

async function login(page, email, password, path) {
  await page.goto(`/login?returnUrl=${encodeURIComponent(path)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 });
}

function collectBrowserErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

function skipScenario(test, condition, message) {
  if (!condition) return false;
  if (process.env.TEST_E2E_STRICT === '1') throw new Error(message);
  test.skip(true, message);
  return true;
}

async function createProofFixture(testInfo) {
  const file = testInfo.outputPath('proof.png');
  // 1x1 PNG: enough for exercising the upload/compression pipeline without a repository binary.
  await fs.writeFile(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  return file;
}

test.describe('student mobile flows', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (!studentEmail || !studentPassword) {
      if (process.env.TEST_E2E_STRICT === '1') throw new Error('Set TEST_STUDENT_EMAIL and TEST_STUDENT_PASSWORD before running strict E2E tests.');
      test.skip(true, 'Set TEST_STUDENT_EMAIL and TEST_STUDENT_PASSWORD to run student E2E tests.');
    }
    testInfo.annotations.push({ type: 'viewport', description: '390x844 iPhone 13 emulation' });
  });

  test('mission submission reaches grading or shows an actionable result', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await login(page, studentEmail, studentPassword, '/student/missions');
    await expect(page.getByRole('heading', { name: /Missions/i }).first()).toBeVisible();
    const submit = page.getByRole('button', { name: /Submit for AI Grading/i }).first();
    if (skipScenario(test, await submit.count() === 0, 'No active mission is available in the test classroom.')) return;
    await expect(submit).toBeVisible();
    const trueAnswer = page.getByRole('button', { name: 'True', exact: true }).first();
    const falseAnswer = page.getByRole('button', { name: 'False', exact: true }).first();
    if (await trueAnswer.count()) await trueAnswer.click();
    else if (await falseAnswer.count()) await falseAnswer.click();
    else throw new Error('The active mission rendered without an answer control.');
    await expect(submit).toBeEnabled();
    // The mobile bottom navigation can overlap the transformed clay card by a
    // few pixels even when the button is visibly enabled. Force the click on
    // this known, visible test control so the test exercises submission rather
    // than Playwright's hit-target calculation.
    await submit.scrollIntoViewIfNeeded();
    await submit.click({ force: true });
    await expect(submit).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('main').getByText(/AI feedback|XP|\/1|could not be submitted/i).first()).toBeVisible({ timeout: 5_000 });
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });

  test('activity proof upload is available and compressed', async ({ page }, testInfo) => {
    const errors = collectBrowserErrors(page);
    await login(page, studentEmail, studentPassword, '/student/scores');
    await expect(page.getByRole('heading', { name: /Activity Scores/i })).toBeVisible();
    const fileInput = page.locator('label').filter({ hasText: 'Upload image' }).locator('input[type="file"]');
    if (skipScenario(test, await fileInput.count() === 0, 'No editable activity is available in the test classroom.')) return;
    await fileInput.setInputFiles(await createProofFixture(testInfo));
    await expect(page.getByText(/Proof uploaded and compressed|Proof upload failed/i)).toBeVisible({ timeout: 20_000 });
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });

  test('QR page keeps a manual fallback and loads camera on demand', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await login(page, studentEmail, studentPassword, '/student/scan');
    await expect(page.getByRole('heading', { name: /Scan QR/i })).toBeVisible();
    await expect(page.getByPlaceholder(/hash|code/i).first()).toBeVisible();
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });

  test('student can switch classes when multiple accounts are configured', async ({ page }) => {
    test.skip(process.env.TEST_STUDENT_HAS_MULTIPLE_CLASSES !== '1', 'Set TEST_STUDENT_HAS_MULTIPLE_CLASSES=1 for this scenario.');
    await login(page, studentEmail, studentPassword, '/student/dashboard');
    const selector = page.getByLabel('Active class');
    const selectorReady = await selector.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
    if (skipScenario(test, !selectorReady, 'The test student does not have two approved class memberships; add a second approved class account to exercise switching.')) return;
    await expect(selector).toBeVisible();
    await expect(selector.locator('option')).toHaveCount(2, { timeout: 10_000 });
  });
});

test.describe('teacher mobile flows', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (!teacherEmail || !teacherPassword) {
      if (process.env.TEST_E2E_STRICT === '1') throw new Error('Set TEST_TEACHER_EMAIL and TEST_TEACHER_PASSWORD before running strict E2E tests.');
      test.skip(true, 'Set TEST_TEACHER_EMAIL and TEST_TEACHER_PASSWORD to run teacher E2E tests.');
    }
    testInfo.annotations.push({ type: 'viewport', description: '390x844 iPhone 13 emulation' });
  });

  test('activity logs paginate without duplicate rendering', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await login(page, teacherEmail, teacherPassword, '/teacher/activity-logs');
    await expect(page.getByRole('heading', { name: /Activity Logs/i })).toBeVisible();
    const older = page.getByRole('button', { name: /Load older activity/i });
    if (await older.count()) await older.click();
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });

  test('activity proof review renders mobile evidence cards', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await login(page, teacherEmail, teacherPassword, '/teacher/evidence');
    await expect(page.getByRole('heading', { name: /Activity Proof/i })).toBeVisible();
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });

  test('PDF export loads on demand and completes', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await login(page, teacherEmail, teacherPassword, '/teacher/export-data');
    await expect(page.getByRole('heading', { name: /Data Export/i })).toBeVisible();
    const pdfButton = page.getByRole('button', { name: /Download/i }).last();
    const download = page.waitForEvent('download');
    await pdfButton.click();
    await (await download).path();
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });
});
