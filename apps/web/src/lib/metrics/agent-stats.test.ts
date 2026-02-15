import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentStats } from './agent-stats.ts';

test('buildAgentStats: 统计成功率与平均耗时', () => {
  const rows = buildAgentStats(
    [
      {
        agentDefinitionId: 'agent-a',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:01:00.000Z',
      },
      {
        agentDefinitionId: 'agent-a',
        status: 'failed',
        startedAt: '2026-01-01T00:02:00.000Z',
        completedAt: '2026-01-01T00:03:00.000Z',
      },
      {
        agentDefinitionId: 'agent-b',
        status: 'completed',
        startedAt: '2026-01-01T00:10:00.000Z',
        completedAt: '2026-01-01T00:12:00.000Z',
      },
      {
        agentDefinitionId: 'agent-b',
        status: 'running',
        startedAt: '2026-01-01T00:20:00.000Z',
        completedAt: null,
      },
    ],
    [
      { id: 'agent-a', displayName: 'Agent A' },
      { id: 'agent-b', displayName: 'Agent B' },
    ]
  );

  assert.equal(rows.length, 2);

  const agentA = rows.find((row) => row.agentDefinitionId === 'agent-a');
  assert.ok(agentA);
  assert.equal(agentA.total, 2);
  assert.equal(agentA.completed, 1);
  assert.equal(agentA.failed, 1);
  assert.equal(agentA.successRate, 50);
  assert.equal(agentA.avgDurationMs, 60_000);

  const agentB = rows.find((row) => row.agentDefinitionId === 'agent-b');
  assert.ok(agentB);
  assert.equal(agentB.total, 2);
  assert.equal(agentB.completed, 1);
  assert.equal(agentB.failed, 0);
  assert.equal(agentB.successRate, 100);
  assert.equal(agentB.avgDurationMs, 120_000);
});

test('buildAgentStats: 仅运行任务时成功率与耗时为空', () => {
  const rows = buildAgentStats(
    [
      {
        agentDefinitionId: 'agent-x',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
      },
    ],
    [{ id: 'agent-x', displayName: 'Agent X' }]
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].successRate, null);
  assert.equal(rows[0].avgDurationMs, null);
});
