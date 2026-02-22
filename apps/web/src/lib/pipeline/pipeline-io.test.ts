import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectPipelineReferencedAgentIds,
  findMissingPipelineAgentIds,
  parsePipelineImport,
  sanitizePipelineImportAgentIds,
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

test('parsePipelineImport/collectPipelineReferencedAgentIds: 支持并行子任务字段', () => {
  const result = parsePipelineImport(JSON.stringify({
    type: 'cam-pipeline',
    steps: [
      {
        title: '并行阶段',
        description: '实现',
        inputFiles: ['summary.md', 'module-a.md'],
        inputCondition: 'summary.md 存在',
        parallelAgents: [
          { title: 'A', description: '实现 A', agentDefinitionId: 'codex' },
          { title: 'B', description: '实现 B', agentDefinitionId: 'claude-code' },
        ],
      },
    ],
  }));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.steps[0].parallelAgents?.length, 2);
  assert.deepEqual(result.data.steps[0].inputFiles, ['summary.md', 'module-a.md']);

  const refs = collectPipelineReferencedAgentIds(result.data);
  assert.deepEqual(refs.sort(), ['claude-code', 'codex']);
});

test('parsePipelineImport: 兼容旧格式 prompt/pipelineSteps 字段', () => {
  const result = parsePipelineImport(JSON.stringify({
    type: 'cam-pipeline-template',
    pipelineSteps: [
      {
        title: '旧步骤',
        prompt: '旧描述',
        parallelAgents: [
          { title: '并行A', prompt: '并行旧描述', agentDefinitionId: 'codex' },
        ],
      },
    ],
  }));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.steps[0].description, '旧描述');
  assert.equal(result.data.steps[0].parallelAgents?.[0]?.description, '并行旧描述');
});

test('sanitizePipelineImportAgentIds: 清理未知 Agent 引用', () => {
  const parsed = parsePipelineImport(JSON.stringify({
    type: 'cam-pipeline',
    agentDefinitionId: 'codex',
    steps: [
      { title: '步骤1', description: 'desc1', agentDefinitionId: 'unknown-a' },
      {
        title: '步骤2',
        description: 'desc2',
        parallelAgents: [
          { description: 'p1', agentDefinitionId: 'claude-code' },
          { description: 'p2', agentDefinitionId: 'unknown-b' },
        ],
      },
    ],
  }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const sanitized = sanitizePipelineImportAgentIds(parsed.data, ['codex', 'claude-code']);
  assert.deepEqual(sanitized.missingAgentIds.sort(), ['unknown-a', 'unknown-b']);
  assert.equal(sanitized.data.agentDefinitionId, 'codex');
  assert.equal(sanitized.data.steps[0].agentDefinitionId, undefined);
  assert.equal(sanitized.data.steps[1].parallelAgents?.[0]?.agentDefinitionId, 'claude-code');
  assert.equal(sanitized.data.steps[1].parallelAgents?.[1]?.agentDefinitionId, undefined);
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
