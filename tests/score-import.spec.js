// End-to-end protection for score import (audit A3, overwrite preview):
// Re-uploading a CSV never duplicates grades — existing rows for the same
// member + category + item appear as updates in a confirmation preview,
// and confirming them rewrites the stored score in the database.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const teacherEmail = process.env.TEST_TEACHER_EMAIL;
const teacherPassword = process.env.TEST_TEACHER_PASSWORD;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';

const ITEM_LABEL = 'AV';

let admin = null;
let classroomId = null;
let memberId = null;

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

  const { data: classroom, error: classError } = await admin.from('classrooms')
    .select('id')
    .eq('teacher_id', teacher.id)
    .eq('section', 'E2E-2')
    .order('created_date', { ascending: false })
    .limit(1)
    .single();
  if (classError) throw classError;
  classroomId = classroom.id;

  const { data: member, error: memberError } = await admin.from('group_members')
    .select('id')
    .eq('classroom_id', classroomId)
    .eq('last_name', 'ABSENT')
    .eq('first_name', 'MEMBER')
    .single();
  if (memberError) throw new Error('The E2E learner (ABSENT, MEMBER) was not seeded.');
  memberId = member.id;

  await admin.from('teacher_assessments').delete()
    .eq('group_member_id', memberId)
    .eq('category', 'quiz')
    .eq('item_label', ITEM_LABEL);
});

test.afterAll(async () => {
  if (!admin || !memberId) return;
  await admin.from('teacher_assessments').delete()
    .eq('group_member_id', memberId)
    .eq('category', 'quiz')
    .eq('item_label', ITEM_LABEL);
});

async function loginViaUi(page) {
  await page.goto(`${baseUrl}/login?returnUrl=${encodeURIComponent('/teacher/score-import')}`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill(teacherEmail);
  await page.getByRole('textbox', { name: 'Password' }).fill(teacherPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((url) => url.pathname.endsWith('/teacher/score-import'), { timeout: 30_000 });
}

async function uploadCsv(page, rows) {
  const csv = [
    'group_number,last_name,first_name,category,item_label,score,max_score',
    ...rows,
  ].join('\n');
  await page.setInputFiles('input[type="file"]', {
    name: 'scores.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
}

test('re-uploading a score updates it through the preview instead of duplicating', async ({ page }) => {
  test.setTimeout(180_000);
  if (!teacherPassword) {
    test.skip(true, 'Teacher credentials required.');
    return;
  }

  await loginViaUi(page);
  await page.getByLabel('Class').selectOption({ label: 'Grade 8 · E2E-2 · Test Mathematics' });
  // Wait for the roster to finish loading before uploading anything.
  await expect(page.getByText('5 students')).toBeVisible({ timeout: 30_000 });

  // First upload: a brand-new quiz for ABSENT, MEMBER.
  await uploadCsv(page, ['1,ABSENT,MEMBER,quiz,AV,7,10']);
  const preview = page.getByTestId('score-import-preview');
  await expect(preview).toBeVisible({ timeout: 20_000 });
  await expect(preview.getByText('1 new', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: /Import 1 new/ }).click();
  await expect(page.getByText('1 imported', { exact: false })).toBeVisible({ timeout: 20_000 });

  const { data: created } = await admin.from('teacher_assessments')
    .select('id, score').eq('group_member_id', memberId)
    .eq('category', 'quiz').eq('item_label', ITEM_LABEL);
  expect(created, 'the new score must be stored').toHaveLength(1);
  expect(created[0].score).toBe(7);

  // Second upload: same member + category + item with a corrected score.
  await uploadCsv(page, ['1,ABSENT,MEMBER,quiz,AV,9,10']);
  await expect(preview).toBeVisible({ timeout: 20_000 });
  await expect(preview.getByText('1 to update', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: /Import 0 new · update 1/ }).click();
  await expect(page.getByText('0 imported', { exact: false })).toBeVisible({ timeout: 20_000 });

  const { data: updated } = await admin.from('teacher_assessments')
    .select('score').eq('group_member_id', memberId)
    .eq('category', 'quiz').eq('item_label', ITEM_LABEL);
  expect(updated, 're-upload must rewrite the row, never add one').toHaveLength(1);
  expect(updated[0].score).toBe(9);

  // The result banner reports the update, not a second import.
  await expect(page.getByText('1 updated', { exact: false })).toBeVisible();
});
