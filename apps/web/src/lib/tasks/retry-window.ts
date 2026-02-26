export function computeNextRetryWindow(retryCount: number, maxRetries: number): {
  nextRetryCount: number;
  nextMaxRetries: number;
} {
  const nextRetryCount = retryCount + 1;
  return {
    nextRetryCount,
    nextMaxRetries: Math.max(maxRetries, nextRetryCount),
  };
}

export function computeRetryWindow(input: {
  retryCount: number;
  maxRetries: number;
  shouldIncrement: boolean;
}): {
  nextRetryCount: number;
  nextMaxRetries: number;
} {
  if (!input.shouldIncrement) {
    return {
      nextRetryCount: input.retryCount,
      nextMaxRetries: input.maxRetries,
    };
  }

  return computeNextRetryWindow(input.retryCount, input.maxRetries);
}
