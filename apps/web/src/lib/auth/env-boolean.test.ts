import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBooleanEnv } from './env-boolean.ts';

test('parseBooleanEnv: 识别 true 值', () => {
  assert.equal(parseBooleanEnv('true'), true);
  assert.equal(parseBooleanEnv('1'), true);
  assert.equal(parseBooleanEnv('yes'), true);
  assert.equal(parseBooleanEnv('on'), true);
});

test('parseBooleanEnv: 识别 false 值', () => {
  assert.equal(parseBooleanEnv('false'), false);
  assert.equal(parseBooleanEnv('0'), false);
  assert.equal(parseBooleanEnv('no'), false);
  assert.equal(parseBooleanEnv('off'), false);
});

test('parseBooleanEnv: 空值与未知值返回 null', () => {
  assert.equal(parseBooleanEnv(undefined), null);
  assert.equal(parseBooleanEnv(''), null);
  assert.equal(parseBooleanEnv('  '), null);
  assert.equal(parseBooleanEnv('maybe'), null);
});

