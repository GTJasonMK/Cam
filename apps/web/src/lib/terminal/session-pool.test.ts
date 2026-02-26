import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultSessionKey,
  normalizeSessionPoolUpsertPayload,
} from './session-pool.ts';

test('buildDefaultSessionKey: 生成稳定默认键', () => {
  const keyA = buildDefaultSessionKey({
    repoPath: '/workspace/cam',
    agentDefinitionId: 'claude-code',
    mode: 'resume',
    resumeSessionId: 'abc-123',
  });
  const keyB = buildDefaultSessionKey({
    repoPath: '/workspace/cam',
    agentDefinitionId: 'claude-code',
    mode: 'resume',
    resumeSessionId: 'abc-123',
  });
  assert.equal(keyA, keyB);
  assert.match(keyA, /^claude-code:abc-123:[a-f0-9]{10}$/);
});

test('normalizeSessionPoolUpsertPayload: 使用 workDir 作为 repoPath 回退', () => {
  const rows = normalizeSessionPoolUpsertPayload({
    workDir: '/repo/a',
    sessions: [
      {
        agentDefinitionId: 'codex',
        mode: 'resume',
        resumeSessionId: 'sess-1',
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].repoPath, '/repo/a');
  assert.equal(rows[0].agentDefinitionId, 'codex');
  assert.equal(rows[0].mode, 'resume');
  assert.equal(rows[0].resumeSessionId, 'sess-1');
  assert.equal(rows[0].source, 'external');
});

test('normalizeSessionPoolUpsertPayload: Linux/WSL 下将 Windows 路径归一化', () => {
  const rows = normalizeSessionPoolUpsertPayload({
    workDir: 'E:\\Code\\Cam',
    sessions: [
      {
        agentDefinitionId: 'claude-code',
        mode: 'continue',
      },
    ],
  });
  assert.equal(rows.length, 1);
  if (process.platform === 'win32') {
    assert.equal(rows[0].repoPath, 'E:\\Code\\Cam');
  } else {
    assert.equal(rows[0].repoPath, '/mnt/e/Code/Cam');
  }
});

test('normalizeSessionPoolUpsertPayload: 显式 sessionKey/managed/source/title 透传', () => {
  const rows = normalizeSessionPoolUpsertPayload({
    sessions: [
      {
        sessionKey: 'custom-key',
        repoPath: '/repo/b',
        agentDefinitionId: 'claude-code',
        mode: 'continue',
        source: 'managed',
        title: '  已托管会话  ',
      },
    ],
  });
  assert.equal(rows[0].sessionKey, 'custom-key');
  assert.equal(rows[0].source, 'managed');
  assert.equal(rows[0].title, '已托管会话');
});

test('normalizeSessionPoolUpsertPayload: 缺少 sessions 报错', () => {
  assert.throws(
    () => normalizeSessionPoolUpsertPayload({}),
    /sessions 不能为空/,
  );
});

test('normalizeSessionPoolUpsertPayload: resume 缺少 resumeSessionId 报错', () => {
  assert.throws(
    () => normalizeSessionPoolUpsertPayload({
      workDir: '/repo/c',
      sessions: [{ agentDefinitionId: 'codex', mode: 'resume' }],
    }),
    /resume 模式必须提供 resumeSessionId/,
  );
});

test('normalizeSessionPoolUpsertPayload: 非法 mode 报错', () => {
  assert.throws(
    () => normalizeSessionPoolUpsertPayload({
      workDir: '/repo/c',
      sessions: [{ agentDefinitionId: 'codex', mode: 'create' as 'continue' }],
    }),
    /mode 仅支持 resume\/continue/,
  );
});
