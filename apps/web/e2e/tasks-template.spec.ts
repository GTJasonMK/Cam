import { expect, test } from '@playwright/test';
import { loginAsDefault } from './helpers/auth';

const TOKEN = process.env.CAM_AUTH_TOKEN || 'playwright-token';

test('任务创建页可套用任务模板', async ({ page, request }) => {
  const suffix = Date.now();
  const templateName = `E2E-任务套用模板-${suffix}`;
  const templateTitle = `E2E-任务标题-${suffix}`;
  const templatePrompt = `请执行任务模板套用测试，编号 ${suffix}`;

  const createRes = await request.post('/api/task-templates', {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'x-cam-actor': 'e2e-task-template-test',
    },
    data: {
      name: templateName,
      titleTemplate: templateTitle,
      promptTemplate: templatePrompt,
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = (await createRes.json()) as { success?: boolean; data?: { id?: string } };
  expect(created.success).toBe(true);
  const templateId = created.data?.id || '';
  expect(templateId).not.toBe('');

  await loginAsDefault(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: '+ 新建任务' }).click();

  const form = page.locator('form').filter({ hasText: '创建任务' }).first();
  const templateSelect = form.locator('label', { hasText: '任务模板' }).locator('xpath=following-sibling::select[1]');
  await templateSelect.selectOption({ label: templateName });

  const titleInput = form.locator('label', { hasText: '标题' }).locator('xpath=following-sibling::input[1]');
  const promptTextarea = form.locator('label', { hasText: '任务描述 / 提示词' }).locator('xpath=following-sibling::textarea[1]');

  await expect(titleInput).toHaveValue(templateTitle);
  await expect(promptTextarea).toHaveValue(templatePrompt);

  const deleteRes = await request.delete(`/api/task-templates/${templateId}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'x-cam-actor': 'e2e-task-template-test',
    },
  });
  expect(deleteRes.ok()).toBeTruthy();
});

test('创建流水线模板时会校验步骤级智能体是否存在', async ({ request }) => {
  const suffix = Date.now();
  const invalidAgentId = `missing-agent-${suffix}`;
  const res = await request.post('/api/task-templates', {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'x-cam-actor': 'e2e-invalid-step-agent-test',
    },
    data: {
      name: `E2E-非法步骤智能体-${suffix}`,
      titleTemplate: '(流水线模板)',
      promptTemplate: '(流水线模板)',
      pipelineSteps: [
        {
          title: '步骤一',
          description: '执行检查',
          agentDefinitionId: invalidAgentId,
        },
      ],
      maxRetries: 2,
    },
  });

  expect(res.status()).toBe(404);
  const body = (await res.json()) as { success?: boolean; error?: { message?: string } };
  expect(body.success).toBe(false);
  expect(body.error?.message || '').toContain(invalidAgentId);
});
