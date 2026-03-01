/**
 * 前端路径归一化（仅用于 UI 层判断，不替代服务端安全校验）
 */
export function normalizePathForMatch(path: string): string {
  if (!path) return '';
  let normalized = path.replace(/\\/g, '/').replace(/\/+$/g, '');
  if (!normalized) return '/';
  if (/^[A-Za-z]:/.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1);
  }
  return normalized;
}

/**
 * 判断目标路径是否位于允许根目录之内（客户端预校验）
 */
export function isPathWithinAllowedRootsClient(
  targetPath: string,
  allowedRoots: string[],
): boolean {
  const target = normalizePathForMatch(targetPath);
  if (!target) return false;
  return allowedRoots.some((rootPath) => {
    const root = normalizePathForMatch(rootPath);
    if (!root) return false;
    if (root === '/') return target.startsWith('/');
    return target === root || target.startsWith(`${root}/`);
  });
}
