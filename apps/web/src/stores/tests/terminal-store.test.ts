import test from 'node:test';
import assert from 'node:assert/strict';
import { useTerminalStore } from '../terminal.ts';

function resetTerminalStore(): void {
  useTerminalStore.setState({
    viewMode: 'terminal',
    sessions: [],
    activeSessionId: null,
    connected: false,
    agentSessions: [],
    pipelines: [],
  });
}

test('addAgentSession: 同 sessionId 重复写入时应原地更新而非重复追加', () => {
  resetTerminalStore();

  const addAgentSession = useTerminalStore.getState().addAgentSession;
  addAgentSession({
    sessionId: 'session-1',
    shell: 'agent',
    agentDefinitionId: 'codex',
    agentDisplayName: 'Codex',
    workBranch: 'cam/task-1',
    prompt: 'first prompt',
    repoPath: '/repo/a',
    claudeSessionId: undefined,
    mode: 'continue',
  });
  addAgentSession({
    sessionId: 'session-1',
    shell: 'agent',
    agentDefinitionId: 'codex',
    agentDisplayName: 'Codex',
    workBranch: 'cam/task-2',
    prompt: '',
    repoPath: '/repo/b',
    claudeSessionId: undefined,
    mode: 'continue',
  });

  const rows = useTerminalStore.getState().sessions.filter((item) => item.sessionId === 'session-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agentInfo?.workBranch, 'cam/task-2');
  assert.equal(rows[0].agentInfo?.repoPath, '/repo/b');
  assert.equal(rows[0].agentInfo?.prompt, 'first prompt');
});

test('addAgentSession: 不同 sessionId 应正常追加', () => {
  resetTerminalStore();

  const addAgentSession = useTerminalStore.getState().addAgentSession;
  addAgentSession({
    sessionId: 'session-a',
    shell: 'agent',
    agentDefinitionId: 'codex',
    agentDisplayName: 'Codex',
    workBranch: 'cam/task-a',
    prompt: 'a',
    repoPath: '/repo/a',
    claudeSessionId: undefined,
    mode: 'continue',
  });
  addAgentSession({
    sessionId: 'session-b',
    shell: 'agent',
    agentDefinitionId: 'claude-code',
    agentDisplayName: 'Claude Code',
    workBranch: 'cam/task-b',
    prompt: 'b',
    repoPath: '/repo/b',
    claudeSessionId: 'claude-1',
    mode: 'resume',
  });

  const rows = useTerminalStore.getState().sessions;
  assert.equal(rows.length, 2);
});

test('setAgentSessions: 会清理历史重复 sessionId，避免重连后重复条目残留', () => {
  resetTerminalStore();

  useTerminalStore.setState({
    sessions: [
      {
        sessionId: 'dup-1',
        shell: 'agent',
        title: 'old-1',
        createdAt: new Date().toISOString(),
        attached: false,
        isAgent: true,
        agentInfo: {
          agentDefinitionId: 'codex',
          agentDisplayName: 'Codex',
          prompt: 'p1',
          workBranch: 'b1',
          status: 'running',
          elapsedMs: 10,
        },
      },
      {
        sessionId: 'dup-1',
        shell: 'agent',
        title: 'old-2',
        createdAt: new Date().toISOString(),
        attached: false,
        isAgent: true,
        agentInfo: {
          agentDefinitionId: 'codex',
          agentDisplayName: 'Codex',
          prompt: 'p2',
          workBranch: 'b2',
          status: 'running',
          elapsedMs: 20,
        },
      },
    ],
  });

  useTerminalStore.getState().setAgentSessions([
    {
      sessionId: 'dup-1',
      shell: 'agent',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      agentDefinitionId: 'codex',
      agentDisplayName: 'Codex',
      prompt: 'latest',
      workBranch: 'cam/task-latest',
      status: 'running',
      elapsedMs: 100,
    },
  ]);

  const rows = useTerminalStore.getState().sessions.filter((item) => item.sessionId === 'dup-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agentInfo?.workBranch, 'cam/task-latest');
});

test('addAgentSession: 后续更新缺少 managedSessionKey 时应保留已绑定值', () => {
  resetTerminalStore();

  const addAgentSession = useTerminalStore.getState().addAgentSession;
  addAgentSession({
    sessionId: 'managed-1',
    shell: 'agent',
    agentDefinitionId: 'codex',
    agentDisplayName: 'Codex',
    workBranch: 'cam/task-managed-a',
    prompt: 'initial',
    repoPath: '/repo/a',
    claudeSessionId: undefined,
    managedSessionKey: 'pool/codex/a',
    mode: 'continue',
  });
  addAgentSession({
    sessionId: 'managed-1',
    shell: 'agent',
    agentDefinitionId: 'codex',
    agentDisplayName: 'Codex',
    workBranch: 'cam/task-managed-b',
    prompt: '',
    repoPath: '/repo/a',
    claudeSessionId: undefined,
    managedSessionKey: undefined,
    mode: 'continue',
  });

  const row = useTerminalStore.getState().sessions.find((item) => item.sessionId === 'managed-1');
  assert.equal(row?.agentInfo?.managedSessionKey, 'pool/codex/a');
});

test('setAgentSessions: 服务端回放应更新 managedSessionKey 并在缺失时保留旧值', () => {
  resetTerminalStore();

  useTerminalStore.setState({
    sessions: [
      {
        sessionId: 'managed-2',
        shell: 'agent',
        title: 'managed-2',
        createdAt: new Date().toISOString(),
        attached: false,
        isAgent: true,
        agentInfo: {
          agentDefinitionId: 'codex',
          agentDisplayName: 'Codex',
          prompt: 'seed',
          workBranch: 'cam/task-seed',
          status: 'running',
          elapsedMs: 10,
          managedSessionKey: 'pool/codex/seed',
        },
      },
    ],
  });

  const createdAt = new Date().toISOString();
  const lastActivityAt = new Date().toISOString();
  useTerminalStore.getState().setAgentSessions([
    {
      sessionId: 'managed-2',
      shell: 'agent',
      createdAt,
      lastActivityAt,
      agentDefinitionId: 'codex',
      agentDisplayName: 'Codex',
      prompt: 'latest',
      workBranch: 'cam/task-latest',
      status: 'running',
      elapsedMs: 100,
      managedSessionKey: 'pool/codex/latest',
    },
  ]);

  const afterServerUpdate = useTerminalStore.getState().sessions.find((item) => item.sessionId === 'managed-2');
  assert.equal(afterServerUpdate?.agentInfo?.managedSessionKey, 'pool/codex/latest');

  useTerminalStore.getState().setAgentSessions([
    {
      sessionId: 'managed-2',
      shell: 'agent',
      createdAt,
      lastActivityAt,
      agentDefinitionId: 'codex',
      agentDisplayName: 'Codex',
      prompt: 'latest-2',
      workBranch: 'cam/task-latest-2',
      status: 'running',
      elapsedMs: 120,
      managedSessionKey: undefined,
    },
  ]);

  const finalRow = useTerminalStore.getState().sessions.find((item) => item.sessionId === 'managed-2');
  assert.equal(finalRow?.agentInfo?.managedSessionKey, 'pool/codex/latest');
});
