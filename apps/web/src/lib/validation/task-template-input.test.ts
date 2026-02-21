import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCreateTaskTemplatePayload, parsePatchTaskTemplatePayload } from './task-template-input.ts';

test('parseCreateTaskTemplatePayload: 解析成功', () => {
  const result = parseCreateTaskTemplatePayload({
    name: '  缺陷修复模板  ',
    titleTemplate: '  修复线上问题  ',
    promptTemplate: '  请先复现，再提交修复 PR  ',
    agentDefinitionId: 'agent-codex',
    repositoryId: 'repo-1',
    baseBranch: ' main ',
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.name, '缺陷修复模板');
  assert.equal(result.data.titleTemplate, '修复线上问题');
  assert.equal(result.data.promptTemplate, '请先复现，再提交修复 PR');
  assert.equal(result.data.baseBranch, 'main');
});

test('parseCreateTaskTemplatePayload: 缺少必填字段返回失败', () => {
  const result = parseCreateTaskTemplatePayload({
    name: '模板',
    titleTemplate: '',
    promptTemplate: '执行内容',
  });
  assert.equal(result.success, false);
});

test('parseCreateTaskTemplatePayload: 流水线模板允许缺省标题和提示词', () => {
  const result = parseCreateTaskTemplatePayload({
    name: '流水线模板',
    pipelineSteps: [
      { title: '步骤一', description: '执行检查' },
    ],
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.titleTemplate, '(流水线模板)');
  assert.equal(result.data.promptTemplate, '(流水线模板)');
  assert.equal(result.data.pipelineSteps?.length, 1);
});

test('parseCreateTaskTemplatePayload: 支持并行子任务与输入约束字段', () => {
  const result = parseCreateTaskTemplatePayload({
    name: '并行流水线模板',
    pipelineSteps: [
      {
        title: '实现阶段',
        description: '按模块并行',
        inputFiles: ['summary.md', 'module-a.md'],
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
  assert.equal(result.data.pipelineSteps?.[0].parallelAgents?.length, 2);
  assert.deepEqual(result.data.pipelineSteps?.[0].inputFiles, ['summary.md', 'module-a.md']);
  assert.equal(result.data.pipelineSteps?.[0].inputCondition, 'summary.md 存在');
});

test('parseCreateTaskTemplatePayload: 非法 pipelineSteps 返回失败', () => {
  const result = parseCreateTaskTemplatePayload({
    name: '非法流水线',
    titleTemplate: '(流水线模板)',
    promptTemplate: '(流水线模板)',
    pipelineSteps: [
      { title: '', description: '执行检查' },
    ],
  });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.match(result.errorMessage, /pipelineSteps\[0\]/);
});

test('parsePatchTaskTemplatePayload: 允许可空字段', () => {
  const result = parsePatchTaskTemplatePayload({
    repositoryId: null,
    repoUrl: ' https://github.com/acme/repo ',
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.repositoryId, null);
  assert.equal(result.data.repoUrl, 'https://github.com/acme/repo');
});

test('parsePatchTaskTemplatePayload: 空更新返回失败', () => {
  const result = parsePatchTaskTemplatePayload({});
  assert.equal(result.success, false);
});

test('parsePatchTaskTemplatePayload: 非法 pipelineSteps 返回失败', () => {
  const result = parsePatchTaskTemplatePayload({
    pipelineSteps: [],
  });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.match(result.errorMessage, /至少需要 1 个步骤/);
});
