import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseClaudeAuthStatus,
  parseReportedEnvVars,
  parseWorkerMode,
} from './payload.ts';

test('parseWorkerMode: 支持 daemon/task 并兜底 unknown', () => {
  assert.equal(parseWorkerMode('daemon'), 'daemon');
  assert.equal(parseWorkerMode('TASK'), 'task');
  assert.equal(parseWorkerMode('xx'), 'unknown');
});

test('parseWorkerMode: allowUndefinedAsNull 生效', () => {
  assert.equal(parseWorkerMode(undefined, { allowUndefinedAsNull: true }), null);
  assert.equal(parseWorkerMode(undefined), 'unknown');
});

test('parseReportedEnvVars: 过滤非法值并去重', () => {
  const result = parseReportedEnvVars(['A', 'A', 'OPENAI_API_KEY', 'bad-name', '  FOO_BAR  ', 1]);
  assert.deepEqual(result, ['FOO_BAR', 'OPENAI_API_KEY']);
});

test('parseReportedEnvVars: undefined/null 场景', () => {
  assert.equal(parseReportedEnvVars(undefined), null);
  assert.deepEqual(parseReportedEnvVars(null), []);
});

test('parseClaudeAuthStatus: 合法对象解析', () => {
  const parsed = parseClaudeAuthStatus({
    loggedIn: true,
    authMethod: 'token',
    apiProvider: 'anthropic',
  });
  assert.deepEqual(parsed, {
    loggedIn: true,
    authMethod: 'token',
    apiProvider: 'anthropic',
  });
});

test('parseClaudeAuthStatus: 非法对象处理', () => {
  assert.equal(parseClaudeAuthStatus(undefined), undefined);
  assert.equal(parseClaudeAuthStatus({ loggedIn: 'yes' }), null);
  assert.equal(parseClaudeAuthStatus([]), null);
});
