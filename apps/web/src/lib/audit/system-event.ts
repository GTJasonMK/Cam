import { db } from '@/lib/db';
import { systemEvents } from '@/lib/db/schema';

export type SystemEventInput = {
  type: string;
  payload: Record<string, unknown>;
  actor?: string | null;
};

export function buildSystemEventValues(input: SystemEventInput): typeof systemEvents.$inferInsert {
  return {
    type: input.type,
    ...(input.actor ? { actor: input.actor } : {}),
    payload: input.payload,
  };
}

export async function writeSystemEvent(input: SystemEventInput): Promise<void> {
  await db.insert(systemEvents).values(buildSystemEventValues(input));
}
