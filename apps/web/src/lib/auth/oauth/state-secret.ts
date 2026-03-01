// ============================================================
// OAuth state 签名密钥策略
// - 仅允许 CAM_OAUTH_STATE_SECRET
// - 未配置时视为 OAuth 未就绪
// ============================================================

function normalizeEnvValue(value: string | undefined): string {
  return (value || '').trim();
}

export function resolveOAuthStateSecret(
  oauthStateSecretRaw: string | undefined = process.env.CAM_OAUTH_STATE_SECRET,
): string | null {
  const oauthStateSecret = normalizeEnvValue(oauthStateSecretRaw);
  if (oauthStateSecret) return oauthStateSecret;

  return null;
}

export function isOAuthStateSecretConfigured(): boolean {
  return resolveOAuthStateSecret() !== null;
}

export function getOAuthStateSecretOrThrow(): string {
  const secret = resolveOAuthStateSecret();
  if (secret) return secret;
  throw new Error('OAuth 未就绪：请配置 CAM_OAUTH_STATE_SECRET');
}
