import test from 'node:test';
import assert from 'node:assert/strict';
import {
  transitionSessionToFinalStatus,
  type SessionLifecycleMeta,
} from './session-lifecycle.ts';

type Meta = SessionLifecycleMeta & {
  sessionId: string;
};

test('transitionSessionToFinalStatus: running 会话可转为终态并记录耗时', () => {
  const sessions = new Map<string, Meta>([
    ['s1', { sessionId: 's1', status: 'running', startedAt: 100 }],
  ]);
  const sessionFinishedAt = new Map<string, number>();

  const result = transitionSessionToFinalStatus(
    sessions,
    sessionFinishedAt,
    's1',
    'completed',
    { exitCode: 0, finishedAt: 350 },
  );

  assert.ok(result);
  assert.equal(result.previous.status, 'running');
  assert.equal(result.updated.status, 'completed');
  assert.equal(result.updated.exitCode, 0);
  assert.equal(result.elapsedMs, 250);
  assert.equal(sessionFinishedAt.get('s1'), 350);
});

test('transitionSessionToFinalStatus: 非 running 会话忽略', () => {
  const sessions = new Map<string, Meta>([
    ['s1', { sessionId: 's1', status: 'failed', startedAt: 100, finishedAt: 200, exitCode: 1 }],
  ]);
  const sessionFinishedAt = new Map<string, number>([['s1', 200]]);

  const result = transitionSessionToFinalStatus(
    sessions,
    sessionFinishedAt,
    's1',
    'cancelled',
    { finishedAt: 300 },
  );

  assert.equal(result, undefined);
  assert.equal(sessions.get('s1')?.status, 'failed');
  assert.equal(sessionFinishedAt.get('s1'), 200);
});

test('transitionSessionToFinalStatus: 未传 exitCode 时保留原值', () => {
  const sessions = new Map<string, Meta>([
    ['s1', { sessionId: 's1', status: 'running', startedAt: 100, exitCode: 7 }],
  ]);
  const sessionFinishedAt = new Map<string, number>();

  const result = transitionSessionToFinalStatus(
    sessions,
    sessionFinishedAt,
    's1',
    'cancelled',
    { finishedAt: 400 },
  );

  assert.ok(result);
  assert.equal(result.updated.exitCode, 7);
  assert.equal(result.updated.status, 'cancelled');
});
