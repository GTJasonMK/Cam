import { expect, type Page } from '@playwright/test';

export async function loginAsDefault(page: Page): Promise<void> {
  const token = process.env.CAM_AUTH_TOKEN || 'playwright-token';
  await page.goto('/');

  if (/\/login(\?|$)/.test(page.url())) {
    await page.getByPlaceholder('CAM_AUTH_TOKEN').fill(token);
    await page.getByRole('button', { name: '登录' }).click();
  }

  await expect(page).toHaveURL('/');
}
