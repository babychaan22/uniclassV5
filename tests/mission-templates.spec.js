// Mission templates (audit item #4): a teacher bookmarks a mission as a
// reusable template, loads it back into the creation form, and deletes it.
// Protects: template save/load/delete wiring over mission_templates RLS.
import { test, expect } from '@playwright/test';

const teacherEmail = process.env.TEST_TEACHER_EMAIL;
const teacherPassword = process.env.TEST_E2E_PASSWORD;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';

test.beforeEach(async () => {
  // Idempotency: an earlier run may have left the template behind.
  if (!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY) return;
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.from('mission_templates').delete().like('title', 'E2E%');
  if (error) throw error;
});

async function login(page, email, password, path) {
  await page.goto(`${baseUrl}/login?returnUrl=${encodeURIComponent(path)}`);
  await expect(async () => {
    await page.goto(`${baseUrl}/login?returnUrl=${encodeURIComponent(path)}`);
    await page.getByLabel('Email').fill(email);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 });
  }).toPass({ timeout: 50_000, intervals: [1_000, 4_000, 10_000] });
}

test('teacher saves a mission as a template, reuses it, and deletes it', async ({ page }) => {
  const missionTitle = 'E2E Mission';
  await login(page, teacherEmail, teacherPassword, '/teacher/missions');

  const bookmark = page.getByRole('button', { name: `Save ${missionTitle} as a reusable template` }).first();
  await expect(bookmark).toBeVisible({ timeout: 20_000 });
  await bookmark.click();

  // The template chip appears on the shelf with its format label.
  const chip = page.getByRole('button', { name: new RegExp(`^${missionTitle}\\b`) }).filter({ hasText: /true_false|multiple choice|true false|manual/ });
  await expect(chip).toBeVisible({ timeout: 15_000 });

  // Loading it prefills the title field of the creation form.
  await chip.click();
  const titleInput = page.locator('input[placeholder="e.g. Quick Check: Verb Tenses"]');
  await expect(titleInput).toHaveValue(missionTitle, { timeout: 15_000 });
  await expect(page.getByText(new RegExp(`Template loaded: ${missionTitle}`)).first()).toBeVisible();

  // Deleting removes the chip again.
  const deleteButton = page.getByRole('button', { name: `Delete template ${missionTitle}` });
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();
  await expect(page.getByRole('button', { name: `Delete template ${missionTitle}` })).toHaveCount(0, { timeout: 15_000 });
});
