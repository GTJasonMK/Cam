import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitHubRepo, parseGitHubPullRequestUrl } from './github.ts';

test('parseGitHubRepo: 支持 https / ssh / .git', () => {
  assert.deepEqual(parseGitHubRepo('https://github.com/openai/codex-cli'), {
    owner: 'openai',
    repo: 'codex-cli',
  });
  assert.deepEqual(parseGitHubRepo('git@github.com:openai/codex-cli.git'), {
    owner: 'openai',
    repo: 'codex-cli',
  });
  assert.deepEqual(parseGitHubRepo('ssh://git@github.com/openai/codex-cli.git'), {
    owner: 'openai',
    repo: 'codex-cli',
  });
});

test('parseGitHubRepo: 非 github 地址返回 null', () => {
  assert.equal(parseGitHubRepo('https://gitlab.com/openai/codex-cli'), null);
  assert.equal(parseGitHubRepo(''), null);
});

test('parseGitHubPullRequestUrl: 解析 PR URL', () => {
  assert.deepEqual(parseGitHubPullRequestUrl('https://github.com/openai/codex-cli/pull/128'), {
    owner: 'openai',
    repo: 'codex-cli',
    number: 128,
  });
});

test('parseGitHubPullRequestUrl: 非法 URL 返回 null', () => {
  assert.equal(parseGitHubPullRequestUrl('https://github.com/openai/codex-cli/issues/128'), null);
  assert.equal(parseGitHubPullRequestUrl('https://github.com/openai/codex-cli/pull/not-number'), null);
});
