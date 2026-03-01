import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagedSessionDbLeaseWithReclaim } from './session-pool-db-lease.ts';

async function createInMemoryLeaseDb(): Promise<{
  sqlite: unknown;
  db: unknown;
} | null> {
  try {
    const [{ default: Database }, { drizzle }] = await Promise.all([
      import('better-sqlite3'),
      import('drizzle-orm/better-sqlite3'),
    ]);
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE terminal_session_pool_leases (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        session_key TEXT NOT NULL,
        lease_token TEXT NOT NULL,
        session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX uniq_terminal_session_pool_leases_user_key
        ON terminal_session_pool_leases (user_id, session_key);
      CREATE UNIQUE INDEX uniq_terminal_session_pool_leases_token
        ON terminal_session_pool_leases (lease_token);
    `);
    return { sqlite, db: drizzle(sqlite) };
  } catch (err) {
    console.warn('[test] 跳过 session-pool-db-lease 集成测试: better-sqlite3 不可用', (err as Error).message);
    return null;
  }
}

test('createManagedSessionDbLeaseWithReclaim: 非过期租约冲突时返回 false', async (t) => {
  const handle = await createInMemoryLeaseDb();
  if (!handle) {
    t.skip('better-sqlite3 在当前环境不可用');
    return;
  }
  const { sqlite, db } = handle;
  const sqliteDb = sqlite as {
    prepare: (sql: string) => { run: (...args: unknown[]) => unknown; get: (...args: unknown[]) => unknown };
    close: () => void;
  };
  try {
    const userId = 'u-conflict';
    const sessionKey = 's-conflict';
    const nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    const nowIso = new Date(nowMs).toISOString();

    sqliteDb.prepare(`
      INSERT INTO terminal_session_pool_leases
        (id, user_id, session_key, lease_token, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('seed-1', userId, sessionKey, 'old-token', null, nowIso, nowIso);

    const acquired = await createManagedSessionDbLeaseWithReclaim(db, {
      userId,
      sessionKey,
      leaseToken: 'new-token',
      nowIso,
      nowMs,
      staleMs: 90_000,
    });

    assert.equal(acquired, false);

    const count = sqliteDb.prepare(`
      SELECT COUNT(*) AS c
      FROM terminal_session_pool_leases
      WHERE user_id = ? AND session_key = ?
    `).get(userId, sessionKey) as { c: number };
    assert.equal(count.c, 1);

    const token = sqliteDb.prepare(`
      SELECT lease_token
      FROM terminal_session_pool_leases
      WHERE user_id = ? AND session_key = ?
      LIMIT 1
    `).get(userId, sessionKey) as { lease_token: string };
    assert.equal(token.lease_token, 'old-token');
  } finally {
    sqliteDb.close();
  }
});

test('createManagedSessionDbLeaseWithReclaim: 过期租约回收后可重新抢租', async (t) => {
  const handle = await createInMemoryLeaseDb();
  if (!handle) {
    t.skip('better-sqlite3 在当前环境不可用');
    return;
  }
  const { sqlite, db } = handle;
  const sqliteDb = sqlite as {
    prepare: (sql: string) => { run: (...args: unknown[]) => unknown; get: (...args: unknown[]) => unknown };
    close: () => void;
  };
  try {
    const userId = 'u-reclaim';
    const sessionKey = 's-reclaim';
    const nowMs = Date.parse('2026-01-01T00:02:00.000Z');
    const nowIso = new Date(nowMs).toISOString();
    const staleIso = new Date(nowMs - 120_000).toISOString();

    sqliteDb.prepare(`
      INSERT INTO terminal_session_pool_leases
        (id, user_id, session_key, lease_token, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('seed-2', userId, sessionKey, 'expired-token', null, staleIso, staleIso);

    const acquired = await createManagedSessionDbLeaseWithReclaim(db, {
      userId,
      sessionKey,
      leaseToken: 'fresh-token',
      nowIso,
      nowMs,
      staleMs: 90_000,
    });

    assert.equal(acquired, true);

    const count = sqliteDb.prepare(`
      SELECT COUNT(*) AS c
      FROM terminal_session_pool_leases
      WHERE user_id = ? AND session_key = ?
    `).get(userId, sessionKey) as { c: number };
    assert.equal(count.c, 1);

    const row = sqliteDb.prepare(`
      SELECT lease_token, updated_at
      FROM terminal_session_pool_leases
      WHERE user_id = ? AND session_key = ?
      LIMIT 1
    `).get(userId, sessionKey) as { lease_token: string; updated_at: string };
    assert.equal(row.lease_token, 'fresh-token');
    assert.equal(row.updated_at, nowIso);
  } finally {
    sqliteDb.close();
  }
});
