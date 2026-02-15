// ============================================================
// 认证常量与基础工具
// ============================================================

export const AUTH_COOKIE_NAME = 'cam_auth_token';
export const AUTH_TOKEN_ENV = 'CAM_AUTH_TOKEN';

/** 读取配置的认证 Token（空字符串会视为未配置） */
export function getConfiguredAuthToken(): string | null {
  const token = process.env.CAM_AUTH_TOKEN;
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 当前是否启用了认证 */
export function isAuthEnabled(): boolean {
  return Boolean(getConfiguredAuthToken());
}
