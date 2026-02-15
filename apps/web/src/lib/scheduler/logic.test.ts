import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areDependenciesSatisfied,
  decideRecoveryAction,
  decideStaleTaskAction,
  isWorkerAliveForTask,
} from './logic.ts';

test('areDependenciesSatisfied: 无依赖时返回 true', () => {
  assert.equal(areDependenciesSatisfied([], []), true);
});

test('areDependenciesSatisfied: 依赖全部 completed 返回 true', () => {
  const dependsOn = ['task-a', 'task-b'];
  const depTasks = [
    { id: 'task-a', status: 'completed' },
    { id: 'task-b', status: 'completed' },
  ];
  assert.equal(areDependenciesSatisfied(dependsOn, depTasks), true);
});

test('areDependenciesSatisfied: 缺失依赖或状态非 completed 返回 false', () => {
  assert.equal(
    areDependenciesSatisfied(
      ['task-a', 'task-b'],
      [{ id: 'task-a', status: 'completed' }]
    ),
    false
  );
  assert.equal(
    areDependenciesSatisfied(
      ['task-a'],
      [{ id: 'task-a', status: 'running' }]
    ),
    false
  );
});

test('decideRecoveryAction: 根据 worker 存活与重试次数判定', () => {
  assert.equal(decideRecoveryAction({ workerAlive: true, retryCount: 0, maxRetries: 2 }), 'keep_running');
  assert.equal(decideRecoveryAction({ workerAlive: false, retryCount: 1, maxRetries: 2 }), 'retry');
  assert.equal(decideRecoveryAction({ workerAlive: false, retryCount: 2, maxRetries: 2 }), 'fail');
});

test('decideStaleTaskAction: 非 running 任务跳过，running 按重试策略判定', () => {
  assert.equal(decideStaleTaskAction(null), 'skip');
  assert.equal(
    decideStaleTaskAction({ status: 'cancelled', retryCount: 0, maxRetries: 2 }),
    'skip'
  );
  assert.equal(
    decideStaleTaskAction({ status: 'running', retryCount: 0, maxRetries: 2 }),
    'retry'
  );
  assert.equal(
    decideStaleTaskAction({ status: 'running', retryCount: 2, maxRetries: 2 }),
    'fail'
  );
});

test('isWorkerAliveForTask: 心跳、状态、currentTaskId 任一不满足即 false', () => {
  const now = Date.now();
  const staleBeforeMs = now - 30_000;
  const freshHeartbeat = new Date(now - 1_000).toISOString();
  const staleHeartbeat = new Date(now - 60_000).toISOString();

  assert.equal(
    isWorkerAliveForTask({
      worker: { status: 'busy', currentTaskId: 'task-a', lastHeartbeatAt: freshHeartbeat },
      taskId: 'task-a',
      staleBeforeMs,
    }),
    true
  );

  assert.equal(
    isWorkerAliveForTask({
      worker: { status: 'idle', currentTaskId: 'task-a', lastHeartbeatAt: freshHeartbeat },
      taskId: 'task-a',
      staleBeforeMs,
    }),
    false
  );

  assert.equal(
    isWorkerAliveForTask({
      worker: { status: 'busy', currentTaskId: 'task-a', lastHeartbeatAt: staleHeartbeat },
      taskId: 'task-a',
      staleBeforeMs,
    }),
    false
  );
});
