// ============================================================
// 终端相关路径归一化工具
// 统一处理 Windows 输入路径，避免 WSL/Linux 服务端无法识别
// ============================================================

const WINDOWS_DRIVE_PATH_RE = /^([A-Za-z]):(?:[\\/](.*))?$/;
const WSL_UNC_PATH_RE = /^\\\\wsl\$\\[^\\]+\\(.+)$/i;

/**
 * 归一化用户输入路径：
 * - Linux/WSL 下将 `E:\Code\Cam` / `E:/Code/Cam` 转为 `/mnt/e/Code/Cam`
 * - Linux/WSL 下将 `\\wsl$\Distro\home\user\repo` 转为 `/home/user/repo`
 * - 其他情况返回 trim 后原值
 */
export function normalizeHostPathInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  // 仅在非 Windows 环境做 Windows 路径转译；Windows 原生环境保持原样。
  if (process.platform === 'win32') {
    return trimmed;
  }

  const driveMatch = trimmed.match(WINDOWS_DRIVE_PATH_RE);
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    const rest = (driveMatch[2] || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    return rest ? `/mnt/${drive}/${rest}` : `/mnt/${drive}`;
  }

  const wslUncMatch = trimmed.match(WSL_UNC_PATH_RE);
  if (wslUncMatch) {
    const rest = wslUncMatch[1].replace(/\\/g, '/').replace(/^\/+/, '');
    return `/${rest}`;
  }

  return trimmed;
}
