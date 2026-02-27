import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPLOYABLE_CLI_CONFIGS,
  getTerminalAutoExitArgs,
  getTerminalInteractiveArgs,
  isCodexCliAgent,
  resolveWorkerCliTemplate,
} from './cli-profiles.ts';

test('resolveWorkerCliTemplate: 内置 codex 返回统一 worker 模板', () => {
  const result = resolveWorkerCliTemplate('codex', {
    command: 'codex',
    args: ['fallback'],
  });
  assert.equal(result.command, 'codex');
  assert.deepEqual(result.args, ['--quiet', '--full-auto', '{{prompt}}']);
});

test('resolveWorkerCliTemplate: 未知 agent 回退到调用方默认值', () => {
  const result = resolveWorkerCliTemplate('custom-agent', {
    command: 'custom',
    args: ['--run', '{{prompt}}'],
  });
  assert.equal(result.command, 'custom');
  assert.deepEqual(result.args, ['--run', '{{prompt}}']);
});

test('terminal args: codex 交互/自动退出参数由统一档案提供', () => {
  assert.deepEqual(getTerminalInteractiveArgs('codex', 'hello'), ['--full-auto', 'hello']);
  assert.deepEqual(getTerminalAutoExitArgs('codex', 'hello'), ['exec', '--full-auto', 'hello']);
});

test('isCodexCliAgent: 仅 codex 返回 true', () => {
  assert.equal(isCodexCliAgent('codex'), true);
  assert.equal(isCodexCliAgent('claude-code'), false);
});

test('DEPLOYABLE_CLI_CONFIGS: 仅包含可一键部署 CLI，且命令与档案一致', () => {
  assert.deepEqual(
    DEPLOYABLE_CLI_CONFIGS.map((item) => item.id),
    ['claude-code', 'codex'],
  );
  assert.equal(DEPLOYABLE_CLI_CONFIGS[0].command, 'claude');
  assert.equal(DEPLOYABLE_CLI_CONFIGS[1].command, 'codex');
});
