// ============================================================
// OAuth 提供商配置
// 通过环境变量启用 GitHub / GitLab OAuth 登录
// ============================================================

export interface OAuthProviderConfig {
  /** 提供商标识 */
  id: 'github' | 'gitlab';
  /** 显示名称 */
  displayName: string;
  /** OAuth Client ID */
  clientId: string;
  /** OAuth Client Secret */
  clientSecret: string;
  /** 授权端点 */
  authorizeUrl: string;
  /** Token 交换端点 */
  tokenUrl: string;
  /** 用户信息端点 */
  userInfoUrl: string;
  /** 请求的权限范围 */
  scope: string;
}

/**
 * 从环境变量加载已配置的 OAuth 提供商
 * - CAM_OAUTH_GITHUB_CLIENT_ID / CAM_OAUTH_GITHUB_CLIENT_SECRET
 * - CAM_OAUTH_GITLAB_CLIENT_ID / CAM_OAUTH_GITLAB_CLIENT_SECRET / CAM_OAUTH_GITLAB_BASE_URL
 */
export function getEnabledProviders(): OAuthProviderConfig[] {
  const providers: OAuthProviderConfig[] = [];

  // GitHub
  const ghClientId = process.env.CAM_OAUTH_GITHUB_CLIENT_ID?.trim();
  const ghClientSecret = process.env.CAM_OAUTH_GITHUB_CLIENT_SECRET?.trim();
  if (ghClientId && ghClientSecret) {
    providers.push({
      id: 'github',
      displayName: 'GitHub',
      clientId: ghClientId,
      clientSecret: ghClientSecret,
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userInfoUrl: 'https://api.github.com/user',
      scope: 'read:user user:email',
    });
  }

  // GitLab
  const glClientId = process.env.CAM_OAUTH_GITLAB_CLIENT_ID?.trim();
  const glClientSecret = process.env.CAM_OAUTH_GITLAB_CLIENT_SECRET?.trim();
  if (glClientId && glClientSecret) {
    const baseUrl = (process.env.CAM_OAUTH_GITLAB_BASE_URL?.trim() || 'https://gitlab.com').replace(/\/$/, '');
    providers.push({
      id: 'gitlab',
      displayName: 'GitLab',
      clientId: glClientId,
      clientSecret: glClientSecret,
      authorizeUrl: `${baseUrl}/oauth/authorize`,
      tokenUrl: `${baseUrl}/oauth/token`,
      userInfoUrl: `${baseUrl}/api/v4/user`,
      scope: 'read_user',
    });
  }

  return providers;
}

/** 根据 ID 查找已启用的提供商 */
export function getProviderById(id: string): OAuthProviderConfig | null {
  return getEnabledProviders().find((p) => p.id === id) ?? null;
}

/** 检查是否有任何 OAuth 提供商已启用 */
export function hasOAuthProviders(): boolean {
  return getEnabledProviders().length > 0;
}
