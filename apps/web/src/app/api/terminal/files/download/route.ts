// ============================================================
// 文件下载 API
// GET /api/terminal/files/download?path=...
// 流式响应，Content-Length 必填（前端依赖它计算进度百分比）
// ============================================================

import { stat, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server.js';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { normalizeHostPathInput } from '@/lib/terminal/path-normalize';
import { apiBadRequest, apiError } from '@/lib/http/api-response';

/** 常见 MIME 类型映射 */
const MIME_MAP: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.jsx': 'text/javascript',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/plain',
  '.csv': 'text/csv',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.sh': 'text/x-shellscript',
  '.py': 'text/x-python',
  '.rs': 'text/x-rust',
  '.go': 'text/x-go',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.log': 'text/plain',
  '.env': 'text/plain',
  '.sql': 'application/sql',
  '.wasm': 'application/wasm',
};

function getMimeType(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] || 'application/octet-stream';
}

async function handleGet(request: AuthenticatedRequest) {
  const { searchParams } = new URL(request.url);
  const rawPath = searchParams.get('path');

  if (!rawPath) {
    return apiBadRequest('缺少 path 查询参数');
  }

  const filePath = resolve(normalizeHostPathInput(rawPath));

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
  const mimeType = getMimeType(ext);

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
