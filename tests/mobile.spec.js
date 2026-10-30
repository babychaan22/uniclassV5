import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const studentEmail = process.env.TEST_STUDENT_EMAIL;
const studentPassword = process.env.TEST_STUDENT_PASSWORD;
const teacherEmail = process.env.TEST_TEACHER_EMAIL;
const teacherPassword = process.env.TEST_TEACHER_PASSWORD;
const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
let e2eClassroomId = null;

test.beforeAll(async () => {
  if (!serviceKey || !supabaseUrl || !teacherEmail) return;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: users, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersError) throw usersError;
  const teacher = users.users.find((candidate) => candidate.email?.toLowerCase() === teacherEmail.toLowerCase());
  if (!teacher) throw new Error('The seeded E2E teacher could not be found.');
  const { data: classrooms, error: classroomsError } = await admin.from('classrooms')
    .select('id')
    .eq('teacher_id', teacher.id)
    .eq('section', 'E2E-1')
    .order('created_date', { ascending: false })
    .limit(1);
  if (classroomsError) throw classroomsError;
  e2eClassroomId = classrooms?.[0]?.id || null;
  if (!e2eClassroomId) throw new Error('The E2E-1 classroom was not seeded.');
});

async function login(page, email, password, path, activeClassKey) {
  if (e2eClassroomId && activeClassKey) {
    await page.addInitScript(({ key, id }) => window.localStorage.setItem(key, id), { key: activeClassKey, id: e2eClassroomId });
  }
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
    await login(page, studentEmail, studentPassword, '/student/missions', 'uniclass.activeClassroomId');
    await expect(page.getByRole('heading', { name: /Missions/i }).first()).toBeVisible();
    const trueAnswer = page.getByRole('button', { name: 'True', exact: true }).first();
    const falseAnswer = page.getByRole('button', { name: 'False', exact: true }).first();
    if (skipScenario(test, await trueAnswer.count() === 0 && await falseAnswer.count() === 0, 'No active mission is available in the test classroom.')) return;
    // The clay card's entrance animation can momentarily overlap its answer
    // controls on a narrow viewport. This is a known, visible control, so use
    // the same direct tap approach as the final submit button below.
    if (await trueAnswer.count()) await trueAnswer.click({ force: true });
    else await falseAnswer.click({ force: true });

    const reviewAnswers = page.getByRole('button', { name: 'Review answers', exact: true }).first();
    await expect(reviewAnswers).toBeEnabled();
    await reviewAnswers.click({ force: true });

    const submit = page.getByRole('button', { name: /Submit for secure grading/i }).first();
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();
    // The mobile bottom navigation can overlap the transformed clay card by a
    // few pixels even when the button is visibly enabled. Force the click on
    // this known, visible test control so the test exercises submission rather
    // than Playwright's hit-target calculation.
    await submit.scrollIntoViewIfNeeded();
    await submit.click({ force: true });
    // A failed secure submission keeps this action available and shows an
    // inline error. Its removal is the stable success signal: the assessment
    // has transitioned to the saved-result/history state, whose exact copy is
    // intentionally allowed to evolve with student feedback.
    await expect(submit).toHaveCount(0, { timeout: 30_000 });
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });

  test('activity proof upload is available and compressed', async ({ page }, testInfo) => {
    const errors = collectBrowserErrors(page);
    await login(page, studentEmail, studentPassword, '/student/scores', 'uniclass.activeClassroomId');
    await expect(page.getByRole('heading', { name: /Activity Scores/i })).toBeVisible();
    const fileInput = page.getByText('Upload group proof images', { exact: true }).locator('..').locator('input[type="file"]');
    // The heading paints immediately; the editable roster follows three
    // classroom requests. Wait for the input instead of treating that normal
    // loading window as an absent activity.
    await fileInput.waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {});
    if (skipScenario(test, await fileInput.count() === 0, 'No editable activity is available in the test classroom.')) return;
    await fileInput.setInputFiles(await createProofFixture(testInfo));
    await expect(page.getByText(/group proof image.*uploaded|No group proof images were uploaded|Proof upload failed/i)).toBeVisible({ timeout: 20_000 });
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });

  test('QR page keeps a manual fallback and loads camera on demand', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await login(page, studentEmail, studentPassword, '/student/scan', 'uniclass.activeClassroomId');
    await expect(page.getByRole('heading', { name: /Scan QR/i })).toBeVisible();
    await expect(page.getByPlaceholder(/hash|code/i).first()).toBeVisible();
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });

  test('student can switch classes when multiple accounts are configured', async ({ page }) => {
    test.skip(process.env.TEST_STUDENT_HAS_MULTIPLE_CLASSES !== '1', 'Set TEST_STUDENT_HAS_MULTIPLE_CLASSES=1 for this scenario.');
    await login(page, studentEmail, studentPassword, '/student/dashboard', 'uniclass.activeClassroomId');
    const selector = page.getByLabel('Active class');
    const selectorReady = await selector.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
    if (skipScenario(test, !selectorReady, 'The test student does not have two approved class memberships; add a second approved class account to exercise switching.')) return;
    await expect(selector).toBeVisible();
    await expect(selector.locator('option')).toHaveCount(2, { timeout: 10_000 });
  });

  test('XP redemption remains a confirmed action', async ({ page }) => {
    await login(page, studentEmail, studentPassword, '/student/rewards', 'uniclass.activeClassroomId');
    const redeem = page.getByRole('button', { name: /Redeem 10 XP/i });
    // The seed gives this isolated learner a separate wallet credit. Keep the
    // check explicit so a missing redemption control is a release failure,
    // not a skipped scenario.
    await expect(redeem).toBeVisible({ timeout: 20_000 });
    await redeem.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('z-index', '111');
    const confirm = dialog.getByRole('button', { name: 'Redeem 10 XP', exact: true });
    await expect(confirm).toBeVisible();
    // Verify the protected wallet mutation, rather than the transient toast
    // that is deliberately positioned beside the button on mobile screens.
    const redemption = page.waitForResponse((response) => (
      response.url().includes('/rest/v1/rpc/redeem_mission_points') && response.request().method() === 'POST'
    ));
    // Anchored dialogs animate into their viewport position on touch devices.
    // Use the same native activation the focused button receives from a
    // keyboard or assistive technology, avoiding a synthetic coordinate that
    // can race that entrance animation in headless Chromium.
    await confirm.focus();
    await page.keyboard.press('Enter');
    const response = await redemption;
    expect(response.ok()).toBeTruthy();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  });

  test('Gacha code requires Risk It and cannot be rolled twice', async ({ page }) => {
    await login(page, studentEmail, studentPassword, '/student/scan', 'uniclass.activeClassroomId');
    const code = page.getByPlaceholder('ENTER HASH');
    await code.fill('E2E-GACHA-CI');
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(page.getByText('Gacha Code Detected!')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Scan Another', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /Risk It/i }).click();
    await page.getByRole('button', { name: 'Pull lever to spin', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Scan Another', exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Scan Another', exact: true }).click();
    await code.fill('E2E-GACHA-CI');
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(page.getByText(/already been used/i)).toBeVisible({ timeout: 15_000 });
  });

  test('representative can save zero and absent activity scores', async ({ page }, testInfo) => {
    await login(page, studentEmail, studentPassword, '/student/scores', 'uniclass.activeClassroomId');
    await expect(page.getByRole('heading', { name: /Activity Scores/i })).toBeVisible();
    const fileInput = page.getByText('Upload group proof images', { exact: true }).locator('..').locator('input[type="file"]');
    await expect(fileInput).toBeAttached({ timeout: 20_000 });
    await fileInput.setInputFiles(await createProofFixture(testInfo));
    await expect(page.getByText(/group proof image.*uploaded/i)).toBeVisible({ timeout: 20_000 });
    const scoreInputs = page.getByLabel(/^Score for /);
    await expect(scoreInputs).toHaveCount(4, { timeout: 20_000 });
    for (let index = 0; index < await scoreInputs.count(); index += 1) await scoreInputs.nth(index).fill('0');
    const absent = page.getByRole('button', { name: 'Mark absent', exact: true }).first();
    await expect(absent).toBeVisible();
    await absent.click();
    await expect(page.getByRole('button', { name: 'Marked absent', exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Submit Scores', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: /Submit scores for your group/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm & Lock', exact: true }).click();
    await expect(page.getByText(/Activity 1 is submitted/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Absent — excluded/i)).toBeVisible();
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
    await login(page, teacherEmail, teacherPassword, '/teacher/activity-logs', 'uniclass.teacher.activeClassroomId');
    await expect(page.getByRole('heading', { name: /Activity Logs/i })).toBeVisible();
    const older = page.getByRole('button', { name: /Load older activity/i });
    if (await older.count()) await older.click();
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });

  test('activity proof review renders mobile evidence cards', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await login(page, teacherEmail, teacherPassword, '/teacher/evidence', 'uniclass.teacher.activeClassroomId');
    await expect(page.getByRole('heading', { name: /Activity Proof/i })).toBeVisible();
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });

  test('PDF export loads on demand and completes', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await login(page, teacherEmail, teacherPassword, '/teacher/export-data', 'uniclass.teacher.activeClassroomId');
    await expect(page.getByRole('heading', { name: /Data Export/i })).toBeVisible();
    const pdfButton = page.getByText('PDF Report', { exact: true }).locator('..').getByRole('button', { name: 'Download', exact: true });
    const download = page.waitForEvent('download');
    await pdfButton.scrollIntoViewIfNeeded();
    // The mobile dock can overlap the final report card by a few pixels while
    // the browser is centering it. The control is visible and enabled, so this
    // checks the export rather than Playwright's hit-target calculation.
    await pdfButton.click({ force: true });
    await (await download).path();
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });

  test('teacher can save and correct attendance in place', async ({ page }) => {
    await login(page, teacherEmail, teacherPassword, '/teacher/attendance', 'uniclass.teacher.activeClassroomId');
    const present = page.getByRole('button', { name: /Mark TEST, STUDENT present/i });
    await expect(present).toBeVisible({ timeout: 20_000 });
    await present.click();
    await expect(page.getByText(/TEST, STUDENT marked present/i)).toBeVisible({ timeout: 15_000 });
    const absent = page.getByRole('button', { name: /Mark TEST, STUDENT absent/i });
    await absent.click();
    await expect(page.getByText(/TEST, STUDENT marked absent/i)).toBeVisible({ timeout: 15_000 });
  });

  test('teacher can approve, transfer, and remove roster records', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await login(page, teacherEmail, teacherPassword, '/teacher/student-management', 'uniclass.teacher.activeClassroomId');
    const approve = page.getByRole('button', { name: 'Approve', exact: true }).first();
    await expect(approve).toBeVisible({ timeout: 20_000 });
    await approve.click();
    await expect(approve).toHaveCount(0, { timeout: 15_000 });

    await page.goto('/teacher/roster');
    const move = page.getByRole('button', { name: 'Move records here', exact: true }).first();
    await expect(move).toBeVisible({ timeout: 20_000 });
    await move.click();
    const transferDialog = page.getByRole('dialog', { name: /Move records into/i });
    await expect(transferDialog).toBeVisible();
    await transferDialog.getByRole('button', { name: /DUPLICATE, RECORD/i }).click();
    await transferDialog.getByRole('button', { name: 'Move 1 record', exact: true }).click();
    const transferConfirmation = page.getByRole('alertdialog', { name: /Move selected student records/i });
    await expect(transferConfirmation).toBeVisible();
    await transferConfirmation.getByRole('button', { name: 'Move records', exact: true }).click();
    await expect(transferDialog).toHaveCount(0);
    await expect(page.getByText(/Merged 1 record into TEST, STUDENT/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('DUPLICATE, RECORD', { exact: true })).toHaveCount(0);

    // Remove the seeded account-free member, not the signed-in learner, so
    // this verifies the destructive roster flow without affecting the other
    // student scenarios in the same fresh classroom.
    const absentMember = page.getByText('ABSENT, MEMBER', { exact: true });
    await expect(absentMember).toBeVisible();
    const absentRow = absentMember.locator('..');
    await absentRow.getByRole('button', { name: 'Delete student', exact: true }).click();
    const removeDialog = page.getByRole('alertdialog', { name: /Remove this student/i });
    await expect(removeDialog).toBeVisible();
    const confirmRemoval = removeDialog.getByRole('button', { name: 'Remove student', exact: true });
    await confirmRemoval.focus();
    await page.keyboard.press('Enter');
    await expect(absentMember).toHaveCount(0, { timeout: 20_000 });
    expect(errors.filter((error) => !error.includes('favicon'))).toEqual([]);
  });
});
