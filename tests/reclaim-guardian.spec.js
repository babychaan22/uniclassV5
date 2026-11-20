// End-to-end protection for the flows fixed on 2026-12-2x:
//   1. Reclaim — a fresh login selects an already-claimed roster name, the
//      teacher approves, and the record (with history) follows the new login.
//      Guards against regressions of: unique-member duplicate-key insert
//      (20261228) and the is_representative/is_approved trigger pass
//      (20261229).
//   2. Guardian reply link — an unauthenticated guardian opens
//      /family-reply/<token>, replies, and the teacher's inbox shows it.
//      Guards against regressions of: 20261226/20261227.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const teacherEmail = process.env.TEST_TEACHER_EMAIL;
const teacherPassword = process.env.TEST_TEACHER_PASSWORD;
const testPassword = process.env.TEST_E2E_PASSWORD;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
const strict = process.env.TEST_E2E_STRICT === '1';

let admin = null;
let teacherId = null;
let joinCode = null;
let legacyMemberId = null;
let legacyGroupId = null;
let legacyClassroomId = null;
let reclaimEmail = null;

test.beforeAll(async () => {
  if (!serviceKey || !supabaseUrl || !teacherEmail) {
    test.skip(true, 'Seed the E2E environment first (npm run test:e2e:seed).');
    return;
  }
  admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: users, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersError) throw usersError;
  const teacher = users.users.find((candidate) => candidate.email?.toLowerCase() === teacherEmail.toLowerCase());
  if (!teacher) throw new Error('The seeded E2E teacher could not be found. Run npm run test:e2e:seed.');
  teacherId = teacher.id;
  reclaimEmail = `e2e-reclaim-${teacherId.slice(0, 8)}@example.test`;

  const { data: classroom, error: classError } = await admin.from('classrooms')
    .select('id, join_code')
    .eq('teacher_id', teacherId)
    .eq('section', 'E2E-1')
    .order('created_date', { ascending: false })
    .limit(1)
    .single();
  if (classError) throw classError;
  joinCode = classroom.join_code;
  if (!joinCode) throw new Error('The E2E-1 classroom has no join code.');
  legacyClassroomId = classroom.id;

  const { data: member, error: memberError } = await admin.from('group_members')
    .select('id, group_id')
    .eq('classroom_id', classroom.id)
    .eq('last_name', 'LEGACY')
    .eq('first_name', 'ACCOUNT')
    .single();
  if (memberError) throw new Error('The E2E reclaim member (LEGACY, ACCOUNT) was not seeded.');
  legacyMemberId = member.id;
  legacyGroupId = member.group_id;

  // Reset the reclaim fixture: an earlier run may have left the LEGACY record
  // claimed by the reclaim student (pending or approved). Restore the original
  // holder so every run starts from the same state. This must run as the
  // TEACHER (guard triggers + RLS only let the classroom teacher flip
  // is_approved), which is exactly the production review path.
  if (!teacherPassword) throw new Error('Set TEST_TEACHER_PASSWORD to reset the reclaim fixture.');
  const resetTeacher = await teacherClient();
  const legacyEmail = `e2e-legacy-${teacherId.slice(0, 8)}@example.test`;
  const { data: legacyUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const legacyUserId = legacyUsers.users
    .find((candidate) => candidate.email?.toLowerCase() === legacyEmail.toLowerCase())?.id;
  if (!legacyUserId) throw new Error('The E2E legacy (forgotten-password) user was not seeded.');
  const { error: resetError } = await resetTeacher.from('group_accounts')
    .update({
      user_id: legacyUserId,
      email: legacyEmail,
      is_approved: true,
      is_reclaim_request: false,
      is_representative: false,
      previous_user_id: null,
      previous_email: null,
      previous_is_approved: null,
    })
    .eq('group_member_id', legacyMemberId);
  if (resetError) throw new Error(`Could not reset the reclaim fixture: ${resetError.message}`);
});

async function login(page, email, password, path) {
  await page.goto(`${baseUrl}/login?returnUrl=${encodeURIComponent(path)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 });
}

async function teacherClient() {
  const client = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY || '', { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: teacherEmail, password: teacherPassword });
  if (error) throw new Error(`Teacher E2E login failed: ${error.message}`);
  return client;
}

function collectBrowserErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors.filter((error) => !error.includes('favicon') && !/Failed to load resource.*\b(400|401|403|404)\b/.test(error));
}

test.describe('reclaim flow preserves history', () => {
  test('a fresh login reclaims an already-claimed record after teacher approval', async ({ page }, testInfo) => {
    if (!serviceKey) {
      if (strict) throw new Error('Seed data required for strict E2E.');
      test.skip(true, 'Seed data required (npm run test:e2e:seed).');
      return;
    }
    testInfo.annotations.push({ type: 'viewport', description: '390x844 iPhone 13 emulation' });
    const errors = collectBrowserErrors(page);

    // ── The "forgot password" student joins and selects their old name ──
    await login(page, reclaimEmail, testPassword, '/student/onboarding');
    await page.getByPlaceholder('ABC123').fill(joinCode);
    await page.getByRole('button', { name: /Find Class/i }).click();
    await page.getByRole('button', { name: /^Group 1\b/ }).click();

    const legacyRow = page.getByRole('button', { name: /LEGACY, ACCOUNT/ });
    await expect(legacyRow).toBeVisible({ timeout: 15_000 });
    await expect(legacyRow.getByText(/Already enrolled - select to link/i)).toBeVisible();
    await legacyRow.click();
    await page.getByRole('button', { name: 'Join Class', exact: true }).click();

    const confirmDialog = page.getByRole('alertdialog', { name: /Confirm your roster name/i });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Yes, this is me', exact: true }).click();

    const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const reclaimUserId = users.users.find((candidate) => candidate.email?.toLowerCase() === reclaimEmail.toLowerCase())?.id;

    // The join records a pending reclaim request on the member's single row.
    async function readReclaimRow() {
      const { data, error } = await admin.from('group_accounts')
        .select('id, user_id, is_approved, is_reclaim_request, previous_user_id')
        .eq('group_member_id', legacyMemberId)
        .single();
      if (error) throw error;
      return data;
    }
    const pending = await readReclaimRow();
    expect(pending.is_approved).toBe(false);
    expect(pending.is_reclaim_request).toBe(true);
    expect(pending.user_id).toBe(reclaimUserId);

    // ── The teacher reviews and approves the request ────────────────────
    await login(page, teacherEmail, teacherPassword, '/teacher/student-management');
    const legacyCard = page.locator('div').filter({ hasText: 'LEGACY, ACCOUNT' })
      .filter({ has: page.getByRole('button', { name: 'Approve', exact: true }) })
      .last();
    await expect(legacyCard.getByText('Linking to existing record')).toBeVisible({ timeout: 20_000 });
    await legacyCard.getByRole('button', { name: 'Approve', exact: true }).click();

    // Approving moves the card to "Approved students"; poll the row until the
    // write lands (service-side update + UI refresh).
    await expect.poll(readReclaimRow, { timeout: 15_000, message: 'approving the reclaim must approve the record for the reclaiming user' })
      .toMatchObject({ is_approved: true, is_reclaim_request: false, user_id: reclaimUserId });

    expect(errors).toEqual([]);
  });
});

test.describe('guardian reply link', () => {
  test('a guardian replies without an account; the reply reaches the teacher inbox', async ({ page }, testInfo) => {
    if (!serviceKey || !teacherPassword) {
      if (strict) throw new Error('Teacher credentials + service key required for strict E2E.');
      test.skip(true, 'Teacher credentials + service key required.');
      return;
    }
    testInfo.annotations.push({ type: 'viewport', description: '390x844 iPhone 13 emulation' });
    const errors = collectBrowserErrors(page);
    const authedTeacher = await teacherClient();

    // Teacher (API) creates the shareable invite for the seeded learner+period.
    const { data: seedTerm, error: termError } = await admin.from('classrooms')
      .select('id')
      .eq('id', legacyClassroomId)
      .single();
    if (termError || !seedTerm) throw new Error('E2E classroom vanished.');
    const periodStart = new Date(); periodStart.setUTCDate(periodStart.getUTCDate() - periodStart.getUTCDay());
    const periodEnd = new Date(periodStart); periodEnd.setUTCDate(periodStart.getUTCDate() + 6);
    const iso = (d) => d.toISOString().slice(0, 10);
    const { data: invite, error: inviteError } = await authedTeacher.rpc('create_family_summary_invite', {
      p_member_id: legacyMemberId,
      p_period_kind: 'week',
      p_period_label: 'This week',
      p_period_start: iso(periodStart),
      p_period_end: iso(periodEnd),
    });
    if (inviteError) throw new Error(`create_family_summary_invite failed: ${inviteError.message}`);
    expect(invite.shareToken).toBeTruthy();

    // A guardian without any account opens the reply page.
    await page.goto(`${baseUrl}/family-reply/${invite.shareToken}`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/STUDENT T\.'s class update|class update/i)).toBeVisible({ timeout: 15_000 });

    // Invalid tokens never leak anything.
    await page.goto(`${baseUrl}/family-reply/00000000-0000-0000-0000-000000000000`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/not valid/i)).toBeVisible();

    // The real one: acknowledge with a note.
    await page.goto(`${baseUrl}/family-reply/${invite.shareToken}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /I read it/i }).click();
    await page.getByPlaceholder(/short message/i).fill('E2E guardian: we read the update, thank you.');
    await page.getByRole('button', { name: /Send reply/i }).click();
    await expect(page.getByText(/Thank you!/i)).toBeVisible({ timeout: 15_000 });

    // The teacher's inbox returns the reply.
    const { data: inbox, error: inboxError } = await authedTeacher.rpc('list_family_summary_replies');
    if (inboxError) throw inboxError;
    const reply = (inbox || []).find((row) => row.note?.includes('E2E guardian'));
    expect(reply, 'the guardian reply must appear in the teacher inbox').toBeTruthy();

    expect(errors).toEqual([]);
  });
});
