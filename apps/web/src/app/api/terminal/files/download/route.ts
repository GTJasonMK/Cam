// ============================================================
// 文件下载 API
// GET /api/terminal/files/download?path=...
// 流式响应，Content-Length 必填（前端依赖它计算进度百分比）
// ============================================================

import { stat, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server.js';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { getMimeTypeByExtension } from '@/lib/terminal/file-types';
import { isPathWithinAllowedRoots, resolveTerminalPath } from '@/lib/terminal/path-access';
import { apiBadRequest, apiError } from '@/lib/http/api-response';

async function handleGet(request: AuthenticatedRequest) {
  const { searchParams } = new URL(request.url);
  const rawPath = searchParams.get('path');

  if (!rawPath) {
    return apiBadRequest('缺少 path 查询参数');
  }

  const filePath = resolveTerminalPath(rawPath);
  if (!isPathWithinAllowedRoots(filePath)) {
    return apiError('PATH_NOT_ALLOWED', '文件路径不在允许访问范围内', { status: 403 });
  }

  // 验证文件存在
  try {
    await access(filePath);
  } catch {
    return apiError('NOT_FOUND', '文件不存在或无权访问', { status: 404 });
  }

  // 获取文件信息
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(filePath);
  } catch {
    return apiError('STAT_ERROR', '无法读取文件信息', { status: 500 });
  }

  if (!fileStat.isFile()) {
    return apiBadRequest('指定路径不是文件');
  }

  const fileName = basename(filePath);
  const ext = extname(filePath);
  const mimeType = getMimeTypeByExtension(ext);

  // 创建可读流并转换为 Web ReadableStream
  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(fileStat.size),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'Cache-Control': 'no-cache',
    },
  });
}

export const GET = withAuth(handleGet, 'terminal:access');
