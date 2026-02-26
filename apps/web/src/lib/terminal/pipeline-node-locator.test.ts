import test from 'node:test';
import assert from 'node:assert/strict';
import {
  locatePipelineNodeBySessionId,
  locatePipelineNodeByTaskId,
} from './pipeline-node-locator.ts';

type NodeLike = { taskId: string; sessionId?: string };
type StepLike = { nodes: NodeLike[] };

const steps: StepLike[] = [
  {
    nodes: [
      { taskId: 't1', sessionId: 's1' },
      { taskId: 't2' },
    ],
  },
  {
    nodes: [
      { taskId: 't3', sessionId: 's3' },
    ],
  },
];

test('locatePipelineNodeBySessionId: 命中返回步骤与节点索引', () => {
  const result = locatePipelineNodeBySessionId(steps, 's3');
  assert.ok(result);
  assert.equal(result.stepIndex, 1);
  assert.equal(result.nodeIndex, 0);
  assert.equal(result.node.taskId, 't3');
});

test('locatePipelineNodeByTaskId: 命中返回步骤与节点索引', () => {
  const result = locatePipelineNodeByTaskId(steps, 't2');
  assert.ok(result);
  assert.equal(result.stepIndex, 0);
  assert.equal(result.nodeIndex, 1);
  assert.equal(result.node.taskId, 't2');
});

test('locatePipelineNode*: 未命中返回 null', () => {
  assert.equal(locatePipelineNodeBySessionId(steps, 'missing'), null);
  assert.equal(locatePipelineNodeByTaskId(steps, 'missing'), null);
});
