// ============================================================
// 认证相关环境策略
// ============================================================

import { parseBooleanEnv } from './env-boolean.ts';

/** 是否允许匿名访问（默认 false） */
export function isAnonymousAccessAllowedFromEnv(raw?: string): boolean {
  return parseBooleanEnv(raw ?? process.env.CAM_ALLOW_ANONYMOUS_ACCESS) === true;
}

/** 是否允许在 user_system 模式继续接受 Legacy CAM_AUTH_TOKEN（默认 false） */
export function isLegacyTokenAllowedInUserSystemFromEnv(raw?: string): boolean {
  return parseBooleanEnv(raw ?? process.env.CAM_ALLOW_LEGACY_TOKEN_IN_USER_SYSTEM) === true;
}
