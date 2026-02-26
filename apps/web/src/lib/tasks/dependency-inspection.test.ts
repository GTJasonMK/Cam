import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDependencyReadiness, inspectTaskDependencies } from './dependency-inspection.ts';

test('inspectTaskDependencies: 空依赖直接完成', () => {
  const result = inspectTaskDependencies([], []);
  assert.equal(result.allCompleted, true);
  assert.deepEqual(result.missingDepIds, []);
  assert.deepEqual(result.terminalDeps, []);
});

test('inspectTaskDependencies: 缺失依赖与终态依赖识别正确', () => {
  const result = inspectTaskDependencies(
    ['a', 'b', 'c', 'd'],
    [
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'running' },
      { id: 'c', status: 'failed' },
    ],
  );
  assert.equal(result.allCompleted, false);
  assert.deepEqual(result.missingDepIds, ['d']);
  assert.deepEqual(result.terminalDeps, [{ id: 'c', status: 'failed' }]);
});

test('inspectTaskDependencies: 所有依赖 completed 时 allCompleted=true', () => {
  const result = inspectTaskDependencies(
    ['a', 'b'],
    [
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'completed' },
    ],
  );
  assert.equal(result.allCompleted, true);
  assert.deepEqual(result.missingDepIds, []);
  assert.deepEqual(result.terminalDeps, []);
});

test('deriveDependencyReadiness: blocked / ready / pending 判定准确', () => {
  const blocked = deriveDependencyReadiness({
    allCompleted: false,
    missingDepIds: ['dep-1'],
    terminalDeps: [],
  });
  assert.equal(blocked, 'blocked');

  const ready = deriveDependencyReadiness({
    allCompleted: true,
    missingDepIds: [],
    terminalDeps: [],
  });
  assert.equal(ready, 'ready');

  const pending = deriveDependencyReadiness({
    allCompleted: false,
    missingDepIds: [],
    terminalDeps: [],
  });
  assert.equal(pending, 'pending');
});
