import { rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { apiBadRequest, apiError, apiInternalError, apiInvalidJson, apiSuccess } from '@/lib/http/api-response';
import { tryReadJsonBody } from '@/lib/http/read-json';
import { sanitizeTerminalEntryName } from '@/lib/terminal/file-name';
import { isAllowedRootPath, isPathWithinAllowedRoots, resolveTerminalPath } from '@/lib/terminal/path-access';

type RenamePayload = {
  path?: string;
  newName?: string;
};

async function handlePost(request: AuthenticatedRequest) {
  const parsed = await tryReadJsonBody<RenamePayload>(request);
  if (!parsed.ok) {
    return apiInvalidJson();
  }

  const sourceRaw = typeof parsed.value.path === 'string' ? parsed.value.path.trim() : '';
  if (!sourceRaw) {
    return apiBadRequest('path 不能为空');
  }
  const safeNewName = sanitizeTerminalEntryName(typeof parsed.value.newName === 'string' ? parsed.value.newName : '');
  if (!safeNewName) {
    return apiBadRequest('newName 非法');
  }

  const sourcePath = resolveTerminalPath(sourceRaw);
  if (!isPathWithinAllowedRoots(sourcePath)) {
    return apiError('PATH_NOT_ALLOWED', '源路径不在允许访问范围内', { status: 403 });
  }
  if (isAllowedRootPath(sourcePath)) {
    return apiBadRequest('允许根目录受保护，不能重命名');
  }

  let sourceStat: Awaited<ReturnType<typeof stat>>;
  try {
    sourceStat = await stat(sourcePath);
  } catch {
    return apiError('NOT_FOUND', '源路径不存在或无权访问', { status: 404 });
  }

  const targetPath = join(dirname(sourcePath), safeNewName);
  if (!isPathWithinAllowedRoots(targetPath)) {
    return apiError('PATH_NOT_ALLOWED', '目标路径不在允许访问范围内', { status: 403 });
  }
  if (isAllowedRootPath(targetPath)) {
    return apiBadRequest('目标路径受保护，不能覆盖允许根目录');
  }
  if (targetPath === sourcePath) {
    return apiSuccess({ path: sourcePath, unchanged: true });
  }

  try {
    await rename(sourcePath, targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return apiError('NOT_FOUND', '源路径不存在', { status: 404 });
    }
    if (code === 'EEXIST') {
      return apiError('ALREADY_EXISTS', '目标路径已存在', { status: 409 });
    }
    console.error('[API] 重命名路径失败:', err);
    return apiInternalError('重命名失败');
  }

  return apiSuccess({
    path: targetPath,
    isDirectory: sourceStat.isDirectory(),
  });
}

export const POST = withAuth(handlePost, 'terminal:access');

