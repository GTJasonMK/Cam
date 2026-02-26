import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apiBadRequest,
  apiConflict,
  apiCreated,
  apiError,
  apiInternalError,
  apiInvalidJson,
  apiMessageSuccess,
  apiNotFound,
  apiSuccess,
} from './api-response.ts';

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

test('apiSuccess/apiCreated: 返回 success=true 结构和状态码', async () => {
  const ok = apiSuccess({ id: 1 });
  assert.equal(ok.status, 200);
  assert.deepEqual(await readJson(ok), { success: true, data: { id: 1 } });

  const msg = apiMessageSuccess('done');
  assert.equal(msg.status, 200);
  assert.deepEqual(await readJson(msg), { success: true, message: 'done' });

  const created = apiCreated({ id: 2 });
  assert.equal(created.status, 201);
  assert.deepEqual(await readJson(created), { success: true, data: { id: 2 } });
});

test('apiError: 支持自定义状态与扩展字段', async () => {
  const response = apiError('CUSTOM', '出错', {
    status: 422,
    extra: { detail: 'x' },
  });
  assert.equal(response.status, 422);
  assert.deepEqual(await readJson(response), {
    success: false,
    error: {
      code: 'CUSTOM',
      message: '出错',
      detail: 'x',
    },
  });
});

test('apiBadRequest/apiNotFound/apiConflict/apiInternalError: 返回预置 code/status', async () => {
  const bad = apiBadRequest('bad');
  assert.equal(bad.status, 400);
  assert.deepEqual(await readJson(bad), {
    success: false,
    error: { code: 'INVALID_INPUT', message: 'bad' },
  });

  const notFound = apiNotFound('missing');
  assert.equal(notFound.status, 404);
  assert.deepEqual(await readJson(notFound), {
    success: false,
    error: { code: 'NOT_FOUND', message: 'missing' },
  });

  const invalidJson = apiInvalidJson();
  assert.equal(invalidJson.status, 400);
  assert.deepEqual(await readJson(invalidJson), {
    success: false,
    error: { code: 'INVALID_JSON', message: '请求体 JSON 解析失败' },
  });

  const conflict = apiConflict('dup', { extra: { id: '1' } });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await readJson(conflict), {
    success: false,
    error: { code: 'STATE_CONFLICT', message: 'dup', id: '1' },
  });

  const internal = apiInternalError('boom');
  assert.equal(internal.status, 500);
  assert.deepEqual(await readJson(internal), {
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'boom' },
  });
});
