import test from 'node:test';
import assert from 'node:assert/strict';
import { isPathWithinAllowedRootsClient, normalizePathForMatch } from './path-access-client.ts';

test('normalizePathForMatch: 统一分隔符并处理盘符大小写', () => {
  assert.equal(normalizePathForMatch('E:\\Code\\Cam\\'), 'e:/Code/Cam');
  assert.equal(normalizePathForMatch('/opt/cam/'), '/opt/cam');
  assert.equal(normalizePathForMatch('/'), '/');
});

test('isPathWithinAllowedRootsClient: 命中根目录和子路径', () => {
  assert.equal(isPathWithinAllowedRootsClient('/opt/cam', ['/opt/cam']), true);
  assert.equal(isPathWithinAllowedRootsClient('/opt/cam/repos/a', ['/opt/cam']), true);
});

test('isPathWithinAllowedRootsClient: 拒绝越界路径', () => {
  assert.equal(isPathWithinAllowedRootsClient('/opt', ['/opt/cam']), false);
  assert.equal(isPathWithinAllowedRootsClient('/opt/cam2', ['/opt/cam']), false);
});
