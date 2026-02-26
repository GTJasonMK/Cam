import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPipelineHookCleanupKey,
  cleanupPipelineCallbackTokensById,
  cleanupPipelineHookByKey,
  cleanupPipelineHooksById,
  consumePipelineCallbackToken,
} from './pipeline-hook-state.ts';

test('buildPipelineHookCleanupKey: 格式稳定', () => {
  assert.equal(buildPipelineHookCleanupKey('pipeline-1', 2, 3), 'pipeline-1:2:3');
});

test('consumePipelineCallbackToken: 命中时消费，未命中不删除', () => {
  const map = new Map([
    ['token-ok', { pipelineId: 'p1', taskId: 't1' }],
    ['token-keep', { pipelineId: 'p2', taskId: 't2' }],
  ]);

  assert.equal(
    consumePipelineCallbackToken(map, 'token-ok', { pipelineId: 'p1', taskId: 't1' }),
    true,
  );
  assert.equal(map.has('token-ok'), false);

  assert.equal(
    consumePipelineCallbackToken(map, 'token-keep', { pipelineId: 'p1', taskId: 't2' }),
    false,
  );
  assert.equal(map.has('token-keep'), true);
});

test('cleanupPipelineHookByKey / cleanupPipelineHooksById / cleanupPipelineCallbackTokensById', async () => {
  let calledSingle = 0;
  let calledBatch = 0;

  const hookMap = new Map<string, () => Promise<void>>([
    ['p1:0:0', async () => { calledSingle += 1; }],
    ['p1:0:1', async () => { calledBatch += 1; }],
    ['p2:0:0', async () => { calledBatch += 10; }],
  ]);
  const tokenMap = new Map([
    ['a', { pipelineId: 'p1', taskId: 't1' }],
    ['b', { pipelineId: 'p2', taskId: 't2' }],
  ]);

  cleanupPipelineHookByKey(hookMap, 'p1:0:0');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calledSingle, 1);
  assert.equal(hookMap.has('p1:0:0'), false);

  cleanupPipelineHooksById(hookMap, 'p1');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calledBatch, 1);
  assert.equal(hookMap.has('p1:0:1'), false);
  assert.equal(hookMap.has('p2:0:0'), true);

  cleanupPipelineCallbackTokensById(tokenMap, 'p1');
  assert.equal(tokenMap.has('a'), false);
  assert.equal(tokenMap.has('b'), true);
});
