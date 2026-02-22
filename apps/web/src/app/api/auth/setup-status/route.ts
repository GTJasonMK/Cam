// ============================================================
// API: /api/auth/setup-status
// GET — 返回系统初始化状态（是否有用户、是否有 Legacy Token、OAuth 提供商）
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { getConfiguredAuthToken } from '@/lib/auth/constants';
import { getEnabledProviders } from '@/lib/auth/oauth/providers';
import { getAuthMode } from '@/lib/auth/config';

export async function GET() {
  try {
    const result = db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .get();

    const hasUsers = (result?.count ?? 0) > 0;
    const hasLegacyToken = Boolean(getConfiguredAuthToken());
    const authMode = await getAuthMode();
    const oauthProviders = getEnabledProviders().map((p) => ({
      id: p.id,
      displayName: p.displayName,
    }));

    return NextResponse.json({
      success: true,
      data: {
        hasUsers,
        hasLegacyToken,
        authMode,
        oauthProviders,
      },
    });
  } catch (err) {
    console.error('[API] 获取 setup-status 失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '获取系统状态失败' } },
      { status: 500 }
    );
  }
}
