import test from 'node:test';
import assert from 'node:assert/strict';
import {
  linkTaskSessionIndex,
  resolveSessionMetaByTaskId,
  unlinkTaskSessionIndexIfMatched,
} from './session-index.ts';

type Meta = {
  sessionId: string;
  taskId?: string;
};

test('resolveSessionMetaByTaskId: 索引命中且 taskId 匹配', () => {
  const index = new Map<string, string>([['t1', 's1']]);
  const sessions = new Map<string, Meta>([['s1', { sessionId: 's1', taskId: 't1' }]]);

  const result = resolveSessionMetaByTaskId(index, sessions, 't1');
  assert.deepEqual(result, { sessionId: 's1', taskId: 't1' });
});

test('resolveSessionMetaByTaskId: 索引失效时回退扫描并重建索引', () => {
  const index = new Map<string, string>([['t1', 's_missing']]);
  const sessions = new Map<string, Meta>([['s2', { sessionId: 's2', taskId: 't1' }]]);

  const result = resolveSessionMetaByTaskId(index, sessions, 't1');
  assert.deepEqual(result, { sessionId: 's2', taskId: 't1' });
  assert.equal(index.get('t1'), 's2');
});

test('link/unlinkTaskSessionIndexIfMatched: 仅在匹配时删除', () => {
  const index = new Map<string, string>();
  linkTaskSessionIndex(index, 't1', 's1');
  assert.equal(index.get('t1'), 's1');

  assert.equal(unlinkTaskSessionIndexIfMatched(index, 't1', 's2'), false);
  assert.equal(index.get('t1'), 's1');

  assert.equal(unlinkTaskSessionIndexIfMatched(index, 't1', 's1'), true);
  assert.equal(index.has('t1'), false);
});
