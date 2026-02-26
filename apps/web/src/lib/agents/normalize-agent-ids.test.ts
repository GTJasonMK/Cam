import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentIds } from './normalize-agent-ids.ts';

test('normalizeAgentIds: 去空白、去重并保持原顺序', () => {
  const ids = normalizeAgentIds([' codex ', '', 'aider', 'codex', 'claude-code']);
  assert.deepEqual(ids, ['codex', 'aider', 'claude-code']);
});

test('normalizeAgentIds: 跳过非字符串值', () => {
  const ids = normalizeAgentIds(['codex', null, undefined, 1, 'aider']);
  assert.deepEqual(ids, ['codex', 'aider']);
});
