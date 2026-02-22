// ============================================================
// WebSocket 认证
// 从 HTTP upgrade 请求的 Cookie 中提取认证信息
// 复用现有 Session 认证 + RBAC 权限检查
// ============================================================

import type { IncomingMessage } from 'http';
import { resolveSessionUser, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { hasPermission, type Role } from '@/lib/auth/permissions';
import { getConfiguredAuthToken, AUTH_COOKIE_NAME } from '@/lib/auth/constants';
import { getAuthMode } from '@/lib/auth/config';

export interface WsUser {
  id: string;
  username: string;
  role: string;
}

/** 从 Cookie 字符串中解析指定 key */
function parseCookie(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1]?.trim();
}

/** 认证 WebSocket upgrade 请求，返回用户信息或 null */
export async function authenticateWs(req: IncomingMessage): Promise<WsUser | null> {
  const cookieHeader = req.headers.cookie || '';
  const authMode = await getAuthMode();

  // 0. 显式匿名模式（CAM_ALLOW_ANONYMOUS_ACCESS=true）→ 注入虚拟 admin
  if (authMode === 'none') {
    return { id: '__anonymous__', username: 'anonymous', role: 'admin' };
  }

  // 1. Session Cookie（用户系统模式）
  if (authMode === 'user_system') {
    const sessionToken = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
    if (sessionToken) {
      const user = await resolveSessionUser(sessionToken);
      if (user && user.status !== 'disabled') {
        return { id: user.id, username: user.username, role: user.role };
      }
    }
  }

  // 2. Legacy Cookie（兼容旧模式）
  if (authMode === 'legacy_token') {
    const cookieToken = parseCookie(cookieHeader, AUTH_COOKIE_NAME);
    const configuredToken = getConfiguredAuthToken();
    if (configuredToken && cookieToken === configuredToken) {
      return { id: '__legacy__', username: 'legacy-admin', role: 'admin' };
    }
  }

  return null;
}

/** 检查用户是否有终端访问权限 */
export function canAccessTerminal(user: WsUser): boolean {
  return hasPermission(user.role as Role, 'terminal:access');
}
