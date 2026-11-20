// Auth pages speak school language, not console language (audit follow-up):
//   * A wrong password answers with what to do next, never "check console".
//   * A login attempted offline explains the connection problem.
//   * Registration errors use the same friendly mapping.
import { test, expect } from '@playwright/test';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';

test('a wrong password explains what to do, not to check the console', async ({ page }) => {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Email').fill('nobody-e2echeck@example.test');
  await page.getByRole('textbox', { name: 'Password' }).fill('WrongPassword!1');
  await page.getByRole('button', { name: 'Log in' }).click();
  const errorBox = page.locator('div', { has: page.getByText(/incorrect|invalid/i) }).last();
  await expect(errorBox).toBeVisible({ timeout: 20_000 });
  await expect(errorBox).toContainText(/ask your teacher|Check the email/i);
  await expect(errorBox).not.toContainText(/console/i);
});

test('an offline login names the connection problem', async ({ page }) => {
  await page.goto(`${baseUrl}/login`);
  await page.context().setOffline(true);
  try {
    await page.getByLabel('Email').fill('nobody-e2echeck@example.test');
    await page.getByRole('textbox', { name: 'Password' }).fill('WrongPassword!1');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText(/No internet connection|Wi-Fi or data/i)).toBeVisible({ timeout: 20_000 });
  } finally {
    await page.context().setOffline(false);
  }
});
