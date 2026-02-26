import type { GitProvider } from './provider';

export type GitTokenScope = {
  repositoryId?: string | null;
  repoUrl?: string | null;
  agentDefinitionId?: string | null;
};

export type ScopedTokenResolver = (name: string, scope: GitTokenScope) => Promise<string | null>;

const GIT_PROVIDER_TOKEN_ENV_CANDIDATES: Record<GitProvider, string[]> = {
  github: ['GITHUB_TOKEN', 'GITHUB_PAT', 'GITHUB_API_TOKEN', 'GIT_HTTP_TOKEN', 'CAM_GIT_HTTP_TOKEN'],
  gitlab: ['GITLAB_TOKEN', 'GITLAB_PRIVATE_TOKEN', 'GITLAB_API_TOKEN', 'GIT_HTTP_TOKEN', 'CAM_GIT_HTTP_TOKEN'],
  gitea: ['GITEA_TOKEN', 'GITEA_API_TOKEN', 'GIT_HTTP_TOKEN', 'CAM_GIT_HTTP_TOKEN'],
};

async function resolveScopedValueFromSecrets(name: string, scope: GitTokenScope): Promise<string | null> {
  const mod = await import('../secrets/resolve.ts');
  return mod.resolveEnvVarValue(name, scope);
}

export async function resolveGitProviderToken(
  provider: GitProvider,
  scope: GitTokenScope,
  options?: {
    resolveScopedValue?: ScopedTokenResolver;
  },
): Promise<string> {
  const resolveScopedValue = options?.resolveScopedValue || resolveScopedValueFromSecrets;

  for (const envName of GIT_PROVIDER_TOKEN_ENV_CANDIDATES[provider]) {
    const scoped = await resolveScopedValue(envName, scope);
    if (scoped) return scoped;

    const raw = process.env[envName];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  }

  return '';
}
