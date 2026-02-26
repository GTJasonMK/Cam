import test from 'node:test';
import assert from 'node:assert/strict';
import { isEnvVarPresent, normalizeOptionalString, normalizeTrimmedString } from './strings.ts';

test('normalizeOptionalString: 非空字符串返回 trim 结果', () => {
  assert.equal(normalizeOptionalString('  abc  '), 'abc');
});

test('normalizeOptionalString: 空串与非字符串返回 null', () => {
  assert.equal(normalizeOptionalString('   '), null);
  assert.equal(normalizeOptionalString(1), null);
  assert.equal(normalizeOptionalString(undefined), null);
});

test('normalizeTrimmedString: 字符串返回 trim，非字符串返回空串', () => {
  assert.equal(normalizeTrimmedString('  xyz  '), 'xyz');
  assert.equal(normalizeTrimmedString(null), '');
  assert.equal(normalizeTrimmedString({}), '');
});

test('isEnvVarPresent: 仅非空环境变量返回 true', () => {
  const key = 'CAM_TEST_ENV_VAR_PRESENT';
  const original = process.env[key];
  try {
    process.env[key] = '  abc  ';
    assert.equal(isEnvVarPresent(key), true);

    process.env[key] = '   ';
    assert.equal(isEnvVarPresent(key), false);

    delete process.env[key];
    assert.equal(isEnvVarPresent(key), false);
  } finally {
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});
