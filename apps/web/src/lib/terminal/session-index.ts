export function linkTaskSessionIndex(
  taskSessionIndex: Map<string, string>,
  taskId: string,
  sessionId: string,
): void {
  taskSessionIndex.set(taskId, sessionId);
}

export function unlinkTaskSessionIndexIfMatched(
  taskSessionIndex: Map<string, string>,
  taskId: string,
  sessionId: string,
): boolean {
  if (taskSessionIndex.get(taskId) !== sessionId) {
    return false;
  }
  taskSessionIndex.delete(taskId);
  return true;
}

export function resolveSessionMetaByTaskId<TMeta extends { taskId?: string; sessionId: string }>(
  taskSessionIndex: Map<string, string>,
  sessions: Map<string, TMeta>,
  taskId: string,
): TMeta | undefined {
  const indexedSessionId = taskSessionIndex.get(taskId);
  if (indexedSessionId) {
    const indexedMeta = sessions.get(indexedSessionId);
    if (indexedMeta?.taskId === taskId) {
      return indexedMeta;
    }
    taskSessionIndex.delete(taskId);
  }

  for (const meta of sessions.values()) {
    if (meta.taskId !== taskId) continue;
    taskSessionIndex.set(taskId, meta.sessionId);
    return meta;
  }
  return undefined;
}
