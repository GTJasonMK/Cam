import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDateTimeZhCn, toSafeTimestamp, truncateText } from './display.ts';

test('truncateText: 超长文本省略', () => {
  assert.equal(truncateText('abcdef', 4), 'abcd...');
  assert.equal(truncateText('abc', 4), 'abc');
});

test('time helpers: display 层继续暴露时间工具（兼容旧调用方）', () => {
  assert.equal(typeof toSafeTimestamp, 'function');
  assert.equal(typeof formatDateTimeZhCn, 'function');
});
