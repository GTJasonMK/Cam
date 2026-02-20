// ============================================================
// WSL (Windows Subsystem for Linux) 运行时工具
// 提供 Windows ↔ WSL 路径转换、环境检测等基础能力
// ============================================================

import { execFileSync } from 'node:child_process';

/** 当前进程是否运行在 Windows 上 */
export const IS_WINDOWS = process.platform === 'win32';

/**
 * Windows 路径 → WSL 路径
 *
 * 例：E:\Code\Cam → /mnt/e/Code/Cam
 *     C:\Users\john\project → /mnt/c/Users/john/project
 *
 * 非 Windows 格式的路径原样返回。
 */
export function toWSLPath(windowsPath: string): string {
  const m = windowsPath.match(/^([A-Za-z]):[\\\/](.*)/);
  if (!m) return windowsPath;
  const drive = m[1].toLowerCase();
  const rest = m[2].replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}

/**
 * 构造 WSL 环境变量注入参数
 *
 * 将 env 键值对转为 `['env', 'KEY1=val1', 'KEY2=val2']` 数组，
 * 用作 wsl.exe 命令前缀，确保变量在 WSL 进程内生效。
 *
 * WSLENV 自动转发不可靠，显式 `env` 前缀最稳妥。
 */
export function buildWSLEnvArgs(env: Record<string, string>): string[] {
  const pairs = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  return pairs.length > 0 ? ['env', ...pairs] : [];
}

/**
 * 获取 WSL 默认发行版的 Codex 会话目录（Windows UNC 路径）
 *
 * 流程：
 *   1. 通过 `wsl.exe -e sh -c "echo $HOME"` 获取 WSL 用户主目录
 *   2. 通过 `wsl.exe --list --quiet` 获取默认发行版名称
 *   3. 拼接为 `\\wsl.localhost\<distro><home>/.codex/sessions` UNC 路径
 *
 * 返回 null 表示 WSL 不可用或获取失败。
 * 结果被缓存，避免重复调用 wsl.exe。
 */
let _wslCodexSessionsDirCache: string | null | undefined;

export function getWSLCodexSessionsDir(): string | null {
  if (_wslCodexSessionsDirCache !== undefined) return _wslCodexSessionsDirCache;

  if (!IS_WINDOWS) {
    _wslCodexSessionsDirCache = null;
    return null;
  }

  try {
    const home = execFileSync('wsl.exe', ['-e', 'sh', '-c', 'echo $HOME'], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    // `wsl --list --quiet` 输出的第一行是默认发行版
    const distroRaw = execFileSync('wsl.exe', ['--list', '--quiet'], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    // 输出可能带 UTF-16 BOM 或多行，取第一个非空行
    const distro = distroRaw
      .replace(/\0/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)[0];

    if (!home || !distro) {
      _wslCodexSessionsDirCache = null;
      return null;
    }

    // Windows UNC 路径，可直接用 Node.js fs 访问 WSL 文件
    _wslCodexSessionsDirCache = `\\\\wsl.localhost\\${distro}${home}/.codex/sessions`;
    return _wslCodexSessionsDirCache;
  } catch (err) {
    console.warn('[WSL] 获取 Codex 会话目录失败:', err);
    _wslCodexSessionsDirCache = null;
    return null;
  }
}
