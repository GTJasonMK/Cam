// ============================================================
// 认证 Cookie 选项
// 统一 Session / Legacy / OAuth State 的 Cookie 安全策略
// ============================================================

import { parseBooleanEnv } from './env-boolean';

type AuthCookieOptionsInput = {
  maxAge?: number;
};

export function resolveAuthCookieSecure(): boolean {
  const envValue = parseBooleanEnv(process.env.CAM_COOKIE_SECURE);
  if (envValue !== null) return envValue;
  return process.env.NODE_ENV === 'production';
}

/** 统一认证 Cookie 配置，支持通过环境变量覆写 secure/domain */
export function buildAuthCookieOptions(input?: AuthCookieOptionsInput) {
  const options: {
    httpOnly: true;
    sameSite: 'lax';
    secure: boolean;
    path: '/';
    maxAge?: number;
    domain?: string;
  } = {
    httpOnly: true,
    sameSite: 'lax',
    secure: resolveAuthCookieSecure(),
    path: '/',
  };

  if (typeof input?.maxAge === 'number') {
    options.maxAge = input.maxAge;
  }

  const domain = process.env.CAM_COOKIE_DOMAIN?.trim();
  if (domain) {
    options.domain = domain;
  }

  return options;
}
