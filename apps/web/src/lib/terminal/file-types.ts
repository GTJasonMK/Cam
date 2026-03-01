// ============================================================
// 文件类型与 MIME 映射（终端文件管理复用）
// ============================================================

export type FileCategory = 'code' | 'text' | 'image' | 'archive' | 'data' | 'config' | 'unknown';

const FILE_CATEGORY_BY_EXTENSION: Record<string, FileCategory> = {
  // 代码
  '.ts': 'code', '.tsx': 'code', '.js': 'code', '.jsx': 'code', '.mjs': 'code',
  '.py': 'code', '.rs': 'code', '.go': 'code', '.java': 'code', '.c': 'code',
  '.cpp': 'code', '.h': 'code', '.cs': 'code', '.rb': 'code', '.php': 'code',
  '.swift': 'code', '.kt': 'code', '.scala': 'code', '.sh': 'code', '.bat': 'code',
  '.vue': 'code', '.svelte': 'code', '.html': 'code', '.css': 'code', '.scss': 'code',
  '.less': 'code', '.sql': 'code', '.wasm': 'code',
  // 文本
  '.txt': 'text', '.md': 'text', '.log': 'text', '.csv': 'text', '.rtf': 'text',
  // 图片
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image',
  '.webp': 'image', '.svg': 'image', '.ico': 'image', '.bmp': 'image',
  // 压缩
  '.zip': 'archive', '.gz': 'archive', '.tar': 'archive', '.7z': 'archive',
  '.rar': 'archive', '.bz2': 'archive', '.xz': 'archive',
  // 数据
  '.json': 'data', '.xml': 'data', '.yaml': 'data', '.yml': 'data',
  '.toml': 'data', '.ini': 'data', '.env': 'data', '.properties': 'data',
  // 配置
  '.gitignore': 'config', '.eslintrc': 'config', '.prettierrc': 'config',
  '.editorconfig': 'config', '.npmrc': 'config',
};

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
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

function normalizeExtension(ext: string): string {
  const normalized = (ext || '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.startsWith('.') ? normalized : `.${normalized}`;
}

export function getFileCategoryByExtension(ext: string): FileCategory {
  return FILE_CATEGORY_BY_EXTENSION[normalizeExtension(ext)] || 'unknown';
}

export function getMimeTypeByExtension(ext: string): string {
  return MIME_TYPE_BY_EXTENSION[normalizeExtension(ext)] || 'application/octet-stream';
}

