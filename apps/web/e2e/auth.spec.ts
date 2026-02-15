import { expect, test } from '@playwright/test';

test('未登录访问首页会跳转登录，登录后可进入仪表盘', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible();

  await page.getByPlaceholder('CAM_AUTH_TOKEN').fill('playwright-token');
  await page.getByRole('button', { name: '登录' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();
});
