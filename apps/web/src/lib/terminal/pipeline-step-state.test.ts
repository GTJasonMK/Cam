import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelActiveNodesFromSteps,
  cancelDraftNodesFromSteps,
  cancelRunningNodesInStep,
  type MutablePipelineStep,
} from './pipeline-step-state.ts';

type Step = MutablePipelineStep<{
  id: string;
  status: 'draft' | 'running' | 'completed' | 'failed' | 'cancelled';
  sessionId?: string;
}>;

test('cancelRunningNodesInStep: 取消 running 且存在 sessionId 的节点', () => {
  const step: Step = {
    status: 'running',
    nodes: [
      { id: 'n1', status: 'running', sessionId: 's1' },
      { id: 'n2', status: 'running' },
      { id: 'n3', status: 'completed', sessionId: 's3' },
    ],
  };

  const changed = cancelRunningNodesInStep(step);
  assert.deepEqual(changed.map((item) => item.node.id), ['n1']);
  assert.equal(step.nodes[0].status, 'cancelled');
  assert.equal(step.nodes[1].status, 'running');
});

test('cancelRunningNodesInStep: 支持按 sessionId 排除', () => {
  const step: Step = {
    status: 'running',
    nodes: [
      { id: 'n1', status: 'running', sessionId: 's1' },
      { id: 'n2', status: 'running', sessionId: 's2' },
    ],
  };

  const changed = cancelRunningNodesInStep(step, { excludeSessionId: 's2' });
  assert.deepEqual(changed.map((item) => item.node.id), ['n1']);
  assert.equal(step.nodes[0].status, 'cancelled');
  assert.equal(step.nodes[1].status, 'running');
});

test('cancelDraftNodesFromSteps: 从指定步骤开始取消 draft 节点与 draft 步骤', () => {
  const steps: Step[] = [
    { status: 'running', nodes: [{ id: 'a', status: 'running', sessionId: 's-a' }] },
    {
      status: 'draft',
      nodes: [
        { id: 'b1', status: 'draft' },
        { id: 'b2', status: 'completed' },
      ],
    },
    {
      status: 'failed',
      nodes: [{ id: 'c1', status: 'draft' }],
    },
  ];

  const changed = cancelDraftNodesFromSteps(steps, 1);
  assert.deepEqual(changed.map((item) => item.node.id), ['b1', 'c1']);
  assert.equal(steps[1].status, 'cancelled');
  assert.equal(steps[2].status, 'failed');
});

test('cancelActiveNodesFromSteps: 取消 draft/running 节点并收敛步骤状态', () => {
  const steps: Step[] = [
    {
      status: 'running',
      nodes: [
        { id: 'a1', status: 'running', sessionId: 's-a1' },
        { id: 'a2', status: 'draft' },
      ],
    },
    {
      status: 'completed',
      nodes: [{ id: 'b1', status: 'draft' }],
    },
  ];

  const changed = cancelActiveNodesFromSteps(steps, 0);
  assert.deepEqual(changed.map((item) => item.node.id), ['a1', 'a2', 'b1']);
  assert.equal(steps[0].status, 'cancelled');
  assert.equal(steps[1].status, 'completed');
});
