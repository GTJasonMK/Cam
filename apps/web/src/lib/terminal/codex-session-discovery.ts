// ============================================================
// Codex CLI 会话发现
// 扫描 ~/.codex/sessions/ 目录
// 通过第一行 session_meta.cwd 字段匹配项目路径
// ============================================================

import { readdir, stat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { toWSLPath, IS_WINDOWS, getWSLCodexSessionsDir } from './wsl';

/** Codex 会话摘要（与 ClaudeSessionSummary 对齐） */
export interface CodexSessionSummary {
  /** 会话 ID（文件名去 .jsonl，thread_id 或 rollout ID） */
  sessionId: string;
  /** 最后修改时间（ISO 时间戳，对应文件 mtime） */
  lastModified: string;
  /** 文件大小（字节） */
  sizeBytes: number;
}

/**
 * 获取 Codex 会话目录路径
 * 支持 CODEX_HOME 环境变量覆盖，默认 ~/.codex/sessions/
 */
function getCodexSessionsDir(): string {
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  return join(codexHome, 'sessions');
}

/**
 * 从 JSONL 文件第一行提取 session_meta.cwd
 * 返回 null 表示无法解析或不含 cwd
 */
async function extractSessionCwd(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    // 只读第一行
    const firstLine = content.split('\n')[0];
    if (!firstLine) return null;
    const parsed = JSON.parse(firstLine);
    // session_meta 格式：{ type: "session_meta", cwd: "..." } 或 { session_meta: { cwd: "..." } }
    if (parsed.type === 'session_meta' && parsed.cwd) {
      return parsed.cwd;
    }
    if (parsed.session_meta?.cwd) {
      return parsed.session_meta.cwd;
    }
    // 某些版本直接在顶层放 cwd
    if (parsed.cwd) {
      return parsed.cwd;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 规范化路径用于比较（小写化 + 统一分隔符）
 * Windows 下路径不区分大小写
 */
function normalizePath(p: string): string {
  const resolved = resolve(p);
  const normalized = resolved.replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * 规范化 WSL/Linux 路径用于比较
 * Linux 路径区分大小写，仅统一尾部斜杠
 */
function normalizeWSLPath(p: string): string {
  return p.replace(/\/+$/, '');
}

/**
 * 扫描指定项目路径下的 Codex 已有会话
 *
 * Codex 会话统一存放在 ~/.codex/sessions/，
 * 通过 JSONL 第一行 session_meta.cwd 字段关联项目。
 * 按最后修改时间降序排列（最近的在前）。
 *
 * 支持两种文件命名格式：
 *   - 新格式：<thread_id>.jsonl（扁平）
 *   - 旧格式：YYYY/MM/DD/rollout-<ts>-<id>.jsonl（按日期分片）
 *
 * @param repoPath 项目路径（Windows 或 Linux 格式）
 * @param opts.runtime 运行时环境，'wsl' 时从 WSL 文件系统读取会话
 */
export async function discoverCodexSessions(
  repoPath: string,
  opts?: { runtime?: 'native' | 'wsl' },
): Promise<CodexSessionSummary[]> {
  const runtime = opts?.runtime ?? 'native';
  const useWSL = runtime === 'wsl' && IS_WINDOWS;

  // 确定会话目录
  let sessionsDir: string;
  if (useWSL) {
    const wslDir = getWSLCodexSessionsDir();
    if (!wslDir) return []; // WSL 不可用
    sessionsDir = wslDir;
  } else {
    sessionsDir = getCodexSessionsDir();
  }

  // 确定用于 CWD 匹配的目标路径
  // WSL 模式下，会话 JSONL 中的 cwd 是 Linux 路径（如 /mnt/e/Code/Cam），
  // 而前端传入的 repoPath 是 Windows 路径（如 E:\Code\Cam），需要转换
  const targetPath = useWSL
    ? normalizeWSLPath(toWSLPath(repoPath))
    : normalizePath(repoPath);

  // 路径比较函数（WSL 模式使用 Linux 路径规范化）
  const normalizeForCompare = useWSL ? normalizeWSLPath : normalizePath;

  // 收集所有 .jsonl 文件（包括子目录中的旧格式）
  const jsonlFiles = await collectJsonlFiles(sessionsDir);

  // 并行读取每个文件的 session_meta 并过滤
  const results = await Promise.all(
    jsonlFiles.map(async ({ filePath, fileName }) => {
      try {
        const fileStat = await stat(filePath);
        if (fileStat.size === 0) return null;

        const cwd = await extractSessionCwd(filePath);
        if (!cwd) return null;

        // 比较 CWD 是否匹配目标项目路径
        if (normalizeForCompare(cwd) !== targetPath) return null;

        // 从文件名提取 session ID
        const sessionId = extractSessionId(fileName);
        if (!sessionId) return null;

        return {
          sessionId,
          lastModified: fileStat.mtime.toISOString(),
          sizeBytes: fileStat.size,
        };
      } catch {
        return null;
      }
    }),
  );

  const sessions = results.filter((s): s is CodexSessionSummary => s !== null);
  sessions.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

  return sessions;
}

/**
 * 从文件名提取 session ID
 *   - 新格式 `019c24ce-590a-7e42-b2e3-efe508ee3731.jsonl` → UUID
 *   - 旧格式 `rollout-2025-01-22T10-30-00-abc123.jsonl` → 完整文件名（去 .jsonl）
 */
function extractSessionId(fileName: string): string | null {
  if (!fileName.endsWith('.jsonl')) return null;
  return fileName.slice(0, -6) || null;
}

/** 递归收集目录下所有 .jsonl 文件（最多 2 层深度） */
async function collectJsonlFiles(
  dir: string,
  depth = 0,
): Promise<Array<{ filePath: string; fileName: string }>> {
  const MAX_DEPTH = 4; // 支持 YYYY/MM/DD 子目录结构
  const files: Array<{ filePath: string; fileName: string }> = [];

  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push({ filePath: fullPath, fileName: entry.name });
    } else if (entry.isDirectory() && depth < MAX_DEPTH) {
      const subFiles = await collectJsonlFiles(fullPath, depth + 1);
      files.push(...subFiles);
    }
  }

  return files;
}
