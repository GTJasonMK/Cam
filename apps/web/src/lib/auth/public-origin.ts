// ============================================================
// 认证相关公共 Origin 解析
// 用于 OAuth 回调地址，在反向代理部署场景下优先走外部可访问域名
// ============================================================

import type { NextRequest } from 'next/server';

function firstToken(value: string | null): string | null {
  if (!value) return null;
  const token = value.split(',')[0]?.trim();
  return token || null;
}

function normalizeOrigin(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function resolvePublicOrigin(request: NextRequest): string {
  // 1) 显式配置优先（推荐生产环境使用）
  const fromEnv = normalizeOrigin(process.env.CAM_PUBLIC_BASE_URL);
  if (fromEnv) return fromEnv;

  // 2) 反向代理透传头
  const forwardedHost = firstToken(request.headers.get('x-forwarded-host'));
  if (forwardedHost) {
    const forwardedProtoRaw = firstToken(request.headers.get('x-forwarded-proto'));
    const forwardedProto = forwardedProtoRaw === 'https' || forwardedProtoRaw === 'http'
      ? forwardedProtoRaw
      : request.nextUrl.protocol.replace(':', '');
    return `${forwardedProto}://${forwardedHost}`;
  }

  // 3) 回退 NextRequest 原始 origin
  return request.nextUrl.origin;
}

