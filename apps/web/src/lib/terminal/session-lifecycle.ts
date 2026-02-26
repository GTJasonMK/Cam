export type SessionLifecycleMeta = {
  status: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
};

export type SessionTransitionResult<TMeta extends SessionLifecycleMeta> = {
  previous: TMeta;
  updated: TMeta;
  finishedAt: number;
  elapsedMs: number;
};

export function transitionSessionToFinalStatus<TMeta extends SessionLifecycleMeta>(
  sessions: Map<string, TMeta>,
  sessionFinishedAt: Map<string, number>,
  sessionId: string,
  status: string,
  opts?: { exitCode?: number; finishedAt?: number },
): SessionTransitionResult<TMeta> | undefined {
  const previous = sessions.get(sessionId);
  if (!previous || previous.status !== 'running') {
    return undefined;
  }

  const finishedAt = opts?.finishedAt ?? Date.now();
  const updated = {
    ...previous,
    status,
    finishedAt,
    ...(Object.prototype.hasOwnProperty.call(opts ?? {}, 'exitCode')
      ? { exitCode: opts?.exitCode }
      : {}),
  } as TMeta;

  sessions.set(sessionId, updated);
  sessionFinishedAt.set(sessionId, finishedAt);

  return {
    previous,
    updated,
    finishedAt,
    elapsedMs: finishedAt - previous.startedAt,
  };
}
