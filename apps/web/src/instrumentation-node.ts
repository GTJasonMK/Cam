// ============================================================
// Node.js runtime 专用的调度器启动逻辑
// 由 instrumentation.ts 在 NEXT_RUNTIME === 'nodejs' 时动态导入
// 独立文件确保 webpack 在 Edge 编译时不会追踪本模块的依赖链
// （auto-start -> scheduler -> dockerode -> cpu-features 等原生模块）
// ============================================================

import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';
import { ensureVibecodingTaskTemplatesSynced } from '@/lib/db/vibecoding-sync';

// 构建阶段不启动，避免 setInterval 挂住 next build 进程
const phase = process.env.NEXT_PHASE || '';
const isBuildPhase =
  phase.includes('build') || process.argv.some((arg) => arg.includes('build'));

if (!isBuildPhase) {
  try {
    void ensureVibecodingTaskTemplatesSynced().catch((error) => {
      console.error('[instrumentation] vibecoding 启动同步失败:', error);
    });
    ensureSchedulerStarted();
  } catch (error) {
    console.error('[instrumentation] 启动调度器失败:', error);
  }
}
