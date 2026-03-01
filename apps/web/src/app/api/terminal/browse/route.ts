// ============================================================
// 目录浏览 + CLI Agent 会话发现 REST API
// GET /api/terminal/browse?path={}&agent=claude-code|codex
// agent 参数指定发现哪种 Agent 的会话
// ============================================================

import { readdir, access, stat } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { discoverClaudeSessions } from '@/lib/terminal/claude-session-discovery';
import { discoverCodexSessions } from '@/lib/terminal/codex-session-discovery';
import {
  getTerminalAllowedRoots,
  isPathWithinAllowedRoots,
  resolveTerminalPath,
} from '@/lib/terminal/path-access';
import { apiError, apiSuccess } from '@/lib/http/api-response';

/** Agent 会话摘要（统一类型，Claude / Codex 共用） */
export interface AgentSessionSummary {
  sessionId: string;
  lastModified: string;
  sizeBytes: number;
}

/** 目录条目 */
interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
  hasClaude: boolean;
  /** 是否包含 Codex 配置（AGENTS.md） */
  hasCodex: boolean;
}

/** 文件条目 */
export interface FileEntry {
  name: string;
  path: string;
  isDirectory: false;
  size: number;
  modifiedAt: string;
  extension: string;
}

/** 浏览响应 */
interface BrowseResponse {
  currentPath: string;
  parentPath: string | null;
  isGitRepo: boolean;
  hasClaude: boolean;
  hasCodex: boolean;
  entries: DirectoryEntry[];
  /** 统一的 Agent 会话列表（按 agent 参数决定发现哪种） */
  agentSessions: AgentSessionSummary[];
  /** 向后兼容：与 agentSessions 相同 */
  claudeSessions: AgentSessionSummary[];
  /** 文件列表（仅 includeFiles=true 时返回） */
  files?: FileEntry[];
  /** 文件总数（可能被截断） */
  fileCount?: number;
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

/** 并行检测目录的 Git / Claude / Codex 特征 */
async function detectDirFeatures(fullPath: string): Promise<{ isGitRepo: boolean; hasClaude: boolean; hasCodex: boolean }> {
  const [isGitRepo, hasClaudeMd, hasClaudeDir, hasAgentsMd] = await Promise.all([
    exists(join(fullPath, '.git')),
    exists(join(fullPath, 'CLAUDE.md')),
    exists(join(fullPath, '.claude')),
    exists(join(fullPath, 'AGENTS.md')),
  ]);
  return {
    isGitRepo,
    hasClaude: hasClaudeMd || hasClaudeDir,
    hasCodex: hasAgentsMd,
  };
}

function getRootLabel(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return basename(trimmed) || trimmed || path;
}

async function buildDirectoryEntry(fullPath: string, name?: string): Promise<DirectoryEntry> {
  const features = await detectDirFeatures(fullPath);
  return {
    name: name || getRootLabel(fullPath),
    path: fullPath,
    isDirectory: true,
    ...features,
  };
}

/** 返回允许访问的根目录列表，避免暴露系统盘符/系统根目录 */
async function getAllowedRootEntries(): Promise<DirectoryEntry[]> {
  const allowedRoots = getTerminalAllowedRoots();
  const roots = await Promise.all(
    allowedRoots.map(async (rootPath) => {
      const resolvedRoot = resolveTerminalPath(rootPath);
      try {
        const rootStat = await stat(resolvedRoot);
        if (!rootStat.isDirectory()) return null;
      } catch {
        return null;
      }
      return buildDirectoryEntry(resolvedRoot);
    }),
  );

  const entries = roots.filter((item): item is DirectoryEntry => item !== null);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

const MAX_FILE_ENTRIES = 500;

/**
 * 扫描指定目录中的文件条目
 * 复用已有的 dirents 结果，用 stat() 获取 size/mtime
 */
async function scanFiles(dirPath: string, dirents: import('node:fs').Dirent[]): Promise<{ files: FileEntry[]; fileCount: number }> {
  const fileDirents = dirents.filter(
    (d) => d.isFile() && !d.name.startsWith('.'),
  );
  const fileCount = fileDirents.length;
  const truncated = fileDirents.slice(0, MAX_FILE_ENTRIES);

  const files = await Promise.all(
    truncated.map(async (d) => {
      const fullPath = join(dirPath, d.name);
      try {
        const s = await stat(fullPath);
        return {
          name: d.name,
          path: fullPath,
          isDirectory: false as const,
          size: s.size,
          modifiedAt: s.mtime.toISOString(),
          extension: extname(d.name),
        };
      } catch {
        return {
          name: d.name,
          path: fullPath,
          isDirectory: false as const,
          size: 0,
          modifiedAt: '',
          extension: extname(d.name),
        };
      }
    }),
  );

  // 按名称排序
  files.sort((a, b) => a.name.localeCompare(b.name));

  return { files, fileCount };
}

/** 按 agent 类型发现会话 */
async function discoverSessions(
  targetPath: string,
  agent: string | null,
  runtime: string | null,
): Promise<AgentSessionSummary[]> {
  if (agent === 'claude-code') {
    return discoverClaudeSessions(targetPath);
  }
  if (agent === 'codex') {
    return discoverCodexSessions(targetPath, {
      runtime: runtime === 'wsl' ? 'wsl' : 'native',
    });
  }
  return [];
}

async function handleGet(request: AuthenticatedRequest) {
  const { searchParams } = new URL(request.url);
  const rawPath = searchParams.get('path');
  // agent 参数：claude-code | codex（决定发现哪种会话）
  const agent = searchParams.get('agent');
  // runtime 参数：native | wsl（影响 Codex 会话目录位置）
  const runtime = searchParams.get('runtime');
  // 向后兼容：discover=true 等价于 agent=claude-code
  const legacyDiscover = searchParams.get('discover') === 'true';
  const effectiveAgent = agent || (legacyDiscover ? 'claude-code' : null);
  // includeFiles=true 时返回文件列表
  const includeFiles = searchParams.get('includeFiles') === 'true';

  // 未指定路径：返回常用根目录
  if (!rawPath) {
    const entries = await getAllowedRootEntries();
    const response: BrowseResponse = {
      currentPath: '',
      parentPath: null,
      isGitRepo: false,
      hasClaude: false,
      hasCodex: false,
      entries,
      agentSessions: [],
      claudeSessions: [],
      ...(includeFiles ? { files: [], fileCount: 0 } : {}),
    };
    return apiSuccess(response);
  }

  // 规范化路径
  const targetPath = resolveTerminalPath(rawPath);
  if (!isPathWithinAllowedRoots(targetPath)) {
    return apiError('PATH_NOT_ALLOWED', '路径不在允许访问范围内', { status: 403 });
  }

  // 验证路径存在且为目录
  let dirents: import('node:fs').Dirent[];
  try {
    dirents = await readdir(targetPath, { withFileTypes: true, encoding: 'utf-8' });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTDIR') {
      return apiError('NOT_DIRECTORY', '指定路径不是目录', { status: 400 });
    }
    return apiError('NOT_FOUND', '路径不存在或无权访问', { status: 404 });
  }

  // 并行：扫描子目录 + 检测当前目录特征 + 发现 Agent 会话 + 扫描文件
  const dirs = dirents.filter(
    (d) => d.isDirectory() && (!d.name.startsWith('.') || d.name === '.claude'),
  );

  const [entries, currentFeatures, agentSessions, fileResult] = await Promise.all([
    Promise.all(
      dirs.map(async (d) => {
        const fullPath = join(targetPath, d.name);
        return buildDirectoryEntry(fullPath, d.name);
      }),
    ),
    detectDirFeatures(targetPath),
    discoverSessions(targetPath, effectiveAgent, runtime),
    includeFiles ? scanFiles(targetPath, dirents) : Promise.resolve(null),
  ]);

  // 排序
  entries.sort((a, b) => {
    if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
    if (a.hasClaude !== b.hasClaude) return a.hasClaude ? -1 : 1;
    if (a.hasCodex !== b.hasCodex) return a.hasCodex ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // 计算父目录
  const parentPath = dirname(targetPath);
  const hasParent = parentPath !== targetPath && isPathWithinAllowedRoots(parentPath);

  const response: BrowseResponse = {
    currentPath: targetPath,
    parentPath: hasParent ? parentPath : null,
    ...currentFeatures,
    entries,
    agentSessions,
    // 向后兼容
    claudeSessions: agentSessions,
    ...(fileResult ? { files: fileResult.files, fileCount: fileResult.fileCount } : {}),
  };

  return apiSuccess(response);
}

export const GET = withAuth(handleGet, 'terminal:access');
