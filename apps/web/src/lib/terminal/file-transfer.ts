// ============================================================
// 文件传输工具函数
// 上传（XHR + 进度）、下载（fetch + 流式进度）、浏览器保存
// ============================================================

import { getFileCategoryByExtension, type FileCategory } from './file-types';

/** 进度回调参数 */
export interface TransferProgress {
  loaded: number;
  total: number;
  /** 0-100 百分比，total 未知时为 -1 */
  percent: number;
}

/** 上传结果 */
export interface UploadResult {
  path: string;
  name: string;
  size: number;
}

/** 可取消的上传句柄 */
export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort: () => void;
}

// ---- 工具函数 ----

/** 格式化文件大小为人类可读格式 */
export function formatFileSize(bytes: number): string {
  if (bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 根据文件扩展名获取分类 */
export function getFileCategory(ext: string): FileCategory {
  return getFileCategoryByExtension(ext);
}

// ---- 上传 ----

/**
 * 上传文件到服务器（XHR + 进度回调）
 * 返回可取消的句柄
 */
export function uploadFile(
  file: File,
  targetDir: string,
  onProgress?: (progress: TransferProgress) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const formData = new FormData();
  formData.append('targetDir', targetDir);
  formData.append('file', file);

  const promise = new Promise<UploadResult>((resolve, reject) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percent: Math.round((e.loaded / e.total) * 100),
        });
      }
    });

    xhr.addEventListener('load', () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && json.success) {
          resolve(json.data as UploadResult);
        } else {
          reject(new Error(json.error?.message || `上传失败 (HTTP ${xhr.status})`));
        }
      } catch {
        reject(new Error(`上传失败 (HTTP ${xhr.status})`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('网络错误')));
    xhr.addEventListener('abort', () => reject(new Error('上传已取消')));

    xhr.open('POST', '/api/terminal/files/upload');
    xhr.send(formData);
  });

  return {
    promise,
    abort: () => xhr.abort(),
  };
}

// ---- 下载 ----

/**
 * 下载文件（fetch + 流式进度）
 * 返回 Blob，可配合 triggerBrowserDownload 保存
 */
export async function downloadFile(
  filePath: string,
  onProgress?: (progress: TransferProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const url = `/api/terminal/files/download?path=${encodeURIComponent(filePath)}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    let message = `下载失败 (HTTP ${response.status})`;
    try {
      const json = await response.json();
      if (json.error?.message) message = json.error.message;
    } catch { /* 忽略解析错误 */ }
    throw new Error(message);
  }

  const contentLength = response.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  if (!response.body) {
    // 回退：无流式支持
    const blob = await response.blob();
    onProgress?.({ loaded: blob.size, total: blob.size, percent: 100 });
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({
      loaded,
      total,
      percent: total > 0 ? Math.round((loaded / total) * 100) : -1,
    });
  }

  return new Blob(chunks);
}

/** 触发浏览器文件保存对话框 */
export function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // 延迟释放以确保下载启动
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 100);
}
