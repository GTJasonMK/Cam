import { expect, test } from '@playwright/test';

test('健康检查接口返回可用状态', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body?.success).toBe(true);
  expect(body?.data?.status).toBe('ok');
  expect(body?.data?.database?.ok).toBe(true);
  expect(typeof body?.data?.scheduler?.started).toBe('boolean');
});
