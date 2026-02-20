// ============================================================
// API Token 生成与管理工具
// 格式：cam_<48字符随机hex>，存储 SHA-256 哈希
// ============================================================

import crypto from 'crypto';

const TOKEN_PREFIX = 'cam_';
const TOKEN_RANDOM_BYTES = 24; // 生成 48 字符 hex

/** 生成新 API Token，返回原始 token 和哈希 */
export function generateApiToken(): {
  /** 原始 token（仅此一次可见） */
  rawToken: string;
  /** SHA-256 哈希（存入数据库） */
  tokenHash: string;
  /** 可显示的前缀（如 cam_abcd...） */
  tokenPrefix: string;
} {
  const random = crypto.randomBytes(TOKEN_RANDOM_BYTES).toString('hex');
  const rawToken = `${TOKEN_PREFIX}${random}`;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  // 前缀取前 12 字符（cam_ + 8字符）
  const tokenPrefix = rawToken.slice(0, 12) + '...';

  return { rawToken, tokenHash, tokenPrefix };
}

/** 计算 token 的 SHA-256 哈希（用于查找） */
export function hashApiToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/** 检查字符串是否为 CAM API Token 格式 */
export function isCamApiToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX) && value.length === TOKEN_PREFIX.length + TOKEN_RANDOM_BYTES * 2;
}
