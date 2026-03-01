import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOAuthState, verifyOAuthState } from './flow.ts';

function withStateSecret<T>(secret: string | undefined, fn: () => T): T {
  const oauthKey = 'CAM_OAUTH_STATE_SECRET';
  const oauthBackup = process.env[oauthKey];

  try {
    if (secret === undefined) {
      delete process.env[oauthKey];
    } else {
      process.env[oauthKey] = secret;
    }
    return fn();
  } finally {
    if (oauthBackup === undefined) delete process.env[oauthKey];
    else process.env[oauthKey] = oauthBackup;
  }
}

test('verifyOAuthState: 对合法 state 返回 true', () => {
  withStateSecret('unit-test-oauth-secret', () => {
    const state = generateOAuthState('github');
    assert.equal(verifyOAuthState(state, 'github'), true);
  });
});

test('verifyOAuthState: provider 不匹配返回 false', () => {
  withStateSecret('unit-test-oauth-secret', () => {
    const state = generateOAuthState('github');
    assert.equal(verifyOAuthState(state, 'gitlab'), false);
  });
});

test('verifyOAuthState: 非法 hmac 长度不会抛异常且返回 false', () => {
  withStateSecret('unit-test-oauth-secret', () => {
    const malformed = 'github:abc:def:1';
    assert.doesNotThrow(() => verifyOAuthState(malformed, 'github'));
    assert.equal(verifyOAuthState(malformed, 'github'), false);
  });
});

test('generateOAuthState: 缺少 state secret 时抛错', () => {
  withStateSecret(undefined, () => {
    assert.throws(() => generateOAuthState('github'), /CAM_OAUTH_STATE_SECRET/);
  });
});
