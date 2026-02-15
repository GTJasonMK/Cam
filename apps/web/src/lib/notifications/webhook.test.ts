import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebhookRequest, parseWebhookUrls, shouldSendWebhookEvent } from './webhook.ts';

test('parseWebhookUrls: 支持逗号与换行分隔并过滤非法地址', () => {
  const urls = parseWebhookUrls(
    'https://hooks.slack.com/services/a,bad-url,\nhttps://example.com/hook\nhttp://localhost:9000/incoming'
  );
  assert.deepEqual(urls, [
    'https://hooks.slack.com/services/a',
    'https://example.com/hook',
    'http://localhost:9000/incoming',
  ]);
});

test('shouldSendWebhookEvent: 跳过心跳与未关注状态', () => {
  const options = {
    eventFilters: [] as string[],
    progressStatuses: new Set(['running', 'completed']),
  };

  assert.equal(shouldSendWebhookEvent('worker.heartbeat', {}, options), false);
  assert.equal(shouldSendWebhookEvent('task.progress', { status: 'queued' }, options), false);
  assert.equal(shouldSendWebhookEvent('task.progress', { status: 'completed' }, options), true);
});

test('shouldSendWebhookEvent: 支持通配过滤规则', () => {
  const options = {
    eventFilters: ['task.*', 'alert.triggered'],
    progressStatuses: new Set(['running', 'completed']),
  };

  assert.equal(shouldSendWebhookEvent('task.started', {}, options), true);
  assert.equal(shouldSendWebhookEvent('alert.triggered', {}, options), true);
  assert.equal(shouldSendWebhookEvent('worker.offline', {}, options), false);
});

test('buildWebhookRequest: Slack/飞书/钉钉格式正确', () => {
  const base = {
    token: 'abc',
    timestamp: '2026-02-15T12:00:00.000Z',
  } as const;
  const payload = { taskId: 'task-1', status: 'completed' };

  const slack = buildWebhookRequest('task.progress', payload, {
    ...base,
    provider: 'slack',
  });
  assert.equal(slack.headers.Authorization, 'Bearer abc');
  assert.equal(typeof slack.body.text, 'string');

  const feishu = buildWebhookRequest('task.progress', payload, {
    ...base,
    provider: 'feishu',
  });
  assert.equal(feishu.body.msg_type, 'text');

  const dingtalk = buildWebhookRequest('task.progress', payload, {
    ...base,
    provider: 'dingtalk',
  });
  assert.equal(dingtalk.body.msgtype, 'text');
});

test('buildWebhookRequest: generic 格式包含结构化字段', () => {
  const req = buildWebhookRequest(
    'task.progress',
    { taskId: 'task-1', status: 'failed', summary: 'some failure details' },
    {
      provider: 'generic',
      token: '',
      timestamp: '2026-02-15T12:00:00.000Z',
    }
  );

  assert.equal(req.headers.Authorization, undefined);
  assert.equal(req.body.source, 'coding-agents-manager');
  assert.equal(req.body.type, 'task.progress');
  assert.equal(req.body.timestamp, '2026-02-15T12:00:00.000Z');
});
