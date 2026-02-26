import test from 'node:test';
import assert from 'node:assert/strict';
import { getWorkerStaleTimeoutMs } from './stale-timeout.ts';

test('getWorkerStaleTimeoutMs: 正常数值与取整', () => {
  assert.equal(getWorkerStaleTimeoutMs('45000'), 45_000);
  assert.equal(getWorkerStaleTimeoutMs('45000.9'), 45_000);
});

test('getWorkerStaleTimeoutMs: 非法值回退默认值', () => {
  assert.equal(getWorkerStaleTimeoutMs(undefined), 30_000);
  assert.equal(getWorkerStaleTimeoutMs('abc'), 30_000);
  assert.equal(getWorkerStaleTimeoutMs('0'), 30_000);
  assert.equal(getWorkerStaleTimeoutMs('-1'), 30_000);
});
