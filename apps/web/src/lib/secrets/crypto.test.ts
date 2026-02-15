import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecretValue, encryptSecretValue, isMasterKeyPresent } from './crypto.ts';

const MASTER_KEY_ENV = 'CAM_MASTER_KEY';

test('crypto: round-trip 加解密', () => {
  const prev = process.env[MASTER_KEY_ENV];
  process.env[MASTER_KEY_ENV] = 'unit-test-master-key';
  try {
    const payload = encryptSecretValue('hello-secret');
    const plaintext = decryptSecretValue(payload);
    assert.equal(plaintext, 'hello-secret');
  } finally {
    if (typeof prev === 'string') process.env[MASTER_KEY_ENV] = prev;
    else delete process.env[MASTER_KEY_ENV];
  }
});

test('crypto: 未配置主密钥时报错', () => {
  const prev = process.env[MASTER_KEY_ENV];
  delete process.env[MASTER_KEY_ENV];
  try {
    assert.equal(isMasterKeyPresent(), false);
    assert.throws(() => encryptSecretValue('x'), /CAM_MASTER_KEY/);
  } finally {
    if (typeof prev === 'string') process.env[MASTER_KEY_ENV] = prev;
    else delete process.env[MASTER_KEY_ENV];
  }
});

test('crypto: 非法密文格式报错', () => {
  const prev = process.env[MASTER_KEY_ENV];
  process.env[MASTER_KEY_ENV] = 'unit-test-master-key';
  try {
    assert.throws(() => decryptSecretValue('bad-payload'), /格式不正确/);
  } finally {
    if (typeof prev === 'string') process.env[MASTER_KEY_ENV] = prev;
    else delete process.env[MASTER_KEY_ENV];
  }
});
