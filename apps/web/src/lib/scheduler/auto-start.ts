// ============================================================
// 调度器自动启动
// 在服务端模块首次加载时启动 15 秒间隔的调度循环
// 通过在 SSE stream route 中 import 本模块来确保尽早加载
// ============================================================

import { runSchedulerTick } from '@/lib/scheduler';
import { recoverDanglingRunningTasksOnStartup } from '@/lib/scheduler';

const SCHEDULER_INTERVAL_MS = 15_000;

let started = false;
let startedAt: string | null = null;
let intervalId: NodeJS.Timeout | null = null;

/** 启动调度器定时循环（幂等，重复调用无副作用） */
export function ensureSchedulerStarted(): void {
  if (started) return;
  started = true;
  startedAt = new Date().toISOString();

  console.log(`[Scheduler] 自动启动调度循环，间隔 ${SCHEDULER_INTERVAL_MS / 1000} 秒`);

  // 启动恢复：避免服务重启后 running 任务长期卡死
  recoverDanglingRunningTasksOnStartup()
    .then((result) => {
      if (result.scanned > 0) {
        console.log(
          `[Scheduler] 启动恢复完成: scanned=${result.scanned}, requeued=${result.recoveredToQueued}, failed=${result.markedFailed}`
        );
      }
    })
    .catch((err) => {
      console.error('[Scheduler] 启动恢复异常:', err);
    });

  // 立即执行一次
  runSchedulerTick().catch((err) => {
    console.error('[Scheduler] 首次调度执行异常:', err);
  });

  // 设置定时器
  intervalId = setInterval(() => {
    runSchedulerTick().catch((err) => {
      console.error('[Scheduler] 定时调度执行异常:', err);
    });
  }, SCHEDULER_INTERVAL_MS);
}

export function getSchedulerRuntimeStatus(): {
  started: boolean;
  startedAt: string | null;
  intervalMs: number;
  hasTimer: boolean;
} {
  return {
    started,
    startedAt,
    intervalMs: SCHEDULER_INTERVAL_MS,
    hasTimer: Boolean(intervalId),
  };
}
