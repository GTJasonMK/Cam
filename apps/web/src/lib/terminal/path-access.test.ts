import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  getTerminalAllowedRoots,
  isAllowedRootPath,
  isPathWithinAllowedRoots,
  resolveTerminalPath,
} from './path-access.ts';

test('resolveTerminalPath: 归一化为绝对路径', () => {
  assert.equal(resolveTerminalPath('./apps'), resolve('./apps'));
});

test('isPathWithinAllowedRoots: 根目录与子目录允许', () => {
  const root = resolve('/tmp/cam-root');
  assert.equal(isPathWithinAllowedRoots(root, [root]), true);
  assert.equal(isPathWithinAllowedRoots(resolve('/tmp/cam-root/sub/file.txt'), [root]), true);
});

test('isPathWithinAllowedRoots: 越界路径拒绝', () => {
  const root = resolve('/tmp/cam-root');
  assert.equal(isPathWithinAllowedRoots(resolve('/tmp/cam-root/../escape/file.txt'), [root]), false);
  assert.equal(isPathWithinAllowedRoots(resolve('/tmp/cam-other/file.txt'), [root]), false);
});

test('isAllowedRootPath: 仅根目录本身命中', () => {
  const root = resolve('/tmp/cam-root');
  assert.equal(isAllowedRootPath(root, [root]), true);
  assert.equal(isAllowedRootPath(resolve('/tmp/cam-root/sub'), [root]), false);
});

test('getTerminalAllowedRoots: 合并环境变量与默认目录并去重', () => {
  const rootsKey = 'CAM_TERMINAL_ALLOWED_ROOTS';
  const reposKey = 'CAM_REPOS_DIR';
  const rootsBackup = process.env[rootsKey];
  const reposBackup = process.env[reposKey];

  try {
    process.env[rootsKey] = `${process.cwd()};/tmp/cam-root\n/tmp/cam-root`;
    process.env[reposKey] = '/tmp/cam-repos';
    const roots = getTerminalAllowedRoots();

    assert.ok(roots.includes(resolve(process.cwd())));
    assert.ok(roots.includes(resolve('/tmp/cam-root')));
    assert.ok(roots.includes(resolve('/tmp/cam-repos')));
    assert.equal(new Set(roots).size, roots.length);
  } finally {
    if (rootsBackup === undefined) {
      delete process.env[rootsKey];
    } else {
      process.env[rootsKey] = rootsBackup;
    }
    if (reposBackup === undefined) {
      delete process.env[reposKey];
    } else {
      process.env[reposKey] = reposBackup;
    }
  }
});
