import test from 'node:test';
import assert from 'node:assert/strict';
import { formatInputFiles, normalizeRetries, parseInputFiles } from './form-helpers.ts';

test('parseInputFiles: 支持逗号/换行并去重去空白', () => {
  const result = parseInputFiles('a.ts, b.ts\nc.ts\n a.ts  ');
  assert.deepEqual(result, ['a.ts', 'b.ts', 'c.ts']);
});

test('formatInputFiles: 空值与普通数组', () => {
  assert.equal(formatInputFiles(), '');
  assert.equal(formatInputFiles([]), '');
  assert.equal(formatInputFiles(['a.ts', 'b.ts']), 'a.ts, b.ts');
});

test('normalizeRetries: 限制范围并取整', () => {
  assert.equal(normalizeRetries(Number.NaN), 2);
  assert.equal(normalizeRetries(-10), 0);
  assert.equal(normalizeRetries(2.8), 3);
  assert.equal(normalizeRetries(25), 20);
});
