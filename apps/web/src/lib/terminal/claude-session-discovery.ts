// ============================================================
// Claude Code 会话发现
// 扫描 ~/.claude/projects/{encoded-path}/ 目录
// 发现已有的 Claude Code 会话（UUID.jsonl 文件）
// ============================================================

import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** UUID 正则（v4 格式：8-4-4-4-12） */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 大文件阈值（字节）
 * 超过此大小的 JSONL 文件几乎一定包含真实对话，无需逐行验证
 */
const LARGE_FILE_THRESHOLD = 102400; // 100 KB

/** Claude Code 会话摘要 */
export interface ClaudeSessionSummary {
  /** 会话 ID（UUID，文件名去 .jsonl） */
  sessionId: string;
  /** 最后修改时间（ISO 时间戳，对应文件 mtime） */
  lastModified: string;
  /** 文件大小（字节，粗略反映对话长度） */
  sizeBytes: number;
}

/**
 * 将绝对路径编码为 Claude Code 项目目录名
 * 规则（与 Claude Code CLI 一致）：
 *   驱动器分隔符 `:\` 或 `:/` → `--`（冒号+紧随的斜杠 整体替换）
 *   其余路径分隔符 `/` 或 `\` → `-`
 *
 * 示例：E:\Code\Cam → E--Code-Cam
 *       /home/user/project → -home-user-project
 */
export function encodeProjectPath(absPath: string): string {
  return absPath
    .replace(/:[\\\/]/g, '--')   // 驱动器分隔符（含斜杠）整体 → --
    .replace(/[\\\/]/g, '-');    // 其余路径分隔符 → -
}

/**
 * 获取 Claude Code 项目会话目录路径
 * ~/.claude/projects/{encoded-path}/
 */
function getProjectSessionDir(repoPath: string): string {
  const encoded = encodeProjectPath(repoPath);
  return join(homedir(), '.claude', 'projects', encoded);
}

/**
 * 检查 JSONL 文件是否为可恢复的真实对话会话
 *
 * Claude Code 会在项目目录下生成多种 UUID.jsonl 文件，
 * 其中大部分只是 file-history-snapshot（文件快照），不包含对话内容。
 * 只有包含 "type":"user" 消息的文件才是真正的可恢复会话。
 *
 * 策略：
 *   - 空文件 → 不可恢复
 *   - 大文件（>100KB）→ 几乎一定是真实会话，直接通过
 *   - 小文件 → 读取全部内容检查是否包含 user 消息
 */
async function isResumableSession(filePath: string, sizeBytes: number): Promise<boolean> {
  if (sizeBytes === 0) return false;
  if (sizeBytes > LARGE_FILE_THRESHOLD) return true;

  try {
    const content = await readFile(filePath, 'utf-8');
    // 字符串搜索比逐行 JSON.parse 更快，且两种格式（有无空格）都覆盖
    return content.includes('"type":"user"') || content.includes('"type": "user"');
  } catch {
    return false;
  }
}

/**
 * 扫描指定项目路径下的 Claude Code 已有会话
 *
 * 只返回文件名为 UUID 格式、且包含真实对话内容的 .jsonl 文件
 * 按最后修改时间降序排列（最近的在前）
 */
export async function discoverClaudeSessions(
  repoPath: string,
): Promise<ClaudeSessionSummary[]> {
  const dir = getProjectSessionDir(repoPath);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // 目录不存在或无权读取
    return [];
  }

  // 筛选 UUID 格式的 .jsonl 文件名
  const uuidEntries = entries.filter((entry) => {
    if (!entry.endsWith('.jsonl')) return false;
    const name = entry.slice(0, -6);
    return UUID_RE.test(name);
  });

  // 并行 stat + 验证所有候选文件
  const results = await Promise.all(
    uuidEntries.map(async (entry) => {
      const name = entry.slice(0, -6);
      const filePath = join(dir, entry);
      try {
        const fileStat = await stat(filePath);
        // 过滤非真实会话（快照文件、空文件等）
        if (!await isResumableSession(filePath, fileStat.size)) return null;
        return {
          sessionId: name,
          lastModified: fileStat.mtime.toISOString(),
          sizeBytes: fileStat.size,
        };
      } catch {
        return null;
      }
    }),
  );

  const sessions = results.filter((s): s is ClaudeSessionSummary => s !== null);

  // 按最后修改时间降序排列
  sessions.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

  return sessions;
}
