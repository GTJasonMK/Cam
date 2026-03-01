import { rename, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { apiBadRequest, apiError, apiInternalError, apiInvalidJson, apiSuccess } from '@/lib/http/api-response';
import { tryReadJsonBody } from '@/lib/http/read-json';
import { isAllowedRootPath, isPathWithinAllowedRoots, resolveTerminalPath } from '@/lib/terminal/path-access';

type MovePayload = {
  path?: string;
  targetDir?: string;
};

async function handlePost(request: AuthenticatedRequest) {
  const parsed = await tryReadJsonBody<MovePayload>(request);
  if (!parsed.ok) {
    return apiInvalidJson();
  }

  const sourceRaw = typeof parsed.value.path === 'string' ? parsed.value.path.trim() : '';
  if (!sourceRaw) {
    return apiBadRequest('path 不能为空');
  }
  const targetDirRaw = typeof parsed.value.targetDir === 'string' ? parsed.value.targetDir.trim() : '';
  if (!targetDirRaw) {
    return apiBadRequest('targetDir 不能为空');
  }

  const sourcePath = resolveTerminalPath(sourceRaw);
  const targetDirPath = resolveTerminalPath(targetDirRaw);
  if (!isPathWithinAllowedRoots(sourcePath)) {
    return apiError('PATH_NOT_ALLOWED', '源路径不在允许访问范围内', { status: 403 });
  }
  if (!isPathWithinAllowedRoots(targetDirPath)) {
    return apiError('PATH_NOT_ALLOWED', '目标目录不在允许访问范围内', { status: 403 });
  }
  if (isAllowedRootPath(sourcePath)) {
    return apiBadRequest('允许根目录受保护，不能移动');
  }

  try {
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile() && !sourceStat.isDirectory()) {
      return apiBadRequest('仅支持移动文件或目录');
    }
  } catch {
    return apiError('NOT_FOUND', '源路径不存在或无权访问', { status: 404 });
  }

  let targetDirStat: Awaited<ReturnType<typeof stat>>;
  try {
    targetDirStat = await stat(targetDirPath);
  } catch {
    return apiError('NOT_FOUND', '目标目录不存在或无权访问', { status: 404 });
  }
  if (!targetDirStat.isDirectory()) {
    return apiBadRequest('targetDir 不是目录');
  }

  const targetPath = join(targetDirPath, basename(sourcePath));
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
      return apiError('NOT_FOUND', '源路径或目标目录不存在', { status: 404 });
    }
    if (code === 'EEXIST') {
      return apiError('ALREADY_EXISTS', '目标路径已存在', { status: 409 });
    }
    console.error('[API] 移动路径失败:', err);
    return apiInternalError('移动失败');
  }

  return apiSuccess({
    path: targetPath,
  });
}

export const POST = withAuth(handlePost, 'terminal:access');

