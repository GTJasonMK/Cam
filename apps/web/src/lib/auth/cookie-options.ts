// ============================================================
// 认证 Cookie 选项
// 统一 Session / Legacy / OAuth State 的 Cookie 安全策略
// ============================================================

type AuthCookieOptionsInput = {
  maxAge?: number;
};

function parseBooleanEnv(raw: string | undefined): boolean | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return null;
}

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

