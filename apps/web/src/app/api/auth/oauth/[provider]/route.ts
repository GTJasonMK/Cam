// ============================================================
// API: /api/auth/oauth/[provider]
// GET — 重定向到 OAuth 授权页
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getProviderById } from '@/lib/auth/oauth/providers';
import { generateOAuthState, buildAuthorizeUrl } from '@/lib/auth/oauth/flow';
import { isOAuthStateSecretConfigured } from '@/lib/auth/oauth/state-secret';
import { resolvePublicOrigin } from '@/lib/auth/public-origin';
import { buildAuthCookieOptions } from '@/lib/auth/cookie-options';
import { apiError } from '@/lib/http/api-response';

type RouteContext = { params: Promise<Record<string, string>> };

export async function GET(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const providerId = params.provider;
  const provider = getProviderById(providerId);

  if (!provider) {
    return apiError('PROVIDER_NOT_FOUND', `OAuth 提供商 ${providerId} 未启用`, { status: 404 });
  }

  if (!isOAuthStateSecretConfigured()) {
    return apiError(
      'OAUTH_NOT_READY',
      'OAuth 未就绪：请配置 CAM_OAUTH_STATE_SECRET',
      { status: 503 },
    );
  }

  // 构建回调 URL
  const origin = resolvePublicOrigin(request);
  const callbackUrl = `${origin}/api/auth/oauth/${providerId}/callback`;

  // 生成 HMAC 签名的 state（防 CSRF）
  const state = generateOAuthState(providerId);

  // 构建授权 URL 并重定向
  const authorizeUrl = buildAuthorizeUrl(provider, callbackUrl, state);

  // 将 state 存入 httpOnly Cookie 供 callback 验证
  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set('cam_oauth_state', state, {
    ...buildAuthCookieOptions({ maxAge: 600 }), // 10 分钟
  });

  return response;
}
