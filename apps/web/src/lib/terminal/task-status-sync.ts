import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';

export function updateTerminalTaskStatusByExpected(input: {
  taskId: string;
  status: 'cancelled' | 'failed';
  completedAt: string;
  expectedStatus: string;
}): Promise<unknown> {
  return db.update(tasks)
    .set({ status: input.status, completedAt: input.completedAt })
    .where(and(eq(tasks.id, input.taskId), eq(tasks.status, input.expectedStatus)));
}

export function updateTerminalTaskStatusByAllowed(input: {
  taskId: string;
  status: 'cancelled' | 'failed';
  completedAt: string;
  allowedStatuses: string[];
}): Promise<unknown> {
  return db.update(tasks)
    .set({ status: input.status, completedAt: input.completedAt })
    .where(and(
      eq(tasks.id, input.taskId),
      inArray(tasks.status, input.allowedStatuses),
    ));
}
