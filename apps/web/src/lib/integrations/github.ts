// ============================================================
// GitHub 集成：Pull Request 创建/查询
// 目标：将 CAM 任务的产出（分支）转为可审阅的 PR 链接
// ============================================================

export type GitHubRepoRef = {
  owner: string;
  repo: string;
};

export function parseGitHubRepo(repoUrl: string): GitHubRepoRef | null {
  const input = (repoUrl || '').trim();
  if (!input) return null;

  // SSH: git@github.com:owner/repo.git
  const sshMatch = input.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    const owner = sshMatch[1];
    const repo = sshMatch[2];
    return owner && repo ? { owner, repo } : null;
  }

  // URL: https://github.com/owner/repo(.git) / ssh://git@github.com/owner/repo(.git)
  if (!input.includes('://')) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return null;

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!owner || !repo) return null;

  return { owner, repo };
}

export function parseGitHubPullRequestUrl(prUrl: string): { owner: string; repo: string; number: number } | null {
  const input = (prUrl || '').trim();
  if (!input) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return null;

  const parts = url.pathname.split('/').filter(Boolean);
  // /{owner}/{repo}/pull/{number}
  if (parts.length < 4) return null;
  if (parts[2] !== 'pull') return null;

  const number = Number(parts[3]);
  if (!Number.isFinite(number) || number <= 0) return null;

  return { owner: parts[0], repo: parts[1], number };
}

type GitHubPullRequestApi = {
  number: number;
  html_url: string;
  url: string;
  state: string;
  draft?: boolean;
};

async function githubRequest<T>(
  token: string,
  path: string,
  options?: RequestInit
): Promise<{ status: number; ok: boolean; data: T; headers: Headers }> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'coding-agents-manager',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  const text = await res.text();
  const data = (text ? JSON.parse(text) : null) as T;
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

type GitHubIssueCommentApi = {
  id: number;
  html_url: string;
};

type GitHubMergeApi = {
  merged: boolean;
  message: string;
  sha?: string;
};

export async function createOrFindGitHubPullRequest(input: {
  token: string;
  owner: string;
  repo: string;
  headBranch: string;
  baseBranch: string;
  title: string;
  body?: string;
}): Promise<{ number: number; htmlUrl: string; apiUrl: string }> {
  const head = `${input.owner}:${input.headBranch}`;

  // 1) 尝试创建 PR
  const create = await githubRequest<GitHubPullRequestApi | { message?: string }>(
    input.token,
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        head,
        base: input.baseBranch,
        body: input.body || '',
        draft: false,
      }),
    }
  );

  if (create.ok) {
    const pr = create.data as GitHubPullRequestApi;
    return { number: pr.number, htmlUrl: pr.html_url, apiUrl: pr.url };
  }

  // 2) 422 通常表示：PR 已存在 / base/head 无效
  if (create.status === 422) {
    const list = await githubRequest<GitHubPullRequestApi[]>(
      input.token,
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls?head=${encodeURIComponent(
        head
      )}&state=all&per_page=1`,
      { method: 'GET' }
    );

    if (list.ok && Array.isArray(list.data) && list.data.length > 0) {
      const pr = list.data[0];
      return { number: pr.number, htmlUrl: pr.html_url, apiUrl: pr.url };
    }
  }

  const message = (create.data as { message?: string } | null)?.message || 'Unknown GitHub API error';
  throw new Error(`GitHub PR create failed (${create.status}): ${message}`);
}

export async function createGitHubPullRequestComment(input: {
  token: string;
  owner: string;
  repo: string;
  pullNumber: number;
  body: string;
}): Promise<{ htmlUrl: string }> {
  const res = await githubRequest<GitHubIssueCommentApi | { message?: string }>(
    input.token,
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.pullNumber}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({ body: input.body }),
    }
  );

  if (!res.ok) {
    const message = (res.data as { message?: string } | null)?.message || 'Unknown GitHub API error';
    throw new Error(`GitHub comment failed (${res.status}): ${message}`);
  }

  const data = res.data as GitHubIssueCommentApi;
  return { htmlUrl: data.html_url };
}

export async function mergeGitHubPullRequest(input: {
  token: string;
  owner: string;
  repo: string;
  pullNumber: number;
  mergeMethod?: 'merge' | 'squash' | 'rebase';
  commitTitle?: string;
  commitMessage?: string;
}): Promise<{ merged: boolean; message: string; sha?: string }> {
  const res = await githubRequest<GitHubMergeApi | { message?: string }>(
    input.token,
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.pullNumber}/merge`,
    {
      method: 'PUT',
      body: JSON.stringify({
        merge_method: input.mergeMethod || 'squash',
        commit_title: input.commitTitle,
        commit_message: input.commitMessage,
      }),
    }
  );

  if (!res.ok) {
    const message = (res.data as { message?: string } | null)?.message || 'Unknown GitHub API error';
    throw new Error(`GitHub merge failed (${res.status}): ${message}`);
  }

  const data = res.data as GitHubMergeApi;
  return { merged: Boolean(data.merged), message: data.message, sha: data.sha };
}
