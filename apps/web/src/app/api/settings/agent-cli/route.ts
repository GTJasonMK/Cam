// ============================================================
// API: Agent CLI 部署与状态检测
// GET  /api/settings/agent-cli  - 检测 Claude Code / Codex CLI 是否可用
// GET  /api/settings/agent-cli?mode=preflight - 部署前自检（npm/权限/网络/CLI 状态）
// POST /api/settings/agent-cli  - 一键部署（npm -g）
// ============================================================

import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

export const runtime = 'nodejs';

type CliId = 'claude-code' | 'codex';
type DeployTarget = 'all' | CliId;

type CliConfig = {
  id: CliId;
  label: string;
  command: string;
  packageName: string;
};

type CommandExecResult = {
  ok: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  errorMessage?: string;
};

type PreflightCheckStatus = 'pass' | 'warn' | 'fail';

type PreflightCheck = {
  id: string;
  label: string;
  status: PreflightCheckStatus;
  detail: string;
  suggestion?: string;
};

const CLI_CONFIGS: CliConfig[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    command: 'claude',
    packageName: '@anthropic-ai/claude-code',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    command: 'codex',
    packageName: '@openai/codex',
  },
];

const COMMAND_TIMEOUT_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 15_000;
const LOG_TAIL_MAX = 8_000;

function trimLogTail(input: string, max = LOG_TAIL_MAX): string {
  if (input.length <= max) return input;
  return input.slice(input.length - max);
}

function pickFirstLineFromOutput(stdout: string, stderr: string): string | null {
  const text = `${stdout}\n${stderr}`.trim();
  if (!text) return null;
  const firstLine = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || null;
}

function execCommand(
  file: string,
  args: string[],
  options?: { timeoutMs?: number }
): Promise<CommandExecResult> {
  const timeoutMs = options?.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(file, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let finished = false;
    const timeout = setTimeout(() => {
      if (!finished) {
        child.kill('SIGTERM');
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve({
        ok: false,
        code: null,
        signal: null,
        stdout: trimLogTail(stdout),
        stderr: trimLogTail(stderr),
        durationMs: Date.now() - startedAt,
        errorMessage: err.message,
      });
    });

    child.on('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        code,
        signal,
        stdout: trimLogTail(stdout),
        stderr: trimLogTail(stderr),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function detectCliStatus(cli: CliConfig) {
  const probe = await execCommand(cli.command, ['--version'], { timeoutMs: PROBE_TIMEOUT_MS });
  const version = probe.ok ? pickFirstLineFromOutput(probe.stdout, probe.stderr) : null;
  return {
    id: cli.id,
    label: cli.label,
    command: cli.command,
    packageName: cli.packageName,
    installed: probe.ok,
    version,
    detail: probe.ok ? null : (probe.errorMessage || pickFirstLineFromOutput(probe.stdout, probe.stderr)),
  };
}

function normalizeInlineText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function getNpmBinary(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function getWritePermissionSuggestion(prefix: string): string {
  if (process.platform === 'win32') {
    return `请使用管理员权限终端，或为目录 ${prefix} 赋予写权限。`;
  }
  return `请使用可写目录作为 npm 全局前缀，或使用具备权限的账号执行安装。`;
}

async function probeNpmRegistry(timeoutMs = PROBE_TIMEOUT_MS): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://registry.npmjs.org/-/ping', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const elapsed = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ok: false,
        detail: `访问 npm registry 失败：HTTP ${response.status}（${elapsed}ms）`,
      };
    }
    const bodyText = await response.text().catch(() => '');
    const preview = normalizeInlineText(bodyText).slice(0, 120);
    return {
      ok: true,
      detail: preview ? `可访问（${elapsed}ms）：${preview}` : `可访问（${elapsed}ms）`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `访问 npm registry 异常：${message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function runPreflightChecks() {
  const checks: PreflightCheck[] = [];
  const npmBin = getNpmBinary();

  const npmVersionProbe = await execCommand(npmBin, ['--version'], { timeoutMs: PROBE_TIMEOUT_MS });
  const npmVersion = npmVersionProbe.ok
    ? pickFirstLineFromOutput(npmVersionProbe.stdout, npmVersionProbe.stderr)
    : null;
  const npmAvailable = npmVersionProbe.ok;

  if (npmAvailable) {
    checks.push({
      id: 'npm-binary',
      label: 'npm 可执行性',
      status: 'pass',
      detail: `已检测到 npm，可用版本：${npmVersion || '未知'}`,
    });
  } else {
    checks.push({
      id: 'npm-binary',
      label: 'npm 可执行性',
      status: 'fail',
      detail: npmVersionProbe.errorMessage || pickFirstLineFromOutput(npmVersionProbe.stdout, npmVersionProbe.stderr) || '未检测到 npm 命令',
      suggestion: '请先安装 Node.js / npm，并确保 npm 在系统 PATH 中。',
    });
  }

  let globalPrefix: string | null = null;
  let globalPrefixWritable = false;
  if (npmAvailable) {
    const prefixProbe = await execCommand(npmBin, ['prefix', '-g'], { timeoutMs: PROBE_TIMEOUT_MS });
    if (prefixProbe.ok) {
      const prefixLine = pickFirstLineFromOutput(prefixProbe.stdout, prefixProbe.stderr);
      globalPrefix = prefixLine ? prefixLine.trim() : null;
      if (globalPrefix) {
        try {
          await access(globalPrefix, fsConstants.W_OK);
          globalPrefixWritable = true;
          checks.push({
            id: 'npm-global-prefix',
            label: 'npm 全局目录权限',
            status: 'pass',
            detail: `目录可写：${globalPrefix}`,
          });
        } catch {
          checks.push({
            id: 'npm-global-prefix',
            label: 'npm 全局目录权限',
            status: 'fail',
            detail: `目录不可写：${globalPrefix}`,
            suggestion: getWritePermissionSuggestion(globalPrefix),
          });
        }
      } else {
        checks.push({
          id: 'npm-global-prefix',
          label: 'npm 全局目录权限',
          status: 'warn',
          detail: '已执行 npm prefix -g，但未返回有效目录。',
          suggestion: '请手工执行 `npm prefix -g` 并确认返回值。',
        });
      }
    } else {
      checks.push({
        id: 'npm-global-prefix',
        label: 'npm 全局目录权限',
        status: 'warn',
        detail: prefixProbe.errorMessage || pickFirstLineFromOutput(prefixProbe.stdout, prefixProbe.stderr) || '无法获取 npm 全局目录',
        suggestion: '请手工执行 `npm prefix -g` 检查 npm 全局目录配置。',
      });
    }
  } else {
    checks.push({
      id: 'npm-global-prefix',
      label: 'npm 全局目录权限',
      status: 'warn',
      detail: '由于 npm 不可用，已跳过权限检查。',
      suggestion: '先修复 npm 可执行性，再重新运行部署前自检。',
    });
  }

  if (npmAvailable) {
    const registryProbe = await probeNpmRegistry();
    checks.push({
      id: 'npm-network',
      label: 'npm registry 网络连通性',
      status: registryProbe.ok ? 'pass' : 'fail',
      detail: registryProbe.detail,
      suggestion: registryProbe.ok ? undefined : '请检查服务器网络策略、代理设置和防火墙规则。',
    });
  } else {
    checks.push({
      id: 'npm-network',
      label: 'npm registry 网络连通性',
      status: 'warn',
      detail: '由于 npm 不可用，已跳过网络检查。',
      suggestion: '先修复 npm 可执行性，再重新运行部署前自检。',
    });
  }

  const statuses = await Promise.all(CLI_CONFIGS.map((cli) => detectCliStatus(cli)));
  for (const status of statuses) {
    checks.push({
      id: `cli-${status.id}`,
      label: `${status.label} 当前状态`,
      status: status.installed ? 'pass' : 'warn',
      detail: status.installed
        ? `已安装，版本：${status.version || '未知'}`
        : `未安装${status.detail ? `（${status.detail}）` : ''}`,
      suggestion: status.installed ? undefined : `可在设置页点击“部署 ${status.label}”进行安装。`,
    });
  }

  const failCount = checks.filter((item) => item.status === 'fail').length;
  const warnCount = checks.filter((item) => item.status === 'warn').length;

  return {
    summary: {
      readyForDeploy: failCount === 0,
      failCount,
      warnCount,
      checkedAt: new Date().toISOString(),
    },
    npm: {
      available: npmAvailable,
      version: npmVersion,
      binary: npmBin,
      globalPrefix,
      globalPrefixWritable,
    },
    checks,
    statuses,
  };
}

async function handleGet(request: AuthenticatedRequest) {
  try {
    const mode = request.nextUrl.searchParams.get('mode');
    if (mode === 'preflight') {
      const preflight = await runPreflightChecks();
      return NextResponse.json({ success: true, data: preflight });
    }

    const statuses = await Promise.all(CLI_CONFIGS.map((cli) => detectCliStatus(cli)));
    return NextResponse.json({ success: true, data: { statuses } });
  } catch (err) {
    console.error('[API] 获取 Agent CLI 状态失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '获取 Agent CLI 状态失败' } },
      { status: 500 }
    );
  }
}

function resolveTargetList(target: DeployTarget): CliConfig[] {
  if (target === 'all') return CLI_CONFIGS;
  return CLI_CONFIGS.filter((item) => item.id === target);
}

async function installCli(cli: CliConfig) {
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const installResult = await execCommand(npmBin, ['install', '-g', cli.packageName], {
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  const statusAfter = await detectCliStatus(cli);
  return {
    id: cli.id,
    label: cli.label,
    packageName: cli.packageName,
    install: {
      ok: installResult.ok,
      code: installResult.code,
      signal: installResult.signal,
      durationMs: installResult.durationMs,
      stdoutTail: installResult.stdout,
      stderrTail: installResult.stderr,
      errorMessage: installResult.errorMessage || null,
    },
    statusAfter,
  };
}

async function handlePost(request: AuthenticatedRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawTarget = typeof body.target === 'string' ? body.target : 'all';
    const target = (rawTarget === 'all' || rawTarget === 'claude-code' || rawTarget === 'codex')
      ? rawTarget
      : 'all';

    const targetList = resolveTargetList(target as DeployTarget);
    if (targetList.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: '无效的部署目标' } },
        { status: 400 }
      );
    }

    const results = [];
    for (const cli of targetList) {
      // 顺序执行，避免 npm 全局安装锁冲突
      const one = await installCli(cli);
      results.push(one);
    }

    const statuses = await Promise.all(CLI_CONFIGS.map((cli) => detectCliStatus(cli)));
    const allOk = results.every((item) => item.install.ok && item.statusAfter.installed);

    return NextResponse.json({
      success: true,
      data: {
        target,
        allOk,
        results,
        statuses,
      },
    });
  } catch (err) {
    console.error('[API] 部署 Agent CLI 失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '部署 Agent CLI 失败' } },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handleGet, 'settings:manage');
export const POST = withAuth(handlePost, 'settings:manage');
