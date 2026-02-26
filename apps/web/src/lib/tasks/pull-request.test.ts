import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskPullRequestDraft } from './pull-request.ts';

test('buildTaskPullRequestDraft: 生成统一 PR 标题与正文', () => {
  const draft = buildTaskPullRequestDraft({
    id: 'task-1',
    title: '实现登录',
    agentDefinitionId: 'codex',
    workBranch: 'feat/login',
    description: '补充登录与会话管理',
  });

  assert.equal(draft.title, '[CAM] 实现登录');
  assert.equal(
    draft.body,
    ['Task ID: task-1', 'Agent: codex', 'Branch: feat/login', '', '补充登录与会话管理'].join('\n'),
  );
});

test('buildTaskPullRequestDraft: description 为空时保持稳定格式', () => {
  const draft = buildTaskPullRequestDraft({
    id: 'task-2',
    title: '空描述',
    agentDefinitionId: 'claude',
    workBranch: 'feat/empty',
    description: null,
  });

  assert.equal(draft.title, '[CAM] 空描述');
  assert.equal(
    draft.body,
    ['Task ID: task-2', 'Agent: claude', 'Branch: feat/empty', '', ''].join('\n'),
  );
});
