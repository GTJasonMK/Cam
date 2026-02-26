import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CANCELLABLE_TASK_STATUSES,
  SCHEDULER_CLAIMABLE_TASK_STATUSES,
  TERMINAL_PIPELINE_PENDING_TASK_STATUSES,
  TERMINAL_SESSION_ACTIVE_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  isTaskTerminalStatus,
} from './status.ts';

test('isTaskTerminalStatus: 终态识别准确', () => {
  for (const status of TERMINAL_TASK_STATUSES) {
    assert.equal(isTaskTerminalStatus(status), true);
  }

  assert.equal(isTaskTerminalStatus('queued'), false);
  assert.equal(isTaskTerminalStatus('running'), false);
  assert.equal(isTaskTerminalStatus('awaiting_review'), false);
});

test('DEFAULT_CANCELLABLE_TASK_STATUSES: 不包含终态，且覆盖调度链路可取消状态', () => {
  const cancellable = new Set<string>(DEFAULT_CANCELLABLE_TASK_STATUSES);
  for (const terminal of TERMINAL_TASK_STATUSES) {
    assert.equal(cancellable.has(terminal), false);
  }

  assert.equal(cancellable.has('draft'), true);
  assert.equal(cancellable.has('queued'), true);
  assert.equal(cancellable.has('waiting'), true);
  assert.equal(cancellable.has('running'), true);
  assert.equal(cancellable.has('awaiting_review'), true);
});

test('SCHEDULER_CLAIMABLE_TASK_STATUSES: 仅包含 queued/waiting', () => {
  assert.deepEqual([...SCHEDULER_CLAIMABLE_TASK_STATUSES], ['queued', 'waiting']);
});

test('终端任务状态集合: pending/active 关系正确', () => {
  const pending = new Set<string>(TERMINAL_PIPELINE_PENDING_TASK_STATUSES);
  const active = new Set<string>(TERMINAL_SESSION_ACTIVE_TASK_STATUSES);

  for (const item of pending) {
    assert.equal(active.has(item), true);
  }

  assert.equal(active.has('running'), true);
  assert.equal(pending.has('running'), false);
});
