import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectPipelineReferencedAgentIds,
  findMissingPipelineAgentIds,
  parsePipelineImport,
  validatePipelineImportFileSize,
} from '../pipeline-io.ts';

test('parsePipelineImport: 解析成功并规范化关键字段', () => {
  const result = parsePipelineImport(JSON.stringify({
    type: 'cam-pipeline',
    agentDefinitionId: '  codex  ',
    maxRetries: 99.8,
    steps: [
      {
        title: '  第一步  ',
        description: '  扫描仓库  ',
        agentDefinitionId: '  claude-code  ',
      },
    ],
  }));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.agentDefinitionId, 'codex');
  assert.equal(result.data.maxRetries, 20);
  assert.equal(result.data.steps[0].title, '第一步');
  assert.equal(result.data.steps[0].description, '扫描仓库');
  assert.equal(result.data.steps[0].agentDefinitionId, 'claude-code');
});

test('parsePipelineImport: 缺少步骤时返回失败', () => {
  const result = parsePipelineImport(JSON.stringify({
    type: 'cam-pipeline',
    steps: [],
  }));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /至少一个步骤/);
});

test('findMissingPipelineAgentIds: 返回缺失的 Agent 引用', () => {
  const data = {
    agentDefinitionId: 'codex',
    steps: [
      { title: 's1', description: 'd1', agentDefinitionId: 'claude-code' },
      { title: 's2', description: 'd2', agentDefinitionId: 'codex' },
    ],
  };

  const refs = collectPipelineReferencedAgentIds(data);
  assert.deepEqual(refs.sort(), ['claude-code', 'codex']);

  const missing = findMissingPipelineAgentIds(data, ['codex', 'aider']);
  assert.deepEqual(missing, ['claude-code']);
});

test('validatePipelineImportFileSize: 超过阈值时返回失败', () => {
  const result = validatePipelineImportFileSize(3 * 1024 * 1024, 2 * 1024 * 1024);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /文件过大/);
});

test('validatePipelineImportFileSize: 未超限时通过', () => {
  const result = validatePipelineImportFileSize(512 * 1024, 2 * 1024 * 1024);
  assert.equal(result.ok, true);
});
