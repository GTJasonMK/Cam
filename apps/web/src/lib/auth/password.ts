// ============================================================
// 密码哈希与验证（Node.js crypto.scrypt，无原生依赖）
// 格式：scrypt:N:r:p:salt_hex:hash_hex
// ============================================================

import crypto from 'crypto';

// scrypt 参数（OWASP 推荐）
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 32;

/** 对明文密码进行 scrypt 哈希，返回格式化字符串 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH);

  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });

  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** 验证明文密码是否匹配哈希值，使用 timingSafeEqual 防止时序攻击 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }

  const N = parseInt(parts[1], 10);
  const r = parseInt(parts[2], 10);
  const p = parseInt(parts[3], 10);
  const salt = Buffer.from(parts[4], 'hex');
  const expectedHash = Buffer.from(parts[5], 'hex');

  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }

  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, expectedHash.length, { N, r, p }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });

  if (derived.length !== expectedHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(derived, expectedHash);
}
