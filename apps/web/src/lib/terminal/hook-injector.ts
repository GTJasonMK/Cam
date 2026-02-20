// ============================================================
// Agent 完成 Hook 注入器
// 为 Claude Code 注入 Stop hook，实现流水线步骤完成检测
// 其他 Agent（Codex、Aider）回退到 autoExit 模式
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/** Hook 注入结果 */
export interface HookInjectionResult {
  /** 是否成功注入 hook（true 表示使用 hook 检测，false 回退到 autoExit） */
  hooked: boolean;
  /** 清理函数：恢复原始配置文件 */
  cleanup: () => Promise<void>;
}

/**
 * 为流水线步骤注入完成检测 hook
 *
 * Claude Code：在项目目录 .claude/settings.local.json 注入 Stop hook，
 * 当 Claude 完成响应时自动 POST 回调通知服务器。
 *
 * 其他 Agent：返回 hooked=false，调用方应使用 autoExit 模式。
 */
export async function injectCompletionHook(opts: {
  agentDefinitionId: string;
  /** 项目目录（.claude/settings.local.json 所在上级） */
  repoPath: string;
  /** 服务器监听端口 */
  serverPort: number;
  /** 一次性回调令牌 */
  callbackToken: string;
  pipelineId: string;
  taskId: string;
}): Promise<HookInjectionResult> {
  const noop: HookInjectionResult = { hooked: false, cleanup: async () => {} };

  // 仅 Claude Code 支持 Stop hook
  if (opts.agentDefinitionId !== 'claude-code') {
    return noop;
  }

  const settingsDir = path.join(opts.repoPath, '.claude');
  const settingsPath = path.join(settingsDir, 'settings.local.json');

  // 读取原始配置（用于恢复）
  let originalContent: string | null = null;
  let settings: Record<string, unknown> = {};
  try {
    originalContent = await readFile(settingsPath, 'utf-8');
    settings = JSON.parse(originalContent);
  } catch {
    // 文件不存在或解析失败，使用空配置
  }

  // 构造 HTTP 回调命令（使用 Node.js 内置 http 模块，跨平台兼容）
  const payload = JSON.stringify({
    token: opts.callbackToken,
    pipelineId: opts.pipelineId,
    taskId: opts.taskId,
  });
  // 转义单引号，防止 shell 注入
  const safePayload = payload.replace(/'/g, "'\\''");

  const callbackCommand = [
    'node',
    '-e',
    `"require('http').request('http://127.0.0.1:${opts.serverPort}/api/terminal/step-done',`
    + `{method:'POST',headers:{'Content-Type':'application/json'}},()=>{}).on('error',()=>{}).end('${safePayload}')"`,
  ].join(' ');

  // 合并 Stop hook（保留用户已有的 hook 配置）
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const existingStop = Array.isArray(hooks.Stop) ? [...hooks.Stop] : [];

  existingStop.push({
    type: 'command',
    command: callbackCommand,
  });

  hooks.Stop = existingStop;
  settings.hooks = hooks;

  // 确保 .claude 目录存在并写入配置
  try {
    await mkdir(settingsDir, { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    console.log(`[HookInjector] 已注入 Stop hook: ${settingsPath}`);
  } catch (err) {
    console.warn(`[HookInjector] 注入失败，回退到 autoExit: ${(err as Error).message}`);
    return noop;
  }

  // 清理函数：恢复原始配置
  const cleanup = async () => {
    try {
      if (originalContent !== null) {
        // 恢复原始文件内容
        await writeFile(settingsPath, originalContent, 'utf-8');
      } else {
        // 原始文件不存在 → 读取当前配置，移除我们注入的 hook
        const currentRaw = await readFile(settingsPath, 'utf-8');
        const currentSettings = JSON.parse(currentRaw) as Record<string, unknown>;
        const currentHooks = currentSettings.hooks as Record<string, unknown[]> | undefined;

        if (currentHooks?.Stop && Array.isArray(currentHooks.Stop)) {
          // 移除包含 step-done 回调的 hook 条目
          currentHooks.Stop = currentHooks.Stop.filter(
            (h) => typeof h === 'object' && h !== null
              && !(h as Record<string, string>).command?.includes('/api/terminal/step-done'),
          );
          if (currentHooks.Stop.length === 0) delete currentHooks.Stop;
          if (Object.keys(currentHooks).length === 0) delete currentSettings.hooks;
        }

        await writeFile(settingsPath, JSON.stringify(currentSettings, null, 2), 'utf-8');
      }
      console.log(`[HookInjector] 已清理 Stop hook: ${settingsPath}`);
    } catch {
      // 清理失败不影响主流程
    }
  };

  return { hooked: true, cleanup };
}
