// ============================================================
// 终端文件系统访问边界守卫
// 默认允许目录：
// 1) process.cwd()
// 2) CAM_REPOS_DIR（若配置）
// 可通过 CAM_TERMINAL_ALLOWED_ROOTS（分号/换行分隔）覆盖追加
// ============================================================

import { isAbsolute, relative, resolve } from 'node:path';
import { normalizeHostPathInput } from './path-normalize.ts';

function normalizeAbsolutePath(input: string): string {
  return resolve(normalizeHostPathInput(input));
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const key = process.platform === 'win32' ? path.toLowerCase() : path;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

function splitAllowedRoots(raw: string): string[] {
  return raw
    .split(/[;\n]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getTerminalAllowedRoots(): string[] {
  const configuredRootsRaw = (process.env.CAM_TERMINAL_ALLOWED_ROOTS || '').trim();
  const configuredRoots = configuredRootsRaw ? splitAllowedRoots(configuredRootsRaw) : [];

  const defaultRoots = [process.cwd()];
  if (process.env.CAM_REPOS_DIR?.trim()) {
    defaultRoots.push(process.env.CAM_REPOS_DIR.trim());
  }

  const roots = [...configuredRoots, ...defaultRoots]
    .map((item) => normalizeAbsolutePath(item))
    .filter(Boolean);
  return dedupePaths(roots);
}

export function resolveTerminalPath(input: string): string {
  return normalizeAbsolutePath(input);
}

export function isPathWithinAllowedRoots(
  targetPath: string,
  allowedRoots: string[] = getTerminalAllowedRoots(),
): boolean {
  const normalizedTarget = normalizeAbsolutePath(targetPath);
  return allowedRoots.some((root) => {
    const normalizedRoot = normalizeAbsolutePath(root);
    const rel = relative(normalizedRoot, normalizedTarget);
    if (!rel) return true;
    return !rel.startsWith('..') && !isAbsolute(rel);
  });
}

export function isAllowedRootPath(
  targetPath: string,
  allowedRoots: string[] = getTerminalAllowedRoots(),
): boolean {
  const normalizedTarget = normalizeAbsolutePath(targetPath);
  return allowedRoots.some((root) => normalizeAbsolutePath(root) === normalizedTarget);
}
