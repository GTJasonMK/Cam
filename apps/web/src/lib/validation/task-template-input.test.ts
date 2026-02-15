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
