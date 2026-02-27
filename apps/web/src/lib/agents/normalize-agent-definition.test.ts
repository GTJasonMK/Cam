import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentDefinitionForExecution } from './normalize-agent-definition.ts';

test('normalizeAgentDefinitionForExecution: 已知内置 agent 使用统一命令模板', () => {
  const input = {
    id: 'codex',
    command: 'codex-custom',
    args: ['--old', 'x'],
    displayName: 'Codex',
  };

  const result = normalizeAgentDefinitionForExecution(input);
  assert.equal(result.command, 'codex');
  assert.deepEqual(result.args, ['--quiet', '--full-auto', '{{prompt}}']);
  assert.equal(result.displayName, 'Codex');
});

test('normalizeAgentDefinitionForExecution: 未知 agent 保持原配置', () => {
  const input = {
    id: 'custom-agent',
    command: 'my-agent',
    args: ['--once'],
  };

  const result = normalizeAgentDefinitionForExecution(input);
  assert.equal(result.command, 'my-agent');
  assert.deepEqual(result.args, ['--once']);
});
