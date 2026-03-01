import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { terminalSessionPoolLeases } from '../db/schema.ts';
import { isLeaseExpired } from './session-pool-lease.ts';

type DbMethods = {
  insert: (...args: unknown[]) => {
    values: (...args: unknown[]) => {
      onConflictDoNothing: (...args: unknown[]) => {
        returning: (...args: unknown[]) => Promise<Array<{ id: string }>>;
      };
    };
  };
  select: (...args: unknown[]) => {
    from: (...args: unknown[]) => {
      where: (...args: unknown[]) => {
        limit: (count: number) => Promise<Array<{ updatedAt: string }>>;
      };
    };
  };
  delete: (...args: unknown[]) => {
    where: (...args: unknown[]) => {
      returning: (...args: unknown[]) => Promise<Array<{ id: string }>>;
    };
  };
};

interface CreateDbLeaseInput {
  userId: string;
  sessionKey: string;
  leaseToken: string;
  nowIso: string;
  nowMs: number;
  staleMs: number;
}

async function insertManagedSessionDbLeaseOnce(db: DbMethods, input: CreateDbLeaseInput): Promise<boolean> {
  const inserted = await db
    .insert(terminalSessionPoolLeases)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      sessionKey: input.sessionKey,
      leaseToken: input.leaseToken,
      sessionId: null,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
    })
    .onConflictDoNothing({
      target: [terminalSessionPoolLeases.userId, terminalSessionPoolLeases.sessionKey],
    })
    .returning({ id: terminalSessionPoolLeases.id });
  return inserted.length > 0;
}

export async function tryReclaimStaleManagedSessionDbLease(
  db: unknown,
  input: Omit<CreateDbLeaseInput, 'leaseToken' | 'nowIso'>,
): Promise<boolean> {
  const dbMethods = db as DbMethods;
  const rows = await dbMethods
    .select({ updatedAt: terminalSessionPoolLeases.updatedAt })
    .from(terminalSessionPoolLeases)
    .where(
      and(
        eq(terminalSessionPoolLeases.userId, input.userId),
        eq(terminalSessionPoolLeases.sessionKey, input.sessionKey),
      ),
    )
    .limit(1);

  const current = rows[0];
  if (!current) return false;
  if (!isLeaseExpired(current.updatedAt, input.nowMs, input.staleMs)) {
    return false;
  }

  const deleted = await dbMethods
    .delete(terminalSessionPoolLeases)
    .where(
      and(
        eq(terminalSessionPoolLeases.userId, input.userId),
        eq(terminalSessionPoolLeases.sessionKey, input.sessionKey),
        eq(terminalSessionPoolLeases.updatedAt, current.updatedAt),
      ),
    )
    .returning({ id: terminalSessionPoolLeases.id });
  return deleted.length > 0;
}

export async function createManagedSessionDbLeaseWithReclaim(
  db: unknown,
  input: CreateDbLeaseInput,
): Promise<boolean> {
  const dbMethods = db as DbMethods;
  if (await insertManagedSessionDbLeaseOnce(dbMethods, input)) {
    return true;
  }

  const reclaimed = await tryReclaimStaleManagedSessionDbLease(dbMethods, {
    userId: input.userId,
    sessionKey: input.sessionKey,
    nowMs: input.nowMs,
    staleMs: input.staleMs,
  });
  if (!reclaimed) return false;

  return insertManagedSessionDbLeaseOnce(dbMethods, input);
}
