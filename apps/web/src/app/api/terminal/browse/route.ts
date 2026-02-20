// ============================================================
// 目录浏览 + Claude Code 会话发现 REST API
// GET /api/terminal/browse?path={}&discover=true
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { readdir, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { discoverClaudeSessions, type ClaudeSessionSummary } from '@/lib/terminal/claude-session-discovery';

const IS_WINDOWS = process.platform === 'win32';

/** 目录条目 */
interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  /** 是否为 Git 仓库（包含 .git 目录） */
  isGitRepo: boolean;
  /** 是否包含 Claude 配置（CLAUDE.md 或 .claude/） */
  hasClaude: boolean;
}

/** 浏览响应 */
interface BrowseResponse {
  currentPath: string;
  parentPath: string | null;
  /** 当前目录自身是否为 Git 仓库 */
  isGitRepo: boolean;
  /** 当前目录自身是否包含 Claude 配置 */
  hasClaude: boolean;
  entries: DirectoryEntry[];
  claudeSessions: ClaudeSessionSummary[];
}

/** 检查路径是否存在 */
async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** 并行检测目录的 Git / Claude 特征 */
async function detectDirFeatures(fullPath: string): Promise<{ isGitRepo: boolean; hasClaude: boolean }> {
  const [isGitRepo, hasClaudeMd, hasClaudeDir] = await Promise.all([
    exists(join(fullPath, '.git')),
    exists(join(fullPath, 'CLAUDE.md')),
    exists(join(fullPath, '.claude')),
  ]);
  return { isGitRepo, hasClaude: hasClaudeMd || hasClaudeDir };
}

/** 获取 Windows 盘符列表（并行检测） */
async function getWindowsDrives(): Promise<DirectoryEntry[]> {
  const checks = Array.from({ length: 26 }, (_, i) => {
    const letter = String.fromCharCode(65 + i);
    const drivePath = `${letter}:\\`;
    return exists(drivePath).then((ok) =>
      ok ? { name: `${letter}:`, path: drivePath, isDirectory: true, isGitRepo: false, hasClaude: false } : null,
    );
  });
  const results = await Promise.all(checks);
  return results.filter((d): d is DirectoryEntry => d !== null);
}

/** 获取默认根目录列表 */
async function getRootEntries(): Promise<DirectoryEntry[]> {
  if (IS_WINDOWS) {
    return getWindowsDrives();
  }
  return scanDirectory('/');
}

/**
 * 扫描指定目录的子条目
 * 使用 withFileTypes 避免额外 stat 调用，并行检测 Git/Claude 特征
 */
async function scanDirectory(dirPath: string): Promise<DirectoryEntry[]> {
  let dirents: import('node:fs').Dirent[];
  try {
    dirents = await readdir(dirPath, { withFileTypes: true, encoding: 'utf-8' });
  } catch {
    return [];
  }

  // 过滤：只保留目录，排除隐藏目录（.claude 除外）
  const dirs = dirents.filter(
    (d) => d.isDirectory() && (!d.name.startsWith('.') || d.name === '.claude'),
  );

  // 并行检测所有目录的 Git/Claude 特征
  const entries = await Promise.all(
    dirs.map(async (d) => {
      const fullPath = join(dirPath, d.name);
      const features = await detectDirFeatures(fullPath);
      return {
        name: d.name,
        path: fullPath,
        isDirectory: true,
        ...features,
      };
    }),
  );

  // 按名称排序，Git 仓库和 Claude 项目优先
  entries.sort((a, b) => {
    if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
    if (a.hasClaude !== b.hasClaude) return a.hasClaude ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

async function handleGet(request: AuthenticatedRequest) {
  const { searchParams } = new URL(request.url);
  const rawPath = searchParams.get('path');
  const discover = searchParams.get('discover') === 'true';

  // 未指定路径：返回常用根目录
  if (!rawPath) {
    const entries = await getRootEntries();
    const response: BrowseResponse = {
      currentPath: IS_WINDOWS ? '' : '/',
      parentPath: null,
      isGitRepo: false,
      hasClaude: false,
      entries,
      claudeSessions: [],
    };
    return NextResponse.json({ success: true, data: response });
  }

  // 规范化路径
  const targetPath = resolve(rawPath);

  // 验证路径存在且为目录（使用 readdir 代替 stat，一次性获取子目录）
  let dirents: import('node:fs').Dirent[];
  try {
    dirents = await readdir(targetPath, { withFileTypes: true, encoding: 'utf-8' });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTDIR') {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_DIRECTORY', message: '指定路径不是目录' } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: '路径不存在或无权访问' } },
      { status: 404 },
    );
  }

  // 并行：扫描子目录 + 检测当前目录特征 + 发现 Claude 会话
  const dirs = dirents.filter(
    (d) => d.isDirectory() && (!d.name.startsWith('.') || d.name === '.claude'),
  );

  const [entries, currentFeatures, claudeSessions] = await Promise.all([
    // 并行检测所有子目录特征
    Promise.all(
      dirs.map(async (d) => {
        const fullPath = join(targetPath, d.name);
        const features = await detectDirFeatures(fullPath);
        return { name: d.name, path: fullPath, isDirectory: true, ...features };
      }),
    ),
    // 检测当前目录自身特征
    detectDirFeatures(targetPath),
    // 发现 Claude Code 会话
    discover ? discoverClaudeSessions(targetPath) : Promise.resolve([]),
  ]);

  // 排序
  entries.sort((a, b) => {
    if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
    if (a.hasClaude !== b.hasClaude) return a.hasClaude ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // 计算父目录
  const parentPath = dirname(targetPath);
  const hasParent = parentPath !== targetPath;

  const response: BrowseResponse = {
    currentPath: targetPath,
    parentPath: hasParent ? parentPath : null,
    ...currentFeatures,
    entries,
    claudeSessions,
  };

  return NextResponse.json({ success: true, data: response });
}

export const GET = withAuth(handleGet, 'task:read');
