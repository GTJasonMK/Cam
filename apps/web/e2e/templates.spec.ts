import { expect, test } from '@playwright/test';
import { loginAsDefault } from './helpers/auth';

const TOKEN = process.env.CAM_AUTH_TOKEN || 'playwright-token';

test('模板页面支持创建、编辑、删除', async ({ page }) => {
  await loginAsDefault(page);
  await page.goto('/templates');
  await expect(page.getByRole('heading', { name: '任务模板' })).toBeVisible();

  const suffix = Date.now();
  const templateName = `E2E模板-${suffix}`;
  const templateTitle = `E2E标题-${suffix}`;
  const templatePrompt = `请执行 E2E 模板创建校验，编号 ${suffix}`;
  const updatedTitle = `E2E标题-已更新-${suffix}`;

  await page.getByRole('button', { name: '+ 新建模板' }).click();
  await page.getByPlaceholder('例如：缺陷修复模板').fill(templateName);
  await page.getByPlaceholder('例如：修复线上登录异常').fill(templateTitle);
  await page.getByPlaceholder('描述这类任务的执行目标、约束和交付标准...').fill(templatePrompt);
  await page.getByRole('button', { name: '创建模板' }).click();

  await page.getByPlaceholder('按名称 / 标题模板 / 提示词搜索...').fill(templateName);
  await expect(page.getByText(templateName)).toBeVisible();

  await page.getByRole('button', { name: '编辑' }).first().click();
  await page.getByPlaceholder('例如：修复线上登录异常').fill(updatedTitle);
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText(updatedTitle)).toBeVisible();

  await page.getByRole('button', { name: '删除' }).first().click();
  const confirmModal = page.locator('div').filter({ hasText: '删除后任务创建页将无法继续选择该模板。' }).first();
  await confirmModal.getByRole('button', { name: '删除' }).click();

  await expect(page.getByText(templateName)).toHaveCount(0);
});

test('模板页面支持导入流水线模板', async ({ page, request }) => {
  await loginAsDefault(page);
  await page.goto('/templates');

  const suffix = Date.now();
  const templateName = `E2E导入模板-${suffix}`;
  const payload = {
    type: 'cam-pipeline',
    name: templateName,
    steps: [
      {
        title: '步骤一',
        description: '执行导入验证',
      },
    ],
    maxRetries: 2,
  };

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入模板' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'pipeline-import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload), 'utf8'),
  });

  await page.getByPlaceholder('按名称 / 标题模板 / 提示词搜索...').fill(templateName);
  await expect(page.getByText(templateName)).toBeVisible();

  const listRes = await request.get('/api/task-templates', {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  expect(listRes.ok()).toBeTruthy();
  const listBody = (await listRes.json()) as { success?: boolean; data?: Array<{ id: string; name: string }> };
  expect(listBody.success).toBe(true);
  const created = listBody.data?.find((item) => item.name === templateName);
  expect(created?.id).toBeTruthy();

  const deleteRes = await request.delete(`/api/task-templates/${created!.id}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'x-cam-actor': 'e2e-template-import-test',
    },
  });
  expect(deleteRes.ok()).toBeTruthy();
});

test('模板页面导入时会拦截不存在的智能体', async ({ page }) => {
  await loginAsDefault(page);
  await page.goto('/templates');

  const invalidAgentId = `missing-agent-${Date.now()}`;
  const payload = {
    type: 'cam-pipeline',
    name: `E2E非法智能体-${Date.now()}`,
    steps: [
      {
        title: '步骤一',
        description: '执行导入校验',
        agentDefinitionId: invalidAgentId,
      },
    ],
  };

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入模板' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'invalid-agent.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload), 'utf8'),
  });

  await expect(page.getByText(`智能体「${invalidAgentId}」不存在`)).toBeVisible();
});
