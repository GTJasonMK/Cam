import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAnonymousAccessAllowedFromEnv,
  isLegacyTokenAllowedInUserSystemFromEnv,
} from './env-policy.ts';

test('isAnonymousAccessAllowedFromEnv: 识别真值', () => {
  assert.equal(isAnonymousAccessAllowedFromEnv('true'), true);
  assert.equal(isAnonymousAccessAllowedFromEnv('1'), true);
  assert.equal(isAnonymousAccessAllowedFromEnv('YES'), true);
  assert.equal(isAnonymousAccessAllowedFromEnv('on'), true);
});

test('isAnonymousAccessAllowedFromEnv: 默认与非法值返回 false', () => {
  assert.equal(isAnonymousAccessAllowedFromEnv(undefined), false);
  assert.equal(isAnonymousAccessAllowedFromEnv(''), false);
  assert.equal(isAnonymousAccessAllowedFromEnv('false'), false);
  assert.equal(isAnonymousAccessAllowedFromEnv('random'), false);
});

test('isLegacyTokenAllowedInUserSystemFromEnv: 识别真值', () => {
  assert.equal(isLegacyTokenAllowedInUserSystemFromEnv('true'), true);
  assert.equal(isLegacyTokenAllowedInUserSystemFromEnv('1'), true);
  assert.equal(isLegacyTokenAllowedInUserSystemFromEnv('yes'), true);
  assert.equal(isLegacyTokenAllowedInUserSystemFromEnv('on'), true);
});

test('isLegacyTokenAllowedInUserSystemFromEnv: 默认读取环境变量', () => {
  const key = 'CAM_ALLOW_LEGACY_TOKEN_IN_USER_SYSTEM';
  const backup = process.env[key];
  try {
    process.env[key] = 'true';
    assert.equal(isLegacyTokenAllowedInUserSystemFromEnv(), true);
    process.env[key] = 'false';
    assert.equal(isLegacyTokenAllowedInUserSystemFromEnv(), false);
  } finally {
    if (backup === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = backup;
    }
  }
});
