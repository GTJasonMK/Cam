// ============================================================
// API 路由认证包装器
// withAuth(handler, permission?) 自动解析用户并检查权限
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestUser, type RequestUser } from './resolve-request-user';
import { hasPermission, type Permission, type Role } from './permissions';
import { getAuthMode } from './config';
import { GATEWAY_MESSAGES } from '@/lib/i18n/messages';

export type AuthenticatedRequest = NextRequest & {
  user: RequestUser;
};

type RouteContext<P extends Record<string, string> = Record<string, string>> = {
  params: Promise<P>;
};

type HandlerFn<P extends Record<string, string> = Record<string, string>> = (
  request: NextRequest,
  context: RouteContext<P>
) => Promise<NextResponse> | NextResponse;

type AuthenticatedHandlerFn<P extends Record<string, string> = Record<string, string>> = (
  request: AuthenticatedRequest,
  context: RouteContext<P>
) => Promise<NextResponse> | NextResponse;

function buildUnauthorizedResponse() {
  return NextResponse.json(
    { success: false, error: { code: 'UNAUTHORIZED', message: GATEWAY_MESSAGES.unauthorized } },
    { status: 401 }
  );
}

function buildForbiddenResponse(permission: Permission) {
  return NextResponse.json(
    { success: false, error: { code: 'FORBIDDEN', message: `缺少权限: ${permission}` } },
    { status: 403 }
  );
}

/**
 * 认证 + 权限检查包装器
 *
 * @param handler - 实际处理函数，request.user 已注入
 * @param permission - 可选，需要的权限
 */
export function withAuth<P extends Record<string, string> = Record<string, string>>(
  handler: AuthenticatedHandlerFn<P>,
  permission?: Permission
): HandlerFn<P> {
  return async (request, context) => {
    const authMode = await getAuthMode();

    // 无认证模式直接通过，注入虚拟 admin
    if (authMode === 'none') {
      const virtualUser: RequestUser = {
        id: '__anonymous__',
        username: 'anonymous',
        displayName: 'Anonymous',
        email: null,
        role: 'admin',
        status: 'active',
        avatarUrl: null,
        authSource: 'legacy_token',
      };
      (request as AuthenticatedRequest).user = virtualUser;
      return handler(request as AuthenticatedRequest, context as RouteContext<P>);
    }

    const user = await resolveRequestUser(request);
    if (!user) {
      return buildUnauthorizedResponse();
    }

    // 权限检查
    if (permission && !hasPermission(user.role as Role, permission)) {
      return buildForbiddenResponse(permission);
    }

    (request as AuthenticatedRequest).user = user;
    return handler(request as AuthenticatedRequest, context as RouteContext<P>);
  };
}
