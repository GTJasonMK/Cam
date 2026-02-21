import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSessionTtlHours } from './session-ttl.ts';

test('normalizeSessionTtlHours: 合法 TTL 透传', () => {
  assert.equal(normalizeSessionTtlHours('24'), 24);
  assert.equal(normalizeSessionTtlHours('72'), 72);
});

test('normalizeSessionTtlHours: 非法值回退默认值', () => {
  assert.equal(normalizeSessionTtlHours(undefined), 24);
  assert.equal(normalizeSessionTtlHours(''), 24);
  assert.equal(normalizeSessionTtlHours('abc'), 24);
  assert.equal(normalizeSessionTtlHours('0'), 24);
  assert.equal(normalizeSessionTtlHours('-1'), 24);
});
