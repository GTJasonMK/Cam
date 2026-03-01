export function trackPendingLeaseRelease(
  pendingReleases: Map<string, Promise<void>>,
  leaseKey: string,
  releasePromise: Promise<void>,
): void {
  pendingReleases.set(leaseKey, releasePromise);
  void releasePromise.finally(() => {
    const current = pendingReleases.get(leaseKey);
    if (current === releasePromise) {
      pendingReleases.delete(leaseKey);
    }
  });
}

export async function waitPendingLeaseRelease(
  pendingReleases: Map<string, Promise<void>>,
  leaseKey: string,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const pending = pendingReleases.get(leaseKey);
  if (!pending) return;
  const timeoutMs = Number.isFinite(opts?.timeoutMs) ? Math.max(0, opts!.timeoutMs as number) : 0;
  try {
    if (timeoutMs <= 0) {
      await pending;
      return;
    }
    await Promise.race([
      pending,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // 调用方的释放逻辑应自行兜底日志；这里仅等待屏障结束
  }
}
