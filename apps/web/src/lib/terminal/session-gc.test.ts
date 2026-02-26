import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectExpiredPipelineActions,
  collectExpiredSessionActions,
  collectFinishedSessionIds,
} from './session-gc.ts';

test('collectFinishedSessionIds: 仅返回终态且 PTY 已退出的会话', () => {
  const sessions = new Map<string, { status: string }>([
    ['running', { status: 'running' }],
    ['completed-active', { status: 'completed' }],
    ['failed-inactive', { status: 'failed' }],
  ]);

  const result = collectFinishedSessionIds(sessions, (sessionId) => sessionId === 'completed-active');
  assert.deepEqual(result, ['failed-inactive']);
});

test('collectExpiredSessionActions: 按 TTL + 运行态 + 日志收尾判断动作', () => {
  const now = 1000;
  const sessions = new Map<string, { status: string; taskId?: string }>([
    ['expired-delete', { status: 'failed', taskId: 't1' }],
    ['expired-running', { status: 'running' }],
    ['expired-pending-log', { status: 'cancelled' }],
    ['fresh', { status: 'completed' }],
  ]);
  const sessionFinishedAt = new Map<string, number>([
    ['expired-delete', 100],
    ['expired-running', 100],
    ['expired-pending-log', 100],
    ['missing-meta', 100],
    ['fresh', 980],
  ]);

  const result = collectExpiredSessionActions({
    sessions,
    sessionFinishedAt,
    now,
    ttlMs: 500,
    hasPtySession: () => false,
    hasPendingLogFlush: (sessionId) => sessionId === 'expired-pending-log',
  });

  assert.deepEqual(result.clearFinishedAtSessionIds.sort(), ['expired-running', 'missing-meta']);
  assert.deepEqual(result.deleteSessionIds, ['expired-delete']);
});

test('collectExpiredPipelineActions: 仅删除过期且无活动节点的终态流水线', () => {
  const now = 5000;
  const pipelines = new Map<string, { status: string; steps: Array<{ nodes: Array<{ sessionId?: string }> }> }>([
    ['expired-delete', { status: 'completed', steps: [{ nodes: [{ sessionId: 's1' }] }] }],
    ['expired-active', { status: 'failed', steps: [{ nodes: [{ sessionId: 's-live' }] }] }],
    ['expired-running', { status: 'running', steps: [{ nodes: [] }] }],
  ]);
  const pipelineFinishedAt = new Map<string, number>([
    ['expired-delete', 1000],
    ['expired-active', 1000],
    ['expired-running', 1000],
    ['missing', 1000],
    ['fresh', 4900],
  ]);

  const result = collectExpiredPipelineActions({
    pipelines,
    pipelineFinishedAt,
    now,
    ttlMs: 2000,
    hasPtySession: (sessionId) => sessionId === 's-live',
  });

  assert.deepEqual(result.clearFinishedAtPipelineIds.sort(), ['expired-running', 'missing']);
  assert.deepEqual(result.deletePipelineIds, ['expired-delete']);
});
