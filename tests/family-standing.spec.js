// End-to-end protection for the standing family link (audit #2, 20261232):
//   * ensure_family_member_link is idempotent — the teacher gets ONE durable
//     token per learner, reused across every later call.
//   * Guardians open /family/<token> with no account, see only the minimal
//     card (display name + class), and reply; the reply lands on the current
//     week's invite and shows in the teacher's existing inbox.
//   * Transferred-out learners can never be reached through the link.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const teacherEmail = process.env.TEST_TEACHER_EMAIL;
const teacherPassword = process.env.TEST_TEACHER_PASSWORD;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
const strict = process.env.TEST_E2E_STRICT === '1';

let admin = null;
let teacherId = null;
let classroomId = null;
let memberId = null;

test.beforeAll(async () => {
  if (!serviceKey || !supabaseUrl || !anonKey || !teacherEmail) {
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
    .eq('section', 'E2E-1')
    .order('created_date', { ascending: false })
    .limit(1)
    .single();
  if (classError) throw classError;
  classroomId = classroom.id;

  const { data: member, error: memberError } = await admin.from('group_members')
    .select('id')
    .eq('classroom_id', classroomId)
    .eq('last_name', 'LEGACY')
    .eq('first_name', 'ACCOUNT')
    .single();
  if (memberError) throw new Error('The E2E learner (LEGACY, ACCOUNT) was not seeded.');
  memberId = member.id;
});

async function teacherClient() {
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: teacherEmail, password: teacherPassword });
  if (error) throw new Error(`Teacher E2E login failed: ${error.message}`);
  return client;
}

test.describe('standing family link', () => {
  test('the durable link is created once, reused, and replies reach the teacher inbox', async ({ page }, testInfo) => {
    if (!serviceKey || !teacherPassword) {
      if (strict) throw new Error('Teacher credentials + service key required for strict E2E.');
      test.skip(true, 'Teacher credentials + service key required.');
      return;
    }
    testInfo.annotations.push({ type: 'viewport', description: '390x844 iPhone 13 emulation' });
    const authedTeacher = await teacherClient();

    // Teacher creates (or reuses) the standing link for the learner.
    const { data: link, error: linkError } = await authedTeacher.rpc('ensure_family_member_link', {
      p_member_id: memberId,
    });
    if (linkError) throw new Error(`ensure_family_member_link failed: ${linkError.message}`);
    expect(link.shareToken).toBeTruthy();

    // Idempotency: calling again returns the SAME durable token.
    const { data: linkAgain, error: againError } = await authedTeacher.rpc('ensure_family_member_link', {
      p_member_id: memberId,
    });
    if (againError) throw againError;
    expect(linkAgain.shareToken).toBe(link.shareToken);

    // A guardian without any account opens the standing page.
    await page.goto(`${baseUrl}/family/${link.shareToken}`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/family page/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/works all term/i)).toBeVisible();

    // Invalid tokens never leak anything.
    await page.goto(`${baseUrl}/family/00000000-0000-0000-0000-000000000000`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/not valid/i)).toBeVisible();

    // Back to the real link: mark it needs help with a note.
    await page.goto(`${baseUrl}/family/${link.shareToken}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /My child needs help/i }).click();
    await page.getByPlaceholder(/short message/i).fill('E2E standing: please call us about homework.');
    await page.getByRole('button', { name: /Send reply/i }).click();
    await expect(page.getByText(/Thank you!/i)).toBeVisible({ timeout: 15_000 });

    // The reply must appear in the teacher's regular inbox on this week's invite.
    const { data: inbox, error: inboxError } = await authedTeacher.rpc('list_family_summary_replies');
    if (inboxError) throw inboxError;
    const reply = (inbox || []).find((row) => row.note?.includes('E2E standing'));
    expect(reply, 'the standing reply must appear in the teacher inbox').toBeTruthy();
    expect(reply.reaction).toBe('needs_help');
    expect(reply.member_id).toBe(memberId);
  });

  test('a transferred-out learner is unreachable through the standing link', async () => {
    if (!serviceKey || !teacherPassword) {
      if (strict) throw new Error('Teacher credentials + service key required for strict E2E.');
      test.skip(true, 'Teacher credentials + service key required.');
      return;
    }
    const authedTeacher = await teacherClient();
    const { data: link, error: linkError } = await authedTeacher.rpc('ensure_family_member_link', {
      p_member_id: memberId,
    });
    if (linkError) throw linkError;

    // Use a dedicated throwaway learner so we never flip the shared fixture.
    const { data: scratch, error: scratchError } = await admin.from('group_members')
      .select('id')
      .eq('classroom_id', classroomId)
      .eq('last_name', 'TEST')
      .eq('first_name', 'STUDENT')
      .limit(1)
      .single();
    if (scratchError || !scratch) throw new Error('Seed learner (TEST STUDENT) not found for transfer test.');
    const scratchMemberId = scratch.id;
    const { data: scratchLink } = await authedTeacher.rpc('ensure_family_member_link', { p_member_id: scratchMemberId });
    expect(scratchLink.shareToken).toBeTruthy();

    try {
      await admin.from('group_members').update({ is_transferred: true }).eq('id', scratchMemberId);
      const guardian = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
      const read = await guardian.rpc('read_family_member_link', { p_share_token: scratchLink.shareToken });
      expect(read.error).toBeTruthy();
      const reply = await guardian.rpc('submit_family_standing_reply', {
        p_share_token: scratchLink.shareToken,
        p_guardian_name: null,
        p_reaction: 'acknowledged',
        p_note: null,
      });
      expect(reply.error).toBeTruthy();
    } finally {
      await admin.from('group_members').update({ is_transferred: false }).eq('id', scratchMemberId);
    }
  });
});
