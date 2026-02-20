// ============================================================
// OAuth 流程：授权 URL 构建、code 换 token、用户信息获取
// ============================================================

import crypto from 'crypto';
import type { OAuthProviderConfig } from './providers';

// State 签名密钥：优先使用 CAM_OAUTH_STATE_SECRET，回退到 CAM_AUTH_TOKEN
function getStateSecret(): string {
  const secret = process.env.CAM_OAUTH_STATE_SECRET?.trim()
    || process.env.CAM_AUTH_TOKEN?.trim()
    || 'cam-oauth-state-default-key';
  return secret;
}

const STATE_TTL_MS = 10 * 60 * 1000; // state 有效期 10 分钟

/** OAuth 标准化用户信息 */
export interface OAuthUserInfo {
  providerAccountId: string;
  username: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
}

// ---- State 管理（HMAC 签名，防 CSRF） ----

/**
 * 生成 HMAC 签名的 OAuth state 参数
 * 格式：`timestamp:random:hmac`
 */
export function generateOAuthState(provider: string): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(16).toString('hex');
  const payload = `${provider}:${timestamp}:${random}`;
  const hmac = crypto.createHmac('sha256', getStateSecret())
    .update(payload)
    .digest('hex')
    .slice(0, 32);
  return `${payload}:${hmac}`;
}

/** 验证 state 签名和有效期 */
export function verifyOAuthState(state: string, expectedProvider: string): boolean {
  const parts = state.split(':');
  if (parts.length !== 4) return false;

  const [provider, timestamp, random, hmac] = parts;
  if (provider !== expectedProvider) return false;

  // 验证 HMAC
  const payload = `${provider}:${timestamp}:${random}`;
  const expectedHmac = crypto.createHmac('sha256', getStateSecret())
    .update(payload)
    .digest('hex')
    .slice(0, 32);

  if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) {
    return false;
  }

  // 验证时效
  const ts = parseInt(timestamp, 36);
  if (isNaN(ts) || Date.now() - ts > STATE_TTL_MS) {
    return false;
  }

  return true;
}

// ---- 授权 URL ----

/** 构建 OAuth 授权重定向 URL */
export function buildAuthorizeUrl(
  provider: OAuthProviderConfig,
  callbackUrl: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: callbackUrl,
    state,
    scope: provider.scope,
  });

  // GitLab 使用 response_type=code
  if (provider.id === 'gitlab') {
    params.set('response_type', 'code');
  }

  return `${provider.authorizeUrl}?${params.toString()}`;
}

// ---- Token 交换 ----

/** 用授权码交换 access_token */
export async function exchangeCodeForToken(
  provider: OAuthProviderConfig,
  code: string,
  callbackUrl: string,
): Promise<string> {
  const body: Record<string, string> = {
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    redirect_uri: callbackUrl,
  };

  if (provider.id === 'gitlab') {
    body.grant_type = 'authorization_code';
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const res = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OAuth token 交换失败 (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const accessToken = data.access_token;

  if (!accessToken || typeof accessToken !== 'string') {
    throw new Error('OAuth token 交换响应中缺少 access_token');
  }

  return accessToken;
}

// ---- 用户信息获取 ----

/** 使用 access_token 获取 OAuth 用户信息 */
export async function fetchOAuthUserInfo(
  provider: OAuthProviderConfig,
  accessToken: string,
): Promise<OAuthUserInfo> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };

  // GitHub 需要 User-Agent
  if (provider.id === 'github') {
    headers['User-Agent'] = 'CAM-OAuth';
  }

  const res = await fetch(provider.userInfoUrl, { headers });

  if (!res.ok) {
    throw new Error(`获取 OAuth 用户信息失败 (${res.status})`);
  }

  const data = await res.json();

  if (provider.id === 'github') {
    return parseGitHubUser(data, accessToken);
  }

  if (provider.id === 'gitlab') {
    return parseGitLabUser(data);
  }

  throw new Error(`不支持的 OAuth 提供商: ${provider.id}`);
}

// ---- 提供商特定解析 ----

async function parseGitHubUser(data: Record<string, unknown>, accessToken: string): Promise<OAuthUserInfo> {
  let email = typeof data.email === 'string' ? data.email : null;

  // GitHub 可能不在主 API 返回邮箱，需要额外调用
  if (!email) {
    try {
      const emailRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'CAM-OAuth',
        },
      });
      if (emailRes.ok) {
        const emails = await emailRes.json() as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        const primary = emails.find((e) => e.primary && e.verified);
        email = primary?.email ?? emails.find((e) => e.verified)?.email ?? null;
      }
    } catch {
      // 获取邮箱失败不阻塞流程
    }
  }

  return {
    providerAccountId: String(data.id),
    username: String(data.login || ''),
    displayName: String(data.name || data.login || ''),
    email,
    avatarUrl: typeof data.avatar_url === 'string' ? data.avatar_url : null,
  };
}

function parseGitLabUser(data: Record<string, unknown>): OAuthUserInfo {
  return {
    providerAccountId: String(data.id),
    username: String(data.username || ''),
    displayName: String(data.name || data.username || ''),
    email: typeof data.email === 'string' ? data.email : null,
    avatarUrl: typeof data.avatar_url === 'string' ? data.avatar_url : null,
  };
}
