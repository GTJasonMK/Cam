// ============================================================
// 多 Git Provider 集成层
// 统一封装 GitHub / GitLab / Gitea 的 PR/MR 创建、评论、合并能力
// ============================================================

import {
  createGitHubPullRequestComment,
  createOrFindGitHubPullRequest,
  mergeGitHubPullRequest,
  parseGitHubPullRequestUrl,
  parseGitHubRepo,
} from './github.ts';

export type GitProvider = 'github' | 'gitlab' | 'gitea';

export type GitRepositoryRef = {
  provider: GitProvider;
  host: string;
  owner: string;
  repo: string;
  projectPath: string;
  webBaseUrl: string;
  apiBaseUrl: string;
};

export type GitPullRef = GitRepositoryRef & {
  number: number;
};

export type CreatePullInput = {
  token: string;
  repository: GitRepositoryRef;
  headBranch: string;
  baseBranch: string;
  title: string;
  body?: string;
};

export type MergePullInput = {
  token: string;
  repository: GitRepositoryRef;
  pullNumber: number;
  mergeMethod?: 'merge' | 'squash' | 'rebase';
  commitTitle?: string;
  commitMessage?: string;
};

type PullApiResult = {
  number: number;
  htmlUrl: string;
  apiUrl?: string;
};

type PullCommentResult = {
  htmlUrl: string;
};

type PullMergeResult = {
  merged: boolean;
  message: string;
  sha?: string;
};

function getForcedProvider(): GitProvider | null {
  const raw = (process.env.CAM_GIT_PROVIDER || '').trim().toLowerCase();
  if (raw === 'github' || raw === 'gitlab' || raw === 'gitea') return raw;
  return null;
}

function detectProvider(host: string): GitProvider | null {
  const normalized = host.toLowerCase();
  if (normalized === 'github.com' || normalized === 'www.github.com') return 'github';
  if (normalized.includes('gitlab')) return 'gitlab';
  if (normalized.includes('gitea')) return 'gitea';
  return getForcedProvider();
}

function toApiBaseUrl(provider: GitProvider, webBaseUrl: string, host: string): string {
  if (provider === 'github') {
    if (host === 'github.com' || host === 'www.github.com') return 'https://api.github.com';
    // GitHub Enterprise
    return `${webBaseUrl}/api/v3`;
  }
  if (provider === 'gitlab') return `${webBaseUrl}/api/v4`;
  return `${webBaseUrl}/api/v1`;
}

function normalizeRepoPath(pathname: string): string[] {
  return pathname
    .replace(/\.git$/i, '')
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseGitRepository(repoUrl: string): GitRepositoryRef | null {
  const input = (repoUrl || '').trim();
  if (!input) return null;

  // GitHub 走既有解析，保障兼容行为
  const githubRepo = parseGitHubRepo(input);
  if (githubRepo) {
    return {
      provider: 'github',
      host: 'github.com',
      owner: githubRepo.owner,
      repo: githubRepo.repo,
      projectPath: `${githubRepo.owner}/${githubRepo.repo}`,
      webBaseUrl: 'https://github.com',
      apiBaseUrl: 'https://api.github.com',
    };
  }

  let host = '';
  let path = '';
  let protocol = 'https:';

  const sshMatch = input.match(/^git@([^:]+):(.+)$/i);
  if (sshMatch) {
    host = sshMatch[1].toLowerCase();
    path = sshMatch[2];
  } else if (input.includes('://')) {
    try {
      const url = new URL(input);
      host = url.hostname.toLowerCase();
      path = url.pathname;
      protocol = url.protocol || 'https:';
    } catch {
      return null;
    }
  } else {
    return null;
  }

  const provider = detectProvider(host);
  if (!provider) return null;

  const parts = normalizeRepoPath(path);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = parts[parts.length - 1];
  const projectPath = `${parts.slice(0, -1).join('/')}/${repo}`;
  const webBaseUrl = `${protocol}//${host}`;
  const apiBaseUrl = toApiBaseUrl(provider, webBaseUrl, host);

  return {
    provider,
    host,
    owner,
    repo,
    projectPath,
    webBaseUrl,
    apiBaseUrl,
  };
}

export function parsePullRequestUrl(pullUrl: string): GitPullRef | null {
  const input = (pullUrl || '').trim();
  if (!input) return null;

  const gh = parseGitHubPullRequestUrl(input);
  if (gh) {
    return {
      provider: 'github',
      host: 'github.com',
      owner: gh.owner,
      repo: gh.repo,
      projectPath: `${gh.owner}/${gh.repo}`,
      number: gh.number,
      webBaseUrl: 'https://github.com',
      apiBaseUrl: 'https://api.github.com',
    };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const parts = normalizeRepoPath(url.pathname);
  if (parts.length < 3) return null;

  const mergeIdx = parts.indexOf('merge_requests');
  if (mergeIdx >= 2 && mergeIdx + 1 < parts.length) {
    const projectParts = parts.slice(0, mergeIdx).filter((p) => p !== '-');
    if (projectParts.length < 2) return null;
    const number = Number(parts[mergeIdx + 1]);
    if (!Number.isFinite(number) || number <= 0) return null;

    const provider = detectProvider(host) || 'gitlab';
    const repo = projectParts[projectParts.length - 1];
    const owner = projectParts[0];
    const projectPath = projectParts.join('/');
    const webBaseUrl = `${url.protocol}//${host}`;

    return {
      provider,
      host,
      owner,
      repo,
      projectPath,
      number,
      webBaseUrl,
      apiBaseUrl: toApiBaseUrl(provider, webBaseUrl, host),
    };
  }

  const pullsIdx = parts.indexOf('pulls');
  if (pullsIdx >= 2 && pullsIdx + 1 < parts.length) {
    const repoParts = parts.slice(0, pullsIdx);
    if (repoParts.length < 2) return null;

    const number = Number(parts[pullsIdx + 1]);
    if (!Number.isFinite(number) || number <= 0) return null;

    const provider = detectProvider(host) || 'gitea';
    const repo = repoParts[repoParts.length - 1];
    const owner = repoParts[0];
    const projectPath = `${repoParts.slice(0, -1).join('/')}/${repo}`;
    const webBaseUrl = `${url.protocol}//${host}`;

    return {
      provider,
      host,
      owner,
      repo,
      projectPath,
      number,
      webBaseUrl,
      apiBaseUrl: toApiBaseUrl(provider, webBaseUrl, host),
    };
  }

  return null;
}

function toErrorMessage(data: unknown): string {
  if (!data) return 'Unknown API error';
  if (typeof data === 'string') return data;
  if (typeof data !== 'object') return String(data);

  const obj = data as Record<string, unknown>;
  if (typeof obj.message === 'string') return obj.message;
  if (Array.isArray(obj.message)) return obj.message.map(String).join('; ');
  if (typeof obj.error === 'string') return obj.error;
  if (Array.isArray(obj.error)) return obj.error.map(String).join('; ');
  return JSON.stringify(obj);
}

async function requestJson<T>(
  url: string,
  headers: Record<string, string>,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...(init?.headers || {}),
    },
  });

  const text = await res.text();
  const data = (text ? JSON.parse(text) : null) as T;
  return {
    ok: res.ok,
    status: res.status,
    data,
  };
}

async function createOrFindGitLabMergeRequest(input: CreatePullInput): Promise<PullApiResult> {
  const projectId = encodeURIComponent(input.repository.projectPath);
  const headers = { 'PRIVATE-TOKEN': input.token };
  const create = await requestJson<Record<string, unknown>>(
    `${input.repository.apiBaseUrl}/projects/${projectId}/merge_requests`,
    headers,
    {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        source_branch: input.headBranch,
        target_branch: input.baseBranch,
        description: input.body || '',
      }),
    }
  );

  if (create.ok) {
    return {
      number: Number(create.data.iid),
      htmlUrl: String(create.data.web_url || ''),
      apiUrl: String(create.data.url || ''),
    };
  }

  if (create.status === 400 || create.status === 409 || create.status === 422) {
    const list = await requestJson<Array<Record<string, unknown>>>(
      `${input.repository.apiBaseUrl}/projects/${projectId}/merge_requests?source_branch=${encodeURIComponent(
        input.headBranch
      )}&target_branch=${encodeURIComponent(input.baseBranch)}&state=all&per_page=1`,
      headers,
      { method: 'GET' }
    );
    if (list.ok && Array.isArray(list.data) && list.data.length > 0) {
      const mr = list.data[0];
      return {
        number: Number(mr.iid),
        htmlUrl: String(mr.web_url || ''),
        apiUrl: String(mr.url || ''),
      };
    }
  }

  throw new Error(`GitLab MR create failed (${create.status}): ${toErrorMessage(create.data)}`);
}

async function createGitLabMergeRequestComment(input: {
  token: string;
  repository: GitRepositoryRef;
  pullNumber: number;
  body: string;
}): Promise<PullCommentResult> {
  const projectId = encodeURIComponent(input.repository.projectPath);
  const res = await requestJson<Record<string, unknown>>(
    `${input.repository.apiBaseUrl}/projects/${projectId}/merge_requests/${input.pullNumber}/notes`,
    { 'PRIVATE-TOKEN': input.token },
    {
      method: 'POST',
      body: JSON.stringify({ body: input.body }),
    }
  );
  if (!res.ok) {
    throw new Error(`GitLab note failed (${res.status}): ${toErrorMessage(res.data)}`);
  }
  return { htmlUrl: String(res.data.web_url || '') };
}

async function mergeGitLabMergeRequest(input: MergePullInput): Promise<PullMergeResult> {
  const projectId = encodeURIComponent(input.repository.projectPath);
  const res = await requestJson<Record<string, unknown>>(
    `${input.repository.apiBaseUrl}/projects/${projectId}/merge_requests/${input.pullNumber}/merge`,
    { 'PRIVATE-TOKEN': input.token },
    {
      method: 'PUT',
      body: JSON.stringify({
        squash: input.mergeMethod === 'squash',
        merge_commit_message: input.commitMessage || undefined,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`GitLab merge failed (${res.status}): ${toErrorMessage(res.data)}`);
  }
  const merged = String(res.data.state || '').toLowerCase() === 'merged' || res.status === 200;
  return {
    merged,
    message: String(res.data.message || (merged ? 'Merged' : 'Merge request not merged')),
    sha: typeof res.data.merge_commit_sha === 'string' ? res.data.merge_commit_sha : undefined,
  };
}

async function createOrFindGiteaPullRequest(input: CreatePullInput): Promise<PullApiResult> {
  const repoPath = `/repos/${encodeURIComponent(input.repository.owner)}/${encodeURIComponent(input.repository.repo)}`;
  const headers = { Authorization: `token ${input.token}` };

  const create = await requestJson<Record<string, unknown>>(
    `${input.repository.apiBaseUrl}${repoPath}/pulls`,
    headers,
    {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        head: input.headBranch,
        base: input.baseBranch,
        body: input.body || '',
      }),
    }
  );

  if (create.ok) {
    return {
      number: Number(create.data.number),
      htmlUrl: String(create.data.html_url || ''),
      apiUrl: String(create.data.url || ''),
    };
  }

  if (create.status === 400 || create.status === 409 || create.status === 422) {
    const list = await requestJson<Array<Record<string, unknown>>>(
      `${input.repository.apiBaseUrl}${repoPath}/pulls?state=all&page=1&limit=50`,
      headers,
      { method: 'GET' }
    );
    if (list.ok && Array.isArray(list.data)) {
      const found = list.data.find((item) => {
        const head = (item.head || {}) as Record<string, unknown>;
        const base = (item.base || {}) as Record<string, unknown>;
        const headRef = String(head.ref || '');
        const baseRef = String(base.ref || '');
        return headRef === input.headBranch && baseRef === input.baseBranch;
      });
      if (found) {
        return {
          number: Number(found.number),
          htmlUrl: String(found.html_url || ''),
          apiUrl: String(found.url || ''),
        };
      }
    }
  }

  throw new Error(`Gitea PR create failed (${create.status}): ${toErrorMessage(create.data)}`);
}

async function createGiteaPullRequestComment(input: {
  token: string;
  repository: GitRepositoryRef;
  pullNumber: number;
  body: string;
}): Promise<PullCommentResult> {
  const repoPath = `/repos/${encodeURIComponent(input.repository.owner)}/${encodeURIComponent(input.repository.repo)}`;
  const res = await requestJson<Record<string, unknown>>(
    `${input.repository.apiBaseUrl}${repoPath}/issues/${input.pullNumber}/comments`,
    { Authorization: `token ${input.token}` },
    {
      method: 'POST',
      body: JSON.stringify({ body: input.body }),
    }
  );
  if (!res.ok) {
    throw new Error(`Gitea comment failed (${res.status}): ${toErrorMessage(res.data)}`);
  }
  return { htmlUrl: String(res.data.html_url || '') };
}

async function mergeGiteaPullRequest(input: MergePullInput): Promise<PullMergeResult> {
  const repoPath = `/repos/${encodeURIComponent(input.repository.owner)}/${encodeURIComponent(input.repository.repo)}`;
  const res = await requestJson<Record<string, unknown>>(
    `${input.repository.apiBaseUrl}${repoPath}/pulls/${input.pullNumber}/merge`,
    { Authorization: `token ${input.token}` },
    {
      method: 'POST',
      body: JSON.stringify({
        Do: input.mergeMethod || 'squash',
        merge_title_field: input.commitTitle || undefined,
        merge_message_field: input.commitMessage || undefined,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Gitea merge failed (${res.status}): ${toErrorMessage(res.data)}`);
  }
  return {
    merged: true,
    message: typeof res.data.message === 'string' ? res.data.message : 'Merged',
    sha: typeof res.data.sha === 'string' ? res.data.sha : undefined,
  };
}

export async function createOrFindPullRequest(input: CreatePullInput): Promise<PullApiResult> {
  if (input.repository.provider === 'github') {
    const result = await createOrFindGitHubPullRequest({
      token: input.token,
      owner: input.repository.owner,
      repo: input.repository.repo,
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
      title: input.title,
      body: input.body,
    });
    return { number: result.number, htmlUrl: result.htmlUrl, apiUrl: result.apiUrl };
  }

  if (input.repository.provider === 'gitlab') {
    return createOrFindGitLabMergeRequest(input);
  }

  return createOrFindGiteaPullRequest(input);
}

export async function createPullRequestComment(input: {
  token: string;
  repository: GitRepositoryRef;
  pullNumber: number;
  body: string;
}): Promise<PullCommentResult> {
  if (input.repository.provider === 'github') {
    return createGitHubPullRequestComment({
      token: input.token,
      owner: input.repository.owner,
      repo: input.repository.repo,
      pullNumber: input.pullNumber,
      body: input.body,
    });
  }

  if (input.repository.provider === 'gitlab') {
    return createGitLabMergeRequestComment(input);
  }

  return createGiteaPullRequestComment(input);
}

export async function mergePullRequest(input: MergePullInput): Promise<PullMergeResult> {
  if (input.repository.provider === 'github') {
    return mergeGitHubPullRequest({
      token: input.token,
      owner: input.repository.owner,
      repo: input.repository.repo,
      pullNumber: input.pullNumber,
      mergeMethod: input.mergeMethod,
      commitTitle: input.commitTitle,
      commitMessage: input.commitMessage,
    });
  }

  if (input.repository.provider === 'gitlab') {
    return mergeGitLabMergeRequest(input);
  }

  return mergeGiteaPullRequest(input);
}
