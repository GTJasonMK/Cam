import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCreateTaskPayload,
  parseCreatePipelinePayload,
  parseReviewPayload,
  parseTaskPatchPayload,
} from './task-input.ts';

test('parseCreateTaskPayload: 解析成功并应用默认值', () => {
  const result = parseCreateTaskPayload({
    title: '  Fix bug  ',
    description: '  修复登录问题  ',
    agentDefinitionId: 'agent-codex',
    repoUrl: 'https://github.com/acme/repo',
    dependsOn: ['a', 'a', 'b', '   '],
  });

  assert.equal(result.success, true);
  if (!result.success) return;

  assert.equal(result.data.title, 'Fix bug');
  assert.equal(result.data.baseBranch, 'main');
  assert.equal(result.data.maxRetries, 2);
  assert.deepEqual(result.data.dependsOn, ['a', 'b']);
});

test('parseCreateTaskPayload: 缺少必填字段返回失败', () => {
  const result = parseCreateTaskPayload({
    title: 'only title',
  });
  assert.equal(result.success, false);
});

test('parseCreatePipelinePayload: 非法 steps 返回失败', () => {
  const result = parseCreatePipelinePayload({
    agentDefinitionId: 'agent',
    repoUrl: 'https://github.com/acme/repo',
    steps: [{ title: 'step1' }],
  });

  assert.equal(result.success, false);
});

test('parseCreatePipelinePayload: 支持并行子任务并解析输入约束', () => {
  const result = parseCreatePipelinePayload({
    repoUrl: 'https://github.com/acme/repo',
    steps: [
      {
        title: '并行实现',
        description: '按模块拆分',
        inputFiles: ['summary.md', 'summary.md', 'module-a.md'],
        inputCondition: 'summary.md 存在',
        parallelAgents: [
          { title: 'A', description: '实现 A', agentDefinitionId: 'codex' },
          { title: 'B', description: '实现 B', agentDefinitionId: 'claude-code' },
        ],
      },
    ],
  });

  assert.equal(result.success, true);
  if (!result.success) return;

  assert.equal(result.data.steps[0].parallelAgents?.length, 2);
  assert.deepEqual(result.data.steps[0].inputFiles, ['summary.md', 'module-a.md']);
  assert.equal(result.data.steps[0].inputCondition, 'summary.md 存在');
});

test('parseReviewPayload: reject 必须提供 feedback', () => {
  const result = parseReviewPayload({
    action: 'reject',
    feedback: '   ',
  });
  assert.equal(result.success, false);
});

test('parseTaskPatchPayload: 允许更新 status 与 summary', () => {
  const result = parseTaskPatchPayload({
    status: 'running',
    summary: '  已开始执行  ',
  });
  assert.equal(result.success, true);
  if (!result.success) return;

  assert.equal(result.data.status, 'running');
  assert.equal(result.data.summary, '已开始执行');
});

test('parseTaskPatchPayload: 非法 status 返回失败', () => {
  const result = parseTaskPatchPayload({
    status: 'not-a-valid-status',
  });
  assert.equal(result.success, false);
});
