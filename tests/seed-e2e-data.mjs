import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const teacherEmail = process.env.TEST_TEACHER_EMAIL;
const studentEmail = process.env.TEST_STUDENT_EMAIL;
const password = process.env.TEST_E2E_PASSWORD;

if (!url || !serviceKey || !teacherEmail || !studentEmail || !password) {
  throw new Error('Set VITE_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY, TEST_TEACHER_EMAIL, TEST_STUDENT_EMAIL, and TEST_E2E_PASSWORD.');
}
if (process.env.TEST_E2E_SEED !== '1') {
  throw new Error('Refusing to seed until TEST_E2E_SEED=1 is set.');
}
if (process.env.ALLOW_REAL_TEST_ACCOUNTS !== '1' && (!teacherEmail.endsWith('@example.test') || !studentEmail.endsWith('@example.test'))) {
  throw new Error('Use @example.test accounts for seeding, or explicitly set ALLOW_REAL_TEST_ACCOUNTS=1.');
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function ensureUser(email, role) {
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const existing = listed.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      user_metadata: { ...existing.user_metadata, role },
    });
    if (error) throw error;
    return data.user;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role } });
  if (error) throw error;
  return data.user;
}

async function insert(table, row) {
  const { data, error } = await admin.from(table).insert(row).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

const teacher = await ensureUser(teacherEmail, 'teacher');
const student = await ensureUser(studentEmail, 'student');

const old = await admin.from('classrooms').select('id').eq('teacher_id', teacher.id).like('section', 'E2E-%');
if (old.error) throw old.error;
if (old.data.length) {
  const { error } = await admin.from('classrooms').delete().in('id', old.data.map((row) => row.id));
  if (error) throw error;
}

for (const [index, code] of ['E2E01A', 'E2E02B'].entries()) {
  const classroom = await insert('classrooms', {
    teacher_id: teacher.id,
    grade_level: 'Grade 8',
    section: `E2E-${index + 1}`,
    subject: 'Test Mathematics',
    school_year: '2026-2027',
    num_groups: 1,
    uses_groups: true,
    join_code: code,
  });
  const group = await insert('groups', { classroom_id: classroom.id, group_number: 1, group_name: 'E2E Group 1' });
  const member = await insert('group_members', {
    classroom_id: classroom.id,
    group_id: group.id,
    last_name: 'TEST',
    first_name: 'STUDENT',
    is_account_holder: true,
  });
  await insert('group_accounts', {
    user_id: student.id,
    classroom_id: classroom.id,
    group_id: group.id,
    group_member_id: member.id,
    last_name: 'TEST',
    first_name: 'STUDENT',
    email: studentEmail,
    is_approved: true,
    is_representative: true,
  });
  await insert('class_settings', { classroom_id: classroom.id });

  if (index === 0) {
    await insert('activities', { classroom_id: classroom.id, activity_number: 1, title: 'E2E Activity', max_score: 10 });
    await insert('missions', {
      classroom_id: classroom.id,
      title: 'E2E Mission',
      description: 'Answer this test mission.',
      xp_reward: 100,
      max_score: 1,
      is_active: true,
      created_by: teacher.id,
      formative_type: 'true_false',
      ai_content: JSON.stringify({ questions: [{ prompt: 'The sky is blue.' }] }),
      answer_key: JSON.stringify([true]),
    });
  }
}

console.log(`Seeded two approved classes for ${studentEmail} and teacher ${teacherEmail}.`);
