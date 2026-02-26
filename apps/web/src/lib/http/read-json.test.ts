import test from 'node:test';
import assert from 'node:assert/strict';
import { readJsonBodyAsRecord, readJsonBodyOrDefault, tryReadJsonBody } from './read-json.ts';

test('readJsonBodyOrDefault: JSON 解析成功返回解析结果', async () => {
  const request = new Request('http://localhost/test', {
    method: 'POST',
    body: JSON.stringify({ a: 1, b: 'ok' }),
    headers: { 'content-type': 'application/json' },
  });
  const result = await readJsonBodyOrDefault<Record<string, unknown>>(request, {});
  assert.deepEqual(result, { a: 1, b: 'ok' });
});

test('tryReadJsonBody: 成功时返回 ok=true', async () => {
  const request = new Request('http://localhost/test', {
    method: 'POST',
    body: JSON.stringify({ a: 1 }),
    headers: { 'content-type': 'application/json' },
  });
  const result = await tryReadJsonBody<Record<string, unknown>>(request);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, { a: 1 });
  }
});

test('tryReadJsonBody: 失败时返回 ok=false', async () => {
  const broken = {
    json: async () => {
      throw new Error('invalid json');
    },
  } as unknown as Request;
  const result = await tryReadJsonBody<Record<string, unknown>>(broken);
  assert.equal(result.ok, false);
});

test('readJsonBodyOrDefault: JSON 解析失败返回默认值', async () => {
  const broken = {
    json: async () => {
      throw new Error('invalid json');
    },
  } as unknown as Request;

  const fallback = { ok: false };
  const result = await readJsonBodyOrDefault(broken, fallback);
  assert.equal(result, fallback);
});

test('readJsonBodyAsRecord: 失败时返回空对象', async () => {
  const broken = {
    json: async () => {
      throw new Error('invalid json');
    },
  } as unknown as Request;

  const result = await readJsonBodyAsRecord(broken);
  assert.deepEqual(result, {});
});
