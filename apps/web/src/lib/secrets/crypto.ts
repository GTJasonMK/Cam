// ============================================================
// Secrets 加解密工具（AES-256-GCM）
// 说明：
// - 需要设置 CAM_MASTER_KEY 作为主密钥（不会存入 DB）
// - DB 中仅存密文，API/UI 不返回明文
// ============================================================

import crypto from 'crypto';

const MASTER_KEY_ENV = 'CAM_MASTER_KEY';

function getMasterKey(): Buffer {
  const raw = process.env[MASTER_KEY_ENV];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`缺少 ${MASTER_KEY_ENV}，无法加解密 Secrets`);
  }
  // 将任意长度字符串稳定映射为 32 bytes key
  return crypto.createHash('sha256').update(raw).digest();
}

export function isMasterKeyPresent(): boolean {
  const raw = process.env[MASTER_KEY_ENV];
  return typeof raw === 'string' && raw.trim().length > 0;
}

/** 加密明文，输出 v1:iv:tag:ciphertext（均为 base64） */
export function encryptSecretValue(plaintext: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** 解密密文（v1:iv:tag:ciphertext） */
export function decryptSecretValue(payload: string): string {
  const key = getMasterKey();

  const parts = (payload || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Secret 密文格式不正确');
  }

  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

