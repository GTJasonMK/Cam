export type SessionGcMeta = {
  status: string;
  taskId?: string;
};

export type PipelineGcNode = {
  sessionId?: string;
};

export type PipelineGcStep = {
  nodes: PipelineGcNode[];
};

export type PipelineGcMeta = {
  status: string;
  steps: PipelineGcStep[];
};

export function collectFinishedSessionIds<TMeta extends SessionGcMeta>(
  sessions: Map<string, TMeta>,
  hasPtySession: (sessionId: string) => boolean,
): string[] {
  const result: string[] = [];
  for (const [sessionId, meta] of sessions.entries()) {
    if (meta.status === 'running') continue;
    if (hasPtySession(sessionId)) continue;
    result.push(sessionId);
  }
  return result;
}

export function collectExpiredSessionActions<TMeta extends SessionGcMeta>(params: {
  sessions: Map<string, TMeta>;
  sessionFinishedAt: Map<string, number>;
  now: number;
  ttlMs: number;
  hasPtySession: (sessionId: string) => boolean;
  hasPendingLogFlush: (sessionId: string) => boolean;
}): {
  clearFinishedAtSessionIds: string[];
  deleteSessionIds: string[];
} {
  const clearFinishedAtSessionIds: string[] = [];
  const deleteSessionIds: string[] = [];

  for (const [sessionId, finishedAt] of params.sessionFinishedAt.entries()) {
    if (params.now - finishedAt < params.ttlMs) continue;
    const meta = params.sessions.get(sessionId);
    if (!meta) {
      clearFinishedAtSessionIds.push(sessionId);
      continue;
    }
    if (meta.status === 'running') {
      clearFinishedAtSessionIds.push(sessionId);
      continue;
    }
    if (params.hasPtySession(sessionId)) continue;
    if (params.hasPendingLogFlush(sessionId)) continue;

    deleteSessionIds.push(sessionId);
  }

  return {
    clearFinishedAtSessionIds,
    deleteSessionIds,
  };
}

export function collectExpiredPipelineActions<TPipeline extends PipelineGcMeta>(params: {
  pipelines: Map<string, TPipeline>;
  pipelineFinishedAt: Map<string, number>;
  now: number;
  ttlMs: number;
  hasPtySession: (sessionId: string) => boolean;
}): {
  clearFinishedAtPipelineIds: string[];
  deletePipelineIds: string[];
} {
  const clearFinishedAtPipelineIds: string[] = [];
  const deletePipelineIds: string[] = [];

  for (const [pipelineId, finishedAt] of params.pipelineFinishedAt.entries()) {
    if (params.now - finishedAt < params.ttlMs) continue;
    const pipeline = params.pipelines.get(pipelineId);
    if (!pipeline) {
      clearFinishedAtPipelineIds.push(pipelineId);
      continue;
    }
    if (pipeline.status === 'running' || pipeline.status === 'paused') {
      clearFinishedAtPipelineIds.push(pipelineId);
      continue;
    }

    const hasActiveNodes = pipeline.steps.some((step) =>
      step.nodes.some((node) => Boolean(node.sessionId && params.hasPtySession(node.sessionId)))
    );
    if (hasActiveNodes) continue;

    deletePipelineIds.push(pipelineId);
  }

  return {
    clearFinishedAtPipelineIds,
    deletePipelineIds,
  };
}
