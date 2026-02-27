import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentCommand } from './agent-command.ts';

test('resolveAgentCommand: codex resume 在 autoExit 场景追加 --full-auto 与 prompt', () => {
  const result = resolveAgentCommand({
    agentDefinitionId: 'codex',
    command: 'codex',
    mode: 'resume',
    resumeSessionId: 'sess-1',
    prompt: '修复本步骤缺陷',
    autoExit: true,
  });

  assert.equal(result.file, 'codex');
  assert.deepEqual(result.args, ['resume', 'sess-1', '--full-auto', '修复本步骤缺陷']);
});

test('resolveAgentCommand: codex continue 在无会话 ID 时使用 --last 并透传 prompt', () => {
  const result = resolveAgentCommand({
    agentDefinitionId: 'codex',
    command: 'codex',
    mode: 'continue',
    prompt: '继续推进下一步',
    autoExit: false,
  });

  assert.equal(result.file, 'codex');
  assert.deepEqual(result.args, ['resume', '--last', '继续推进下一步']);
});

test('resolveAgentCommand: codex create + autoExit 保持 exec 路径不变', () => {
  const result = resolveAgentCommand({
    agentDefinitionId: 'codex',
    command: 'codex',
    mode: 'create',
    prompt: '实现功能',
    autoExit: true,
  });

  assert.equal(result.file, 'codex');
  assert.deepEqual(result.args, ['exec', '--full-auto', '实现功能']);
});

test('resolveAgentCommand: claude resume 仍保持原有参数行为', () => {
  const result = resolveAgentCommand({
    agentDefinitionId: 'claude-code',
    command: 'claude',
    mode: 'resume',
    resumeSessionId: 'claude-sess',
    prompt: '继续完成任务',
    autoExit: false,
  });

  assert.equal(result.file, 'claude');
  assert.deepEqual(result.args, ['--resume', 'claude-sess', '继续完成任务']);
});
