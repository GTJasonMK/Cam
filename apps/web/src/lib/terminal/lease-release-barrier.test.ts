import test from 'node:test';
import assert from 'node:assert/strict';
import { trackPendingLeaseRelease, waitPendingLeaseRelease } from './lease-release-barrier.ts';

function defer(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test('waitPendingLeaseRelease: 存在屏障时会等待释放完成', async () => {
  const pendingReleases = new Map<string, Promise<void>>();
  const leaseKey = 'u::k';
  const blocked = defer();

  trackPendingLeaseRelease(pendingReleases, leaseKey, blocked.promise);

  let unblocked = false;
  const waitPromise = waitPendingLeaseRelease(pendingReleases, leaseKey).then(() => {
    unblocked = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(unblocked, false);

  blocked.resolve();
  await waitPromise;
  assert.equal(unblocked, true);
});

test('trackPendingLeaseRelease: Promise 完成后自动清理屏障', async () => {
  const pendingReleases = new Map<string, Promise<void>>();
  const leaseKey = 'u::k-cleanup';
  const releasePromise = Promise.resolve();

  trackPendingLeaseRelease(pendingReleases, leaseKey, releasePromise);
  assert.equal(pendingReleases.has(leaseKey), true);

  await releasePromise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(pendingReleases.has(leaseKey), false);
});

test('waitPendingLeaseRelease: 到达超时后返回，不阻塞调用链路', async () => {
  const pendingReleases = new Map<string, Promise<void>>();
  const leaseKey = 'u::k-timeout';
  const blocked = defer();

  trackPendingLeaseRelease(pendingReleases, leaseKey, blocked.promise);

  const started = Date.now();
  await waitPendingLeaseRelease(pendingReleases, leaseKey, { timeoutMs: 25 });
  const elapsed = Date.now() - started;

  assert.equal(elapsed >= 20, true);
  assert.equal(elapsed < 500, true);

  blocked.resolve();
});
