import { lstat, rm, rmdir, unlink } from 'node:fs/promises';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { apiBadRequest, apiError, apiInternalError, apiInvalidJson, apiSuccess } from '@/lib/http/api-response';
import { tryReadJsonBody } from '@/lib/http/read-json';
import { isAllowedRootPath, isPathWithinAllowedRoots, resolveTerminalPath } from '@/lib/terminal/path-access';

type DeletePayload = {
  path?: string;
  recursive?: boolean;
};

async function handlePost(request: AuthenticatedRequest) {
  const parsed = await tryReadJsonBody<DeletePayload>(request);
  if (!parsed.ok) {
    return apiInvalidJson();
  }

  const targetRaw = typeof parsed.value.path === 'string' ? parsed.value.path.trim() : '';
  if (!targetRaw) {
    return apiBadRequest('path 不能为空');
  }
  const recursive = parsed.value.recursive === true;

  const targetPath = resolveTerminalPath(targetRaw);
  if (!isPathWithinAllowedRoots(targetPath)) {
    return apiError('PATH_NOT_ALLOWED', '目标路径不在允许访问范围内', { status: 403 });
  }
  if (isAllowedRootPath(targetPath)) {
    return apiBadRequest('允许根目录受保护，不能删除');
  }

  let targetStat: Awaited<ReturnType<typeof lstat>>;
  try {
    targetStat = await lstat(targetPath);
  } catch {
    return apiError('NOT_FOUND', '目标路径不存在或无权访问', { status: 404 });
  }

  try {
    if (targetStat.isDirectory()) {
      if (recursive) {
        await rm(targetPath, { recursive: true, force: false });
      } else {
        await rmdir(targetPath);
      }
    } else {
      await unlink(targetPath);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTEMPTY') {
      return apiError('DIRECTORY_NOT_EMPTY', '目录非空，删除目录请传 recursive=true', { status: 409 });
    }
    if (code === 'ENOENT') {
      return apiError('NOT_FOUND', '目标路径不存在', { status: 404 });
    }
    console.error('[API] 删除路径失败:', err);
    return apiInternalError('删除失败');
  }

  return apiSuccess({
    path: targetPath,
    deleted: true,
  });
}

export const POST = withAuth(handlePost, 'terminal:access');
