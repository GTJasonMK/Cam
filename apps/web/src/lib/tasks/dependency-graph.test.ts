import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDependentsMap, computeDependencyClosure } from './dependency-graph.ts';

test('buildDependentsMap: 能正确构建反向依赖映射', () => {
  const map = buildDependentsMap([
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['a', 'b'] },
    { id: 'd', dependsOn: ['c'] },
  ]);
  assert.deepEqual(map.get('a'), ['b', 'c']);
  assert.deepEqual(map.get('b'), ['c']);
  assert.deepEqual(map.get('c'), ['d']);
});

test('computeDependencyClosure: 默认遍历全部下游', () => {
  const dependents = buildDependentsMap([
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['b'] },
    { id: 'd', dependsOn: ['a'] },
  ]);
  const closure = computeDependencyClosure('a', dependents);
  assert.deepEqual(new Set(['a', 'b', 'c', 'd']), closure);
});

test('computeDependencyClosure: canVisit 可限制遍历节点', () => {
  const dependents = buildDependentsMap([
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['b'] },
    { id: 'd', dependsOn: ['a'] },
  ]);
  const allowed = new Set(['b', 'd']);
  const closure = computeDependencyClosure('a', dependents, (taskId) => allowed.has(taskId));
  assert.deepEqual(new Set(['a', 'b', 'd']), closure);
});
