import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIsoMs } from './parse-iso.ts';

test('parseIsoMs: 解析有效 ISO 时间', () => {
  const ms = parseIsoMs('2026-01-01T00:00:00.000Z');
  assert.equal(ms, 1767225600000);
});

test('parseIsoMs: 处理空值与非法值', () => {
  assert.equal(parseIsoMs(null), null);
  assert.equal(parseIsoMs(undefined), null);
  assert.equal(parseIsoMs(''), null);
  assert.equal(parseIsoMs('invalid'), null);
});
