export type PipelineCallbackTokenInfo = {
  pipelineId: string;
  taskId: string;
};

export type PipelineHookCleanup = () => Promise<void>;

export function buildPipelineHookCleanupKey(
  pipelineId: string,
  stepIndex: number,
  nodeIndex: number,
): string {
  return `${pipelineId}:${stepIndex}:${nodeIndex}`;
}

export function consumePipelineCallbackToken(
  callbackTokens: Map<string, PipelineCallbackTokenInfo>,
  token: string,
  expected: PipelineCallbackTokenInfo,
): boolean {
  const tokenInfo = callbackTokens.get(token);
  if (!tokenInfo) return false;
  if (tokenInfo.pipelineId !== expected.pipelineId || tokenInfo.taskId !== expected.taskId) {
    return false;
  }
  callbackTokens.delete(token);
  return true;
}

export function cleanupPipelineHookByKey(
  hookCleanups: Map<string, PipelineHookCleanup>,
  cleanupKey: string,
): void {
  const cleanup = hookCleanups.get(cleanupKey);
  if (!cleanup) return;
  cleanup().catch(() => {});
  hookCleanups.delete(cleanupKey);
}

export function cleanupPipelineHooksById(
  hookCleanups: Map<string, PipelineHookCleanup>,
  pipelineId: string,
): void {
  for (const [key, cleanup] of Array.from(hookCleanups.entries())) {
    if (!key.startsWith(`${pipelineId}:`)) continue;
    cleanup().catch(() => {});
    hookCleanups.delete(key);
  }
}

export function cleanupPipelineCallbackTokensById(
  callbackTokens: Map<string, PipelineCallbackTokenInfo>,
  pipelineId: string,
): void {
  for (const [token, info] of callbackTokens.entries()) {
    if (info.pipelineId !== pipelineId) continue;
    callbackTokens.delete(token);
  }
}
