type MemoryWindow = {
  count: number;
  resetAt: number;
};

type GlobalRateLimitState = {
  store: Map<string, MemoryWindow>;
  gcCursor: number;
};

type GlobalWithRateLimit = typeof globalThis & {
  __camRateLimitState?: GlobalRateLimitState;
};

function getGlobalState(): GlobalRateLimitState {
  const g = globalThis as GlobalWithRateLimit;
  if (!g.__camRateLimitState) {
    g.__camRateLimitState = {
      store: new Map<string, MemoryWindow>(),
      gcCursor: 0,
    };
  }
  return g.__camRateLimitState;
}

function gcExpiredWindows(nowMs: number): void {
  const state = getGlobalState();
  state.gcCursor += 1;
  if (state.gcCursor % 120 !== 0 && state.store.size < 3000) return;

  for (const [key, value] of state.store.entries()) {
    if (value.resetAt <= nowMs) {
      state.store.delete(key);
    }
  }
}

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
};

export function consumeRateLimitToken(input: {
  key: string;
  limit: number;
  windowMs: number;
  nowMs?: number;
}): RateLimitDecision {
  const limit = Number.isFinite(input.limit) ? Math.max(0, Math.floor(input.limit)) : 0;
  const windowMs = Number.isFinite(input.windowMs) ? Math.max(1, Math.floor(input.windowMs)) : 60_000;
  const nowMs = input.nowMs ?? Date.now();

  if (!input.key || limit <= 0) {
    return {
      allowed: true,
      remaining: 0,
      resetAt: nowMs + windowMs,
      limit,
    };
  }

  gcExpiredWindows(nowMs);
  const state = getGlobalState();
  const store = state.store;
  const existing = store.get(input.key);

  if (!existing || existing.resetAt <= nowMs) {
    const nextWindow: MemoryWindow = {
      count: 1,
      resetAt: nowMs + windowMs,
    };
    store.set(input.key, nextWindow);
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      resetAt: nextWindow.resetAt,
      limit,
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      limit,
    };
  }

  existing.count += 1;
  store.set(input.key, existing);
  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    limit,
  };
}

export function __unsafeResetRateLimitMemoryStoreForTests(): void {
  const g = globalThis as GlobalWithRateLimit;
  delete g.__camRateLimitState;
}
