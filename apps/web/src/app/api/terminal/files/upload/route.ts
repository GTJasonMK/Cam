// ============================================================
// 文件上传 API
// POST /api/terminal/files/upload
// multipart/form-data: targetDir (string) + file (File)
// ============================================================

import { writeFile, access, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { normalizeHostPathInput } from '@/lib/terminal/path-normalize';
import { apiSuccess, apiBadRequest, apiError } from '@/lib/http/api-response';

/** 100MB 上传大小上限 */
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;

async function handlePost(request: AuthenticatedRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return apiBadRequest('无法解析 multipart/form-data 请求体');
  }

  const rawTargetDir = formData.get('targetDir');
  if (typeof rawTargetDir !== 'string' || !rawTargetDir.trim()) {
    return apiBadRequest('缺少 targetDir 字段');
  }

  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return apiBadRequest('缺少 file 字段');
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return apiBadRequest(`文件大小超过上限（${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)}MB）`);
  }

  // 规范化并验证目标目录
  const targetDir = resolve(normalizeHostPathInput(rawTargetDir));

  try {
    await access(targetDir);
  } catch {
    // 目标目录不存在时自动创建
    try {
      await mkdir(targetDir, { recursive: true });
    } catch {
      return apiError('TARGET_DIR_ERROR', '目标目录不存在且无法创建', { status: 400 });
    }
  }

  // 写入文件
  const targetPath = join(targetDir, file.name);
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(targetPath, buffer);
  } catch (err) {
    return apiError('WRITE_ERROR', `写入文件失败: ${(err as Error).message}`, { status: 500 });
  }

  return apiSuccess({
    path: targetPath,
    name: file.name,
    size: file.size,
  });
}

export const POST = withAuth(handlePost, 'terminal:access');
