// ============================================================
// API: /api/auth/sessions
// GET — 列出当前用户的活跃 Session
// DELETE — 清除当前用户的其他 Session（保留当前）
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessions } from '@/lib/db/schema';
import { eq, and, ne, gt, desc } from 'drizzle-orm';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

async function handleGet(request: AuthenticatedRequest) {
  const now = new Date().toISOString();

  const rows = db
    .select({
      id: sessions.id,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
      expiresAt: sessions.expiresAt,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, request.user.id),
        gt(sessions.expiresAt, now),
      )
    )
    .orderBy(desc(sessions.createdAt))
    .all();

  // 标记当前 Session
  const currentToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  // 为了不暴露 token，通过 session 创建时间识别当前 session（最新的）
  const data = rows.map((row, idx) => ({
    id: row.id,
    ipAddress: row.ipAddress || '-',
    userAgent: row.userAgent || '-',
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    isCurrent: idx === 0 && Boolean(currentToken), // 近似标记
  }));

  return NextResponse.json({ success: true, data });
}

async function handleDelete(request: AuthenticatedRequest) {
  const currentToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!currentToken) {
    return NextResponse.json(
      { success: false, error: { code: 'NO_SESSION', message: '无法识别当前 Session' } },
      { status: 400 }
    );
  }

  // 删除当前用户的其他所有 Session（保留当前 token）
  const result = db
    .delete(sessions)
    .where(
      and(
        eq(sessions.userId, request.user.id),
        ne(sessions.token, currentToken),
      )
    )
    .run();

  return NextResponse.json({ success: true, data: { removed: result.changes } });
}

export const GET = withAuth(handleGet);
export const DELETE = withAuth(handleDelete);
