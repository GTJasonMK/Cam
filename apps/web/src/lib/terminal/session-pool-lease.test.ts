import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLeaseStaleBeforeIso, isLeaseExpired } from './session-pool-lease.ts';

test('buildLeaseStaleBeforeIso: 返回 now-staleMs 的 ISO 时间', () => {
  const now = Date.parse('2026-01-01T00:00:10.000Z');
  const staleMs = 10_000;
  assert.equal(buildLeaseStaleBeforeIso(now, staleMs), '2026-01-01T00:00:00.000Z');
});

test('isLeaseExpired: 超过阈值后判定为过期', () => {
  const now = Date.parse('2026-01-01T00:01:30.000Z');
  const staleMs = 90_000;
  assert.equal(isLeaseExpired('2026-01-01T00:00:00.000Z', now, staleMs), true);
});

test('isLeaseExpired: 未超过阈值判定为未过期', () => {
  const now = Date.parse('2026-01-01T00:01:29.999Z');
  const staleMs = 90_000;
  assert.equal(isLeaseExpired('2026-01-01T00:00:00.000Z', now, staleMs), false);
});

test('isLeaseExpired: 非法时间字符串不判定为过期', () => {
  const now = Date.parse('2026-01-01T00:01:30.000Z');
  const staleMs = 90_000;
  assert.equal(isLeaseExpired('invalid-time', now, staleMs), false);
});
