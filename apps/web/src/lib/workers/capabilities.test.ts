import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectWorkerEnvVarsForAgent,
  isEligibleCapabilityWorker,
  workerSupportsAgent,
  type WorkerCapabilitySnapshot,
} from './capabilities.ts';

test('isEligibleCapabilityWorker: 仅允许 daemon + idle/busy + 新鲜心跳', () => {
  const nowMs = Date.now();
  const fresh = new Date(nowMs - 1_000).toISOString();
  const stale = new Date(nowMs - 60_000).toISOString();

  const base: WorkerCapabilitySnapshot = {
    id: 'w1',
    status: 'idle',
    mode: 'daemon',
    lastHeartbeatAt: fresh,
    supportedAgentIds: [],
    reportedEnvVars: [],
  };

  assert.equal(isEligibleCapabilityWorker(base, { nowMs, staleTimeoutMs: 30_000 }), true);
  assert.equal(
    isEligibleCapabilityWorker({ ...base, status: 'offline' }, { nowMs, staleTimeoutMs: 30_000 }),
    false
  );
  assert.equal(
    isEligibleCapabilityWorker({ ...base, status: 'draining' }, { nowMs, staleTimeoutMs: 30_000 }),
    false
  );
  assert.equal(
    isEligibleCapabilityWorker({ ...base, mode: 'task' }, { nowMs, staleTimeoutMs: 30_000 }),
    false
  );
  assert.equal(
    isEligibleCapabilityWorker({ ...base, lastHeartbeatAt: stale }, { nowMs, staleTimeoutMs: 30_000 }),
    false
  );
});

test('workerSupportsAgent: supportedAgentIds 为空表示支持全部', () => {
  const worker: WorkerCapabilitySnapshot = {
    id: 'w1',
    status: 'idle',
    mode: 'daemon',
    lastHeartbeatAt: new Date().toISOString(),
    supportedAgentIds: [],
    reportedEnvVars: [],
  };

  assert.equal(workerSupportsAgent(worker, 'codex'), true);
  assert.equal(workerSupportsAgent({ ...worker, supportedAgentIds: ['claude-code'] }, 'codex'), false);
  assert.equal(workerSupportsAgent({ ...worker, supportedAgentIds: ['codex', 'claude-code'] }, 'codex'), true);
});

test('collectWorkerEnvVarsForAgent: 仅汇总 eligible 且支持 agent 的 worker 上报变量', () => {
  const nowMs = Date.now();
  const fresh = new Date(nowMs - 1_000).toISOString();
  const stale = new Date(nowMs - 60_000).toISOString();

  const rows: WorkerCapabilitySnapshot[] = [
    {
      id: 'daemon-ok',
      status: 'idle',
      mode: 'daemon',
      lastHeartbeatAt: fresh,
      supportedAgentIds: [],
      reportedEnvVars: ['OPENAI_API_KEY', 'GITHUB_TOKEN'],
    },
    {
      id: 'daemon-no-support',
      status: 'idle',
      mode: 'daemon',
      lastHeartbeatAt: fresh,
      supportedAgentIds: ['claude-code'],
      reportedEnvVars: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    },
    {
      id: 'task-worker',
      status: 'busy',
      mode: 'task',
      lastHeartbeatAt: fresh,
      supportedAgentIds: ['codex'],
      reportedEnvVars: ['OPENAI_API_KEY', 'SHOULD_NOT_APPEAR'],
    },
    {
      id: 'stale-daemon',
      status: 'idle',
      mode: 'daemon',
      lastHeartbeatAt: stale,
      supportedAgentIds: ['codex'],
      reportedEnvVars: ['OPENAI_API_KEY', 'SHOULD_NOT_APPEAR'],
    },
  ];

  const envVars = collectWorkerEnvVarsForAgent(rows, {
    agentDefinitionId: 'codex',
    nowMs,
    staleTimeoutMs: 30_000,
  });

  assert.deepEqual(Array.from(envVars).sort(), ['GITHUB_TOKEN', 'OPENAI_API_KEY']);
});

