import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePipelineStepWorkspaceDirs } from './pipeline-workspace.ts';

test('resolvePipelineStepWorkspaceDirs: 第一阶段无 previousStepDir', () => {
  const dirs = resolvePipelineStepWorkspaceDirs({
    repoPath: '/repo',
    stepIndex: 0,
  });

  assert.equal(dirs.stepDir, '/repo/.conversations/step1');
  assert.equal(dirs.previousStepDir, null);
});

test('resolvePipelineStepWorkspaceDirs: 非首阶段含 previousStepDir', () => {
  const dirs = resolvePipelineStepWorkspaceDirs({
    repoPath: '/repo',
    stepIndex: 2,
  });

  assert.equal(dirs.stepDir, '/repo/.conversations/step3');
  assert.equal(dirs.previousStepDir, '/repo/.conversations/step2');
});
