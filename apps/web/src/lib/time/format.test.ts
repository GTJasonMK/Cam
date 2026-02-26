import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDateTimeZhCn,
  formatDateZhCn,
  formatTimeZhCn,
  toSafeTimestamp,
} from './format.ts';

test('toSafeTimestamp: 空值与非法值回退 0', () => {
  assert.equal(toSafeTimestamp(null), 0);
  assert.equal(toSafeTimestamp('invalid-date'), 0);
  assert.equal(toSafeTimestamp('2026-01-01T00:00:00.000Z'), 1767225600000);
});

test('formatDateTimeZhCn: 空值/非法值返回 fallback', () => {
  assert.equal(formatDateTimeZhCn(null), '-');
  assert.equal(formatDateTimeZhCn('invalid', 'N/A'), 'N/A');
  assert.notEqual(formatDateTimeZhCn('2026-01-01T00:00:00.000Z'), '-');
});

test('formatTimeZhCn: 空值/非法值返回 fallback', () => {
  assert.equal(formatTimeZhCn(null), '-');
  assert.equal(formatTimeZhCn('invalid', 'N/A'), 'N/A');
  assert.notEqual(formatTimeZhCn('2026-01-01T00:00:00.000Z'), '-');
});

test('formatDateZhCn: 空值/非法值返回 fallback', () => {
  assert.equal(formatDateZhCn(null), '-');
  assert.equal(formatDateZhCn('invalid', 'N/A'), 'N/A');
  assert.notEqual(formatDateZhCn('2026-01-01T00:00:00.000Z'), '-');
});
