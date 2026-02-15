import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitRepository, parsePullRequestUrl } from './provider.ts';

test('parseGitRepository: 支持 GitHub/GitLab/Gitea 仓库地址', () => {
  const github = parseGitRepository('https://github.com/openai/codex-cli.git');
  assert.deepEqual(github && { provider: github.provider, projectPath: github.projectPath }, {
    provider: 'github',
    projectPath: 'openai/codex-cli',
  });

  const gitlab = parseGitRepository('git@gitlab.com:group/subgroup/project.git');
  assert.deepEqual(gitlab && { provider: gitlab.provider, projectPath: gitlab.projectPath }, {
    provider: 'gitlab',
    projectPath: 'group/subgroup/project',
  });

  const gitea = parseGitRepository('https://gitea.example.com/team/repo.git');
  assert.deepEqual(gitea && { provider: gitea.provider, projectPath: gitea.projectPath }, {
    provider: 'gitea',
    projectPath: 'team/repo',
  });
});

test('parsePullRequestUrl: 解析 GitHub/GitLab/Gitea 链接', () => {
  const gh = parsePullRequestUrl('https://github.com/openai/codex-cli/pull/128');
  assert.deepEqual(gh && { provider: gh.provider, number: gh.number, projectPath: gh.projectPath }, {
    provider: 'github',
    number: 128,
    projectPath: 'openai/codex-cli',
  });

  const gl = parsePullRequestUrl('https://gitlab.com/group/subgroup/project/-/merge_requests/23');
  assert.deepEqual(gl && { provider: gl.provider, number: gl.number, projectPath: gl.projectPath }, {
    provider: 'gitlab',
    number: 23,
    projectPath: 'group/subgroup/project',
  });

  const gitea = parsePullRequestUrl('https://gitea.example.com/team/repo/pulls/9');
  assert.deepEqual(gitea && { provider: gitea.provider, number: gitea.number, projectPath: gitea.projectPath }, {
    provider: 'gitea',
    number: 9,
    projectPath: 'team/repo',
  });
});

test('parseGitRepository / parsePullRequestUrl: 非法输入返回 null', () => {
  assert.equal(parseGitRepository(''), null);
  assert.equal(parseGitRepository('not-a-url'), null);
  assert.equal(parsePullRequestUrl('https://example.com/no/pr/path'), null);
  assert.equal(parsePullRequestUrl('not-a-url'), null);
});
