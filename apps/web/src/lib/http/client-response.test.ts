import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readApiEnvelope,
  resolveApiErrorMessage,
  resolveMissingEnvVars,
} from './client-response.ts';

test('readApiEnvelope: 成功解析 JSON', async () => {
  const response = new Response(JSON.stringify({ success: true, data: { id: '1' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const parsed = await readApiEnvelope<{ id: string }>(response);
  assert.deepEqual(parsed, { success: true, data: { id: '1' } });
});

test('readApiEnvelope: JSON 解析失败返回 null', async () => {
  const response = new Response('{ broken json', {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });
  const parsed = await readApiEnvelope(response);
  assert.equal(parsed, null);
});

test('resolveApiErrorMessage: 优先 payload.message，否则按状态/fallback', () => {
  const bad = new Response('', { status: 400 });
  assert.equal(
    resolveApiErrorMessage(bad, { error: { message: '参数错误' } }, '默认错误'),
    '参数错误',
  );

  const badNoPayload = new Response('', { status: 503 });
  assert.equal(resolveApiErrorMessage(badNoPayload, null, '默认错误'), 'HTTP 503');

  const okNoPayload = new Response('', { status: 200 });
  assert.equal(resolveApiErrorMessage(okNoPayload, null, '默认错误'), '默认错误');
});

test('resolveMissingEnvVars: 只返回非空字符串项', () => {
  assert.deepEqual(
    resolveMissingEnvVars({
      error: {
        missingEnvVars: ['OPENAI_API_KEY', '', '  ', 123, 'ANTHROPIC_API_KEY'],
      },
    }),
    ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
  );
  assert.equal(resolveMissingEnvVars({ error: {} }), undefined);
});
