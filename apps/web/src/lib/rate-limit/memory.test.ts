import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeRateLimitToken,
  __unsafeResetRateLimitMemoryStoreForTests,
} from './memory.ts';

test('consumeRateLimitToken: 窗口内超过上限后拒绝', () => {
  __unsafeResetRateLimitMemoryStoreForTests();
  const key = 'case-basic';

  const r1 = consumeRateLimitToken({ key, limit: 2, windowMs: 1_000, nowMs: 1_000 });
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 1);

  const r2 = consumeRateLimitToken({ key, limit: 2, windowMs: 1_000, nowMs: 1_100 });
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 0);

  const r3 = consumeRateLimitToken({ key, limit: 2, windowMs: 1_000, nowMs: 1_200 });
  assert.equal(r3.allowed, false);
  assert.equal(r3.remaining, 0);
});

test('consumeRateLimitToken: 新窗口重置计数', () => {
  __unsafeResetRateLimitMemoryStoreForTests();
  const key = 'case-reset';

  const first = consumeRateLimitToken({ key, limit: 1, windowMs: 1_000, nowMs: 1_000 });
  assert.equal(first.allowed, true);

  const blocked = consumeRateLimitToken({ key, limit: 1, windowMs: 1_000, nowMs: 1_500 });
  assert.equal(blocked.allowed, false);

  const nextWindow = consumeRateLimitToken({ key, limit: 1, windowMs: 1_000, nowMs: 2_100 });
  assert.equal(nextWindow.allowed, true);
});

test('consumeRateLimitToken: limit<=0 不阻断请求', () => {
  __unsafeResetRateLimitMemoryStoreForTests();
  const result = consumeRateLimitToken({ key: 'disabled', limit: 0, windowMs: 1_000, nowMs: 1_000 });
  assert.equal(result.allowed, true);
});
