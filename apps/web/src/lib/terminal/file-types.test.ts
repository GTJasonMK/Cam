import test from 'node:test';
import assert from 'node:assert/strict';
import { getFileCategoryByExtension, getMimeTypeByExtension } from './file-types.ts';

test('getFileCategoryByExtension: 识别常见扩展', () => {
  assert.equal(getFileCategoryByExtension('.ts'), 'code');
  assert.equal(getFileCategoryByExtension('md'), 'text');
  assert.equal(getFileCategoryByExtension('.png'), 'image');
  assert.equal(getFileCategoryByExtension('.zip'), 'archive');
  assert.equal(getFileCategoryByExtension('.json'), 'data');
});

test('getFileCategoryByExtension: 未知扩展回退 unknown', () => {
  assert.equal(getFileCategoryByExtension('.unknown-ext'), 'unknown');
  assert.equal(getFileCategoryByExtension(''), 'unknown');
});

test('getMimeTypeByExtension: 识别常见扩展', () => {
  assert.equal(getMimeTypeByExtension('.ts'), 'text/typescript');
  assert.equal(getMimeTypeByExtension('json'), 'application/json');
  assert.equal(getMimeTypeByExtension('.png'), 'image/png');
});

test('getMimeTypeByExtension: 未知扩展回退 octet-stream', () => {
  assert.equal(getMimeTypeByExtension('.unknown-ext'), 'application/octet-stream');
  assert.equal(getMimeTypeByExtension(''), 'application/octet-stream');
});

