// ============================================================
// Git 操作封装
// ============================================================

import simpleGit, { type SimpleGit } from 'simple-git';
import path from 'path';
import fs from 'fs';

function getEnvValue(env: Record<string, string> | undefined, name: string): string {
  const v = env?.[name];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : '';
}

function getGitHubToken(env?: Record<string, string>): string {
  return (
    getEnvValue(env, 'GITHUB_TOKEN') ||
    getEnvValue(env, 'GITHUB_PAT') ||
    getEnvValue(env, 'GITHUB_API_TOKEN') ||
    getEnvValue(env, 'GIT_HTTP_TOKEN') ||
    getEnvValue(env, 'CAM_GIT_HTTP_TOKEN') ||
    process.env.GITHUB_TOKEN ||
    process.env.GITHUB_PAT ||
    process.env.GITHUB_API_TOKEN ||
    process.env.GIT_HTTP_TOKEN ||
    process.env.CAM_GIT_HTTP_TOKEN ||
    ''
  );
}

function redactSecrets(input: string, env?: Record<string, string>): string {
  let out = input || '';

  // 1) Redact any basic auth / token in HTTP URLs: protocol://user:pass@host/...
  out = out.replace(/(https?:\/\/)([^@\s/:]+):([^@\s]+)@/gi, '$1***:***@');

  // 2) Redact GitHub x-access-token pattern specifically
  out = out.replace(/(https?:\/\/x-access-token:)([^@\s]+)(@github\.com\/)/gi, '$1***$3');

  // 3) Redact the raw token value if present (best-effort)
  const token = getGitHubToken(env);
  if (token) {
    out = out.split(token).join('***');
  }

  return out;
}

function sanitizeRepoUrlForDisplay(repoUrl: string): string {
  const input = (repoUrl || '').trim();
  if (!input) return input;
  if (!input.includes('://')) return input;

  try {
    const url = new URL(input);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return input;
  }
}

function parseGitHubRepo(repoUrl: string): { owner: string; repo: string } | null {
  const input = (repoUrl || '').trim();
  if (!input) return null;

  // SSH: git@github.com:owner/repo.git
  const sshMatch = input.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  // HTTPS: https://github.com/owner/repo(.git)
  if (!input.includes('://')) return null;

  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') };
  } catch {
    return null;
  }
}

function getGitUrlForGitHubRepo(repoUrl: string, env?: Record<string, string>): { cloneUrl: string; displayUrl: string } {
  const parsed = parseGitHubRepo(repoUrl);
  if (!parsed) return { cloneUrl: repoUrl, displayUrl: sanitizeRepoUrlForDisplay(repoUrl) };

  const httpsUrl = `https://github.com/${parsed.owner}/${parsed.repo}.git`;
  const token = getGitHubToken(env);
  if (!token) return { cloneUrl: httpsUrl, displayUrl: httpsUrl };

  // CI 常用：x-access-token 作为用户名
  const cloneUrl = `https://x-access-token:${token}@github.com/${parsed.owner}/${parsed.repo}.git`;
  const displayUrl = `github.com/${parsed.owner}/${parsed.repo}.git`;
  return { cloneUrl, displayUrl };
}

/** 克隆仓库到指定目录 */
export async function cloneRepo(
  repoUrl: string,
  targetDir: string,
  branch: string,
  env?: Record<string, string>
): Promise<void> {
  // 确保目标目录存在
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const { cloneUrl, displayUrl } = getGitUrlForGitHubRepo(repoUrl, env);
  console.log(`[Git] 克隆仓库: ${displayUrl} -> ${targetDir} (branch: ${branch})`);
  const git = simpleGit();
  try {
    await git.clone(cloneUrl, targetDir, ['--branch', branch, '--single-branch']);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(redactSecrets(message, env));
  }
  console.log('[Git] 克隆完成');
}

/** 创建工作分支 */
export async function createBranch(dir: string, branchName: string): Promise<void> {
  const git = simpleGit(dir);
  console.log(`[Git] 创建分支: ${branchName}`);
  await git.checkoutLocalBranch(branchName);
}

async function getLocalGitConfigValue(git: SimpleGit, key: string): Promise<string> {
  try {
    const result = await git.getConfig(key, 'local');
    return (result.value || '').trim();
  } catch {
    return '';
  }
}

/** 确保 git commit 所需的身份信息存在（容器内常见缺失 user.name / user.email） */
async function ensureGitIdentity(git: SimpleGit, env?: Record<string, string>): Promise<void> {
  const existingName = await getLocalGitConfigValue(git, 'user.name');
  const existingEmail = await getLocalGitConfigValue(git, 'user.email');

  const defaultName =
    getEnvValue(env, 'GIT_AUTHOR_NAME') ||
    getEnvValue(env, 'GIT_COMMITTER_NAME') ||
    getEnvValue(env, 'GIT_USER_NAME') ||
    getEnvValue(env, 'CAM_GIT_USER_NAME') ||
    process.env.GIT_AUTHOR_NAME ||
    process.env.GIT_COMMITTER_NAME ||
    process.env.GIT_USER_NAME ||
    process.env.CAM_GIT_USER_NAME ||
    'CAM Worker';

  const defaultEmail =
    getEnvValue(env, 'GIT_AUTHOR_EMAIL') ||
    getEnvValue(env, 'GIT_COMMITTER_EMAIL') ||
    getEnvValue(env, 'GIT_USER_EMAIL') ||
    getEnvValue(env, 'CAM_GIT_USER_EMAIL') ||
    process.env.GIT_AUTHOR_EMAIL ||
    process.env.GIT_COMMITTER_EMAIL ||
    process.env.GIT_USER_EMAIL ||
    process.env.CAM_GIT_USER_EMAIL ||
    'cam-worker@localhost';

  if (!existingName) {
    await git.addConfig('user.name', defaultName, false, 'local');
  }
  if (!existingEmail) {
    await git.addConfig('user.email', defaultEmail, false, 'local');
  }
}

/** 提交并推送代码 */
export async function commitAndPush(
  dir: string,
  branchName: string,
  message: string,
  env?: Record<string, string>
): Promise<void> {
  const git = simpleGit(dir);

  // 检查是否有变更
  const status = await git.status();
  if (status.files.length === 0) {
    console.log('[Git] 没有文件变更，跳过提交');
    return;
  }

  console.log(`[Git] 提交 ${status.files.length} 个文件变更`);
  await ensureGitIdentity(git, env);
  await git.add('-A');
  await git.commit(message);

  // 确保 GitHub 私有仓库 push 可用（remote 使用 token HTTPS）
  try {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    const originUrl = origin?.refs.fetch || origin?.refs.push || '';
    const parsed = parseGitHubRepo(originUrl);
    const token = getGitHubToken(env);
    if (parsed && token && !originUrl.includes('x-access-token:')) {
      const authUrl = `https://x-access-token:${token}@github.com/${parsed.owner}/${parsed.repo}.git`;
      await git.remote(['set-url', 'origin', authUrl]);
    }
  } catch {
    // 忽略 remote 校验失败
  }

  try {
    await git.push('origin', branchName, ['--set-upstream']);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(redactSecrets(message, env));
  }
  console.log(`[Git] 推送到 origin/${branchName} 完成`);
}

/** 检查仓库中是否有新的提交（Agent 是否做了修改）*/
export async function hasNewCommits(dir: string, baseBranch: string): Promise<boolean> {
  const git = simpleGit(dir);
  const log = await git.log({ from: `origin/${baseBranch}`, to: 'HEAD' });
  return log.total > 0;
}
