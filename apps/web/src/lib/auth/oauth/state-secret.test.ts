import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getOAuthStateSecretOrThrow,
  isOAuthStateSecretConfigured,
  resolveOAuthStateSecret,
} from './state-secret.ts';

test('resolveOAuthStateSecret: 优先 CAM_OAUTH_STATE_SECRET', () => {
  assert.equal(resolveOAuthStateSecret('oauth-secret'), 'oauth-secret');
});

test('resolveOAuthStateSecret: 缺失返回 null', () => {
  assert.equal(resolveOAuthStateSecret(undefined), null);
});

test('isOAuthStateSecretConfigured / getOAuthStateSecretOrThrow: 基于环境变量判断', () => {
  const oauthKey = 'CAM_OAUTH_STATE_SECRET';
  const oauthBackup = process.env[oauthKey];

  try {
    delete process.env[oauthKey];
    assert.equal(isOAuthStateSecretConfigured(), false);
    assert.throws(() => getOAuthStateSecretOrThrow(), /CAM_OAUTH_STATE_SECRET/);

    process.env[oauthKey] = 'oauth-secret';
    assert.equal(isOAuthStateSecretConfigured(), true);
    assert.equal(getOAuthStateSecretOrThrow(), 'oauth-secret');
  } finally {
    if (oauthBackup === undefined) {
      delete process.env[oauthKey];
    } else {
      process.env[oauthKey] = oauthBackup;
    }
  }
});
