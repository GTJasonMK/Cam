import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveKnownAgentIdsForImport } from './known-agent-ids.ts';

test('resolveKnownAgentIdsForImport: 合并本地与服务端列表并去重', async () => {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => ({
      json: async () => ({
        success: true,
        data: [{ id: 'codex' }, { id: 'claude-code' }, { id: '  codex  ' }, { id: '' }],
      }),
    }),
  });

  try {
    const ids = await resolveKnownAgentIdsForImport(['aider', 'codex']);
    assert.deepEqual(ids.sort(), ['aider', 'claude-code', 'codex']);
  } finally {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
  }
});

test('resolveKnownAgentIdsForImport: 服务端异常时回退本地列表', async () => {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => {
      throw new Error('network error');
    },
  });

  try {
    const ids = await resolveKnownAgentIdsForImport([' codex ', '', 'aider']);
    assert.deepEqual(ids.sort(), ['aider', 'codex']);
  } finally {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
  }
});
