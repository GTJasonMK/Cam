import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkerStatus } from './status.ts';

test('parseWorkerStatus: 支持合法状态并标准化大小写/空白', () => {
  assert.equal(parseWorkerStatus('idle'), 'idle');
  assert.equal(parseWorkerStatus(' Busy '), 'busy');
  assert.equal(parseWorkerStatus('OFFLINE'), 'offline');
  assert.equal(parseWorkerStatus('draining'), 'draining');
});

test('parseWorkerStatus: 非法输入返回 null', () => {
  assert.equal(parseWorkerStatus(undefined), null);
  assert.equal(parseWorkerStatus(''), null);
  assert.equal(parseWorkerStatus('blocked'), null);
  assert.equal(parseWorkerStatus(1), null);
});

