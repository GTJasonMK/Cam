import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHostPathInput } from './path-normalize.ts';

test('normalizeHostPathInput: 保持普通 POSIX 路径不变', () => {
  assert.equal(normalizeHostPathInput('/mnt/e/Code/Cam'), '/mnt/e/Code/Cam');
  assert.equal(normalizeHostPathInput('  /workspace/repo  '), '/workspace/repo');
});

test('normalizeHostPathInput: Linux/WSL 下将 Windows 盘符路径转换为 /mnt/<drive>', () => {
  const normalized = normalizeHostPathInput('E:\\Code\\Cam\\repo');
  if (process.platform === 'win32') {
    assert.equal(normalized, 'E:\\Code\\Cam\\repo');
  } else {
    assert.equal(normalized, '/mnt/e/Code/Cam/repo');
  }
});

test('normalizeHostPathInput: Linux/WSL 下将 \\\\wsl$ UNC 路径转换为 POSIX 路径', () => {
  const normalized = normalizeHostPathInput('\\\\wsl$\\Ubuntu\\home\\jason\\repo');
  if (process.platform === 'win32') {
    assert.equal(normalized, '\\\\wsl$\\Ubuntu\\home\\jason\\repo');
  } else {
    assert.equal(normalized, '/home/jason/repo');
  }
});
