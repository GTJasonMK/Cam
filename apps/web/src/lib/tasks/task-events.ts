import { writeSystemEvent } from '@/lib/audit/system-event';
import { sseManager } from '@/lib/sse/manager';

type EventPayload = Record<string, unknown>;

type TaskPrEventType = 'task.pr_created' | 'task.pr_failed' | 'task.pr_skipped' | 'task.pr_merged';

async function emitTaskPrEvent(input: {
  eventType: TaskPrEventType;
  taskId: string;
  actor?: string | null;
  eventPayload?: EventPayload;
  broadcastEvent?: 'task.pr_created' | 'task.pr_failed' | 'task.pr_merged';
  broadcastPayload?: EventPayload;
}): Promise<void> {
  await writeSystemEvent({
    type: input.eventType,
    actor: input.actor,
    payload: {
      ...(input.eventPayload || {}),
      taskId: input.taskId,
    },
  });

  if (input.broadcastEvent) {
    sseManager.broadcast(input.broadcastEvent, {
      ...(input.broadcastPayload || {}),
      taskId: input.taskId,
    });
  }
}

export function broadcastTaskProgress(taskId: string, status: string): void {
  sseManager.broadcast('task.progress', { taskId, status });
}

export async function emitTaskProgress(input: {
  taskId: string;
  status: string;
  actor?: string | null;
  eventPayload?: EventPayload;
}): Promise<void> {
  broadcastTaskProgress(input.taskId, input.status);
  await writeSystemEvent({
    type: 'task.progress',
    actor: input.actor,
    payload: {
      ...(input.eventPayload || {}),
      taskId: input.taskId,
      status: input.status,
    },
  });
}

export async function emitTaskCancelled(input: {
  taskId: string;
  actor?: string | null;
  eventPayload?: EventPayload;
  cancelledBroadcastPayload?: EventPayload;
}): Promise<void> {
  await writeSystemEvent({
    type: 'task.cancelled',
    actor: input.actor,
    payload: {
      ...(input.eventPayload || {}),
      taskId: input.taskId,
    },
  });

  broadcastTaskProgress(input.taskId, 'cancelled');
  sseManager.broadcast('task.cancelled', {
    ...(input.cancelledBroadcastPayload || {}),
    taskId: input.taskId,
  });
}

export async function emitTaskRerunRequested(input: {
  taskId: string;
  actor?: string | null;
  eventPayload?: EventPayload;
  rerunBroadcastPayload?: EventPayload;
}): Promise<void> {
  await writeSystemEvent({
    type: 'task.rerun_requested',
    actor: input.actor,
    payload: {
      ...(input.eventPayload || {}),
      taskId: input.taskId,
    },
  });

  sseManager.broadcast('task.rerun_requested', {
    ...(input.rerunBroadcastPayload || {}),
    taskId: input.taskId,
  });
  broadcastTaskProgress(input.taskId, 'queued');
}

export async function emitTaskStarted(input: {
  taskId: string;
  workerId: string;
  agentDefinitionId: string;
}): Promise<void> {
  sseManager.broadcast('task.started', {
    taskId: input.taskId,
    workerId: input.workerId,
    agentDefinitionId: input.agentDefinitionId,
  });
  await writeSystemEvent({
    type: 'task.started',
    payload: {
      taskId: input.taskId,
      workerId: input.workerId,
      agentDefinitionId: input.agentDefinitionId,
    },
  });
}

export async function emitTaskPrSkipped(input: {
  taskId: string;
  actor?: string | null;
  eventPayload?: EventPayload;
}): Promise<void> {
  await emitTaskPrEvent({
    eventType: 'task.pr_skipped',
    taskId: input.taskId,
    actor: input.actor,
    eventPayload: input.eventPayload,
  });
}

export async function emitTaskPrCreated(input: {
  taskId: string;
  actor?: string | null;
  eventPayload?: EventPayload;
  broadcastPayload?: EventPayload;
}): Promise<void> {
  await emitTaskPrEvent({
    eventType: 'task.pr_created',
    taskId: input.taskId,
    actor: input.actor,
    eventPayload: input.eventPayload,
    broadcastEvent: 'task.pr_created',
    broadcastPayload: input.broadcastPayload,
  });
}

export async function emitTaskPrFailed(input: {
  taskId: string;
  actor?: string | null;
  eventPayload?: EventPayload;
  broadcastPayload?: EventPayload;
}): Promise<void> {
  await emitTaskPrEvent({
    eventType: 'task.pr_failed',
    taskId: input.taskId,
    actor: input.actor,
    eventPayload: input.eventPayload,
    broadcastEvent: 'task.pr_failed',
    broadcastPayload: input.broadcastPayload,
  });
}

export async function emitTaskPrMerged(input: {
  taskId: string;
  actor?: string | null;
  eventPayload?: EventPayload;
  broadcastPayload?: EventPayload;
}): Promise<void> {
  await emitTaskPrEvent({
    eventType: 'task.pr_merged',
    taskId: input.taskId,
    actor: input.actor,
    eventPayload: input.eventPayload,
    broadcastEvent: 'task.pr_merged',
    broadcastPayload: input.broadcastPayload,
  });
}
