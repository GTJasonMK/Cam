import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTerminalEntryName } from './file-name.ts';

test('sanitizeTerminalEntryName: 合法名称保留', () => {
  assert.equal(sanitizeTerminalEntryName('a.txt'), 'a.txt');
  assert.equal(sanitizeTerminalEntryName('  folder-name  '), 'folder-name');
});

test('sanitizeTerminalEntryName: 路径形式输入仅保留 basename', () => {
  assert.equal(sanitizeTerminalEntryName('../a.txt'), 'a.txt');
  assert.equal(sanitizeTerminalEntryName('dir/sub/b.txt'), 'b.txt');
  assert.equal(sanitizeTerminalEntryName('dir\\sub\\c.txt'), 'c.txt');
});

test('sanitizeTerminalEntryName: 非法名称返回 null', () => {
  assert.equal(sanitizeTerminalEntryName(''), null);
  assert.equal(sanitizeTerminalEntryName('.'), null);
  assert.equal(sanitizeTerminalEntryName('..'), null);
  assert.equal(sanitizeTerminalEntryName(`bad\0name.txt`), null);
});

