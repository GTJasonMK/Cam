// ============================================================
// API: /api/auth/providers
// GET — 返回已启用的 OAuth 提供商列表
// ============================================================

import { NextResponse } from 'next/server';
import { getEnabledProviders } from '@/lib/auth/oauth/providers';

export async function GET() {
  const providers = getEnabledProviders().map((p) => ({
    id: p.id,
    displayName: p.displayName,
  }));

  return NextResponse.json({ success: true, data: providers });
}
