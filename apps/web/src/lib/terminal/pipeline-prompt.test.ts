import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPipelineNodePromptText } from './pipeline-prompt.ts';

test('buildPipelineNodePromptText: 第一阶段无上一步目录时提示正确', () => {
  const text = buildPipelineNodePromptText({
    nodePrompt: '执行任务A',
    pipelineId: 'pipeline-1',
    stepIndex: 0,
    stepCount: 3,
    stepTitle: '步骤1',
    stepPrompt: '完成第一步',
    stepInputCondition: null,
    stepInputFiles: [],
    nodeIndex: 0,
    nodeCount: 1,
    nodeTitle: '节点A',
    repoPath: '/repo',
    stepDir: '/repo/.conversations/step1',
    previousStepDir: null,
  });

  assert.match(text, /当前为第一步，没有上一步输出/);
  assert.match(text, /请将本子任务输出写入: \.conversations\/step1\/agent-1-output\.md/);
  assert.doesNotMatch(text, /步骤共享目标/);
});

test('buildPipelineNodePromptText: 并行节点时附加步骤共享目标', () => {
  const text = buildPipelineNodePromptText({
    nodePrompt: '执行任务B',
    pipelineId: 'pipeline-2',
    stepIndex: 1,
    stepCount: 3,
    stepTitle: '步骤2',
    stepPrompt: '共享目标说明',
    stepInputCondition: '依赖 step1 summary',
    stepInputFiles: ['a.md', 'b.md'],
    nodeIndex: 1,
    nodeCount: 2,
    nodeTitle: '节点B',
    repoPath: '/repo',
    stepDir: '/repo/.conversations/step2',
    previousStepDir: '/repo/.conversations/step1',
  });

  assert.match(text, /上一步输出目录: \.conversations\/step1/);
  assert.match(text, /输入条件: 依赖 step1 summary/);
  assert.match(text, /优先输入文件: a\.md, b\.md/);
  assert.match(text, /## 步骤共享目标/);
  assert.match(text, /共享目标说明/);
});
