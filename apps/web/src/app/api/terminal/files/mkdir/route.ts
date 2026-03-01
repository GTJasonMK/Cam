import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { apiBadRequest, apiError, apiInternalError, apiInvalidJson, apiSuccess } from '@/lib/http/api-response';
import { tryReadJsonBody } from '@/lib/http/read-json';
import { sanitizeTerminalEntryName } from '@/lib/terminal/file-name';
import { isAllowedRootPath, isPathWithinAllowedRoots, resolveTerminalPath } from '@/lib/terminal/path-access';

type MkdirPayload = {
  parentDir?: string;
  name?: string;
};

async function handlePost(request: AuthenticatedRequest) {
  const parsed = await tryReadJsonBody<MkdirPayload>(request);
  if (!parsed.ok) {
    return apiInvalidJson();
  }

  const parentDirRaw = typeof parsed.value.parentDir === 'string' ? parsed.value.parentDir.trim() : '';
  if (!parentDirRaw) {
    return apiBadRequest('parentDir 不能为空');
  }
  const safeName = sanitizeTerminalEntryName(typeof parsed.value.name === 'string' ? parsed.value.name : '');
  if (!safeName) {
    return apiBadRequest('目录名非法');
  }

  const parentDir = resolveTerminalPath(parentDirRaw);
  if (!isPathWithinAllowedRoots(parentDir)) {
    return apiError('PATH_NOT_ALLOWED', '父目录不在允许访问范围内', { status: 403 });
  }

  let parentStat: Awaited<ReturnType<typeof stat>>;
  try {
    parentStat = await stat(parentDir);
  } catch {
    return apiError('NOT_FOUND', '父目录不存在或无权访问', { status: 404 });
  }
  if (!parentStat.isDirectory()) {
    return apiBadRequest('parentDir 不是目录');
  }

  const targetPath = join(parentDir, safeName);
  if (!isPathWithinAllowedRoots(targetPath)) {
    return apiError('PATH_NOT_ALLOWED', '目标目录路径不在允许访问范围内', { status: 403 });
  }
  if (isAllowedRootPath(targetPath)) {
    return apiBadRequest('目标目录受保护，不能覆盖允许根目录');
  }

  try {
    await mkdir(targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      return apiError('ALREADY_EXISTS', '目录已存在', { status: 409 });
    }
    if (code === 'ENOENT') {
      return apiError('NOT_FOUND', '父目录不存在', { status: 404 });
    }
    console.error('[API] 创建目录失败:', err);
    return apiInternalError('创建目录失败');
  }

  return apiSuccess({
    path: targetPath,
    name: safeName,
  });
}

export const POST = withAuth(handlePost, 'terminal:access');

