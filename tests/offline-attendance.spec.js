// End-to-end protection for offline attendance (audit #3, offline queue):
// A teacher with dropped Wi-Fi can still mark attendance; the mark is kept
// in localStorage, announced as "waiting to sync", and replayed to Supabase
// the moment connectivity returns — verified in the database.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const teacherEmail = process.env.TEST_TEACHER_EMAIL;
const teacherPassword = process.env.TEST_TEACHER_PASSWORD;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';

let admin = null;
let teacherId = null;
let classroomId = null;
let memberId = null;
let memberLabel = 'ABSENT, MEMBER';

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

  const { data: classroom, error: classError } = await admin.from('classrooms')
    .select('id')
    .eq('teacher_id', teacherId)
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
    .eq('first_name', 'MEMBER')    .single();
  if (memberError) throw new Error('The E2E learner (ABSENT, MEMBER) was not seeded.');
  memberId = member.id;
});

test.afterAll(async () => {
  // Restore the fixture: delete the rows this spec created for today.
  // The app saves attendance with the LOCAL date, so clean both the local
  // and the UTC rendering of "today" (they differ around local midnight).
  if (!admin || !memberId) return;
  const localToday = new Date().toLocaleDateString('en-CA');
  const utcToday = new Date().toISOString().slice(0, 10);
  for (const date of new Set([localToday, utcToday])) {
    await admin.from('attendances')
      .delete()
      .eq('group_member_id', memberId)
      .eq('attendance_date', date);
  }
});

test('attendance marked offline is queued and syncs on reconnect', async ({ page }) => {
  if (!serviceKey || !teacherPassword) {
    test.skip(true, 'Teacher credentials + service key required.');
    return;
  }

  // Login as the teacher and open the attendance roster.
  await page.goto(`${baseUrl}/login?returnUrl=${encodeURIComponent('/teacher/attendance')}`);
  await page.getByLabel('Email').fill(teacherEmail);
  await page.getByRole('textbox', { name: 'Password' }).fill(teacherPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((url) => url.pathname.endsWith('/teacher/attendance'), { timeout: 20_000 });
  // The roster shows the teacher's ACTIVE classroom; switch it to E2E-2,
  // where the ABSENT, MEMBER fixture lives.
  await page.getByLabel('Active class').selectOption({ label: 'Grade 8 · E2E-2 · Test Mathematics' });
  const memberRow = page.locator('div', { has: page.getByRole('button', { name: `Mark ${memberLabel} present` }) });
  await expect(memberRow.first()).toBeVisible({ timeout: 20_000 });

  // Drop the network, then mark the learner present.
  await page.context().setOffline(true);
  await page.getByRole('button', { name: `Mark ${memberLabel} present`, exact: false }).first().click();
  await expect(page.getByText(/Saved on this device/i)).toBeVisible({ timeout: 15_000 });

  // The queue is durable in this browser, not just in React state.
  const queued = await page.evaluate(() => {
    const raw = window.localStorage.getItem('uniclass.offline.attendance.v1');
    return raw ? JSON.parse(raw).length : 0;
  });
  expect(queued, 'the offline mark must be queued in localStorage').toBeGreaterThanOrEqual(1);

  // Restore connectivity; the queue replays and the row lands in Supabase.
  await page.context().setOffline(false);
  // The app saves attendance with the LOCAL date (the roster's selectedDate),
  // which differs from the UTC date around local midnight.
  const today = new Date().toLocaleDateString('en-CA');
  await expect.poll(async () => {
    const { data } = await admin.from('attendances')
      .select('status')
      .eq('group_member_id', memberId)
      .eq('attendance_date', today)
      .limit(1);
    return data?.[0]?.status || null;
  }, { timeout: 20_000, message: 'the offline-queued mark must reach the database after reconnect' })
    .toBe('present');

  // The roster reflects the synced record after its refresh, not a queue hint.
  await expect(page.getByText('Waiting to sync')).toHaveCount(0, { timeout: 20_000 });
  await expect(memberRow.first().getByText('Saved record')).toBeVisible({ timeout: 20_000 });
});
