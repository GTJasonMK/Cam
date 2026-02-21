import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOAuthState, verifyOAuthState } from './flow.ts';

test('verifyOAuthState: 对合法 state 返回 true', () => {
  const state = generateOAuthState('github');
  assert.equal(verifyOAuthState(state, 'github'), true);
});

test('verifyOAuthState: provider 不匹配返回 false', () => {
  const state = generateOAuthState('github');
  assert.equal(verifyOAuthState(state, 'gitlab'), false);
});

test('verifyOAuthState: 非法 hmac 长度不会抛异常且返回 false', () => {
  const malformed = 'github:abc:def:1';
  assert.doesNotThrow(() => verifyOAuthState(malformed, 'github'));
  assert.equal(verifyOAuthState(malformed, 'github'), false);
});
