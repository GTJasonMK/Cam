import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGitProviderToken } from './provider-token.ts';

test('resolveGitProviderToken: 命中 scoped token 时优先返回', async () => {
  const calls: string[] = [];
  const token = await resolveGitProviderToken(
    'github',
    { repositoryId: 'repo-1' },
    {
      resolveScopedValue: async (name) => {
        calls.push(name);
        return name === 'GITHUB_PAT' ? 'scoped-pat' : null;
      },
    },
  );

  assert.equal(token, 'scoped-pat');
  assert.deepEqual(calls, ['GITHUB_TOKEN', 'GITHUB_PAT']);
});

test('resolveGitProviderToken: scoped 未命中时回退环境变量', async () => {
  const key = 'GITLAB_TOKEN';
  const backup = process.env[key];
  try {
    process.env[key] = '  env-token  ';
    const token = await resolveGitProviderToken(
      'gitlab',
      {},
      {
        resolveScopedValue: async () => null,
      },
    );
    assert.equal(token, 'env-token');
  } finally {
    if (backup === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = backup;
    }
  }
});

test('resolveGitProviderToken: 所有来源均缺失时返回空串', async () => {
  const token = await resolveGitProviderToken(
    'gitea',
    {},
    {
      resolveScopedValue: async () => null,
    },
  );
  assert.equal(token, '');
});
