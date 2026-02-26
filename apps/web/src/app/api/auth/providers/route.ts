// ============================================================
// API: /api/auth/providers
// GET — 返回已启用的 OAuth 提供商列表
// ============================================================

import { getEnabledProviders } from '@/lib/auth/oauth/providers';
import { apiSuccess } from '@/lib/http/api-response';

export async function GET() {
  const providers = getEnabledProviders().map((p) => ({
    id: p.id,
    displayName: p.displayName,
  }));

  return apiSuccess(providers);
}
