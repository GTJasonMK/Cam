// ============================================================
// Session 管理（SQLite 存储，httpOnly Cookie 传递）
// ============================================================

import crypto from 'crypto';
import { db } from '@/lib/db';
import { sessions, users } from '@/lib/db/schema';
import { eq, lt } from 'drizzle-orm';

const SESSION_TTL_HOURS = parseInt(process.env.CAM_SESSION_TTL_HOURS || '24', 10);
const TOKEN_BYTES = 32; // 生成 64 字符 hex 令牌

export const SESSION_COOKIE_NAME = 'cam_session';

/** Session Cookie 的 maxAge（秒），与数据库中过期时间保持一致 */
export function getSessionCookieMaxAgeSeconds(): number {
  const hours = Number.isFinite(SESSION_TTL_HOURS) && SESSION_TTL_HOURS > 0 ? SESSION_TTL_HOURS : 24;
  return Math.floor(hours * 3600);
}

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: string;
  status: string;
  avatarUrl: string | null;
};

/** 创建新 Session，返回不透明 token */
export async function createSession(opts: {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<string> {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 3600_000);

  db.insert(sessions)
    .values({
      userId: opts.userId,
      token,
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
      expiresAt: expiresAt.toISOString(),
    })
    .run();

  return token;
}

/** 通过 token 查找有效 Session 对应的用户 */
export async function resolveSessionUser(token: string): Promise<SessionUser | null> {
  if (!token || token.length !== TOKEN_BYTES * 2) {
    return null;
  }

  const now = new Date().toISOString();

  const row = db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
      status: users.status,
      avatarUrl: users.avatarUrl,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, token))
    .get();

  if (!row) return null;

  // Session 过期
  if (row.expiresAt < now) {
    db.delete(sessions).where(eq(sessions.token, token)).run();
    return null;
  }

  // 用户被禁用
  if (row.status === 'disabled') {
    return null;
  }

  return {
    id: row.userId,
    username: row.username,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    status: row.status,
    avatarUrl: row.avatarUrl,
  };
}

/** 吊销指定 Session */
export async function revokeSession(token: string): Promise<void> {
  db.delete(sessions).where(eq(sessions.token, token)).run();
}

/** 吊销用户的所有 Session */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

/** 清理过期 Session */
export async function cleanExpiredSessions(): Promise<number> {
  const now = new Date().toISOString();
  const result = db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
  return result.changes;
}
