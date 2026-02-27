import 'server-only';

import os from 'node:os';
import path from 'node:path';
import { readFile, statfs } from 'node:fs/promises';
import { and, eq, isNotNull, like, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tasks, terminalSessionPool, workers } from '@/lib/db/schema';
import { isSqliteMissingSchemaError } from '@/lib/db/sqlite-errors';
import { agentSessionManager } from '@/lib/terminal/agent-session-manager';
import type {
  MonitoringHistoryPoint,
  MonitoringOverview,
  MonitoringSnapshot,
  MonitoringSystemInfo,
} from './types';

const SAMPLE_MIN_INTERVAL_MS = 2_000;
const DEFAULT_HISTORY_WINDOW_MINUTES = 30;
const MAX_HISTORY_WINDOW_MINUTES = 12 * 60;
const HISTORY_CAPACITY = 2_160;

const ACTIVE_TASK_STATUSES = new Set(['draft', 'queued', 'waiting', 'running', 'awaiting_review']);

type CpuTimes = {
  idle: number;
  total: number;
};

type NetTotals = {
  rxTotalBytes: number;
  txTotalBytes: number;
};

type HistoryPointInternal = MonitoringHistoryPoint & {
  timestampMs: number;
};

type MonitorState = {
  startedAt: string;
  monitorPath: string;
  lastCpuTimes: CpuTimes | null;
  lastNetTotals: (NetTotals & { sampledAtMs: number }) | null;
  latest: MonitoringSnapshot | null;
  history: HistoryPointInternal[];
  lastSampledAtMs: number;
};

declare global {
  var __camMonitoringState: MonitorState | undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function toPercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return clamp((numerator / denominator) * 100, 0, 100);
}

function readCpuTimes(): CpuTimes {
  const cpuList = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpuList) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }

  return { idle, total };
}

async function readLinuxNetworkTotals(): Promise<NetTotals | null> {
  try {
    const content = await readFile('/proc/net/dev', 'utf8');
    const lines = content.split('\n').slice(2).map((line) => line.trim()).filter(Boolean);

    let rxTotalBytes = 0;
    let txTotalBytes = 0;

    for (const line of lines) {
      const [ifaceRaw, valuesRaw] = line.split(':');
      if (!ifaceRaw || !valuesRaw) continue;

      const iface = ifaceRaw.trim();
      if (!iface || iface === 'lo') continue;

      const values = valuesRaw.trim().split(/\s+/);
      if (values.length < 16) continue;

      const rx = Number(values[0]);
      const tx = Number(values[8]);
      if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;

      rxTotalBytes += rx;
      txTotalBytes += tx;
    }

    return { rxTotalBytes, txTotalBytes };
  } catch {
    return null;
  }
}

async function readDiskUsage(targetPath: string): Promise<{
  totalBytes: number;
  usedBytes: number;
  usagePercent: number;
} | null> {
  try {
    const stats = await statfs(targetPath);
    const blockSize = asNumber(stats.bsize);
    const totalBlocks = asNumber(stats.blocks);
    const freeBlocks = asNumber(stats.bavail);

    const totalBytes = totalBlocks * blockSize;
    const freeBytes = freeBlocks * blockSize;
    const usedBytes = Math.max(0, totalBytes - freeBytes);

    return {
      totalBytes,
      usedBytes,
      usagePercent: toPercent(usedBytes, totalBytes),
    };
  } catch {
    return null;
  }
}

async function safeQuery<T>(factory: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await factory();
  } catch (error) {
    if (isSqliteMissingSchemaError(error)) {
      return fallback;
    }
    throw error;
  }
}

async function collectAppSnapshot(): Promise<MonitoringSnapshot['app']> {
  const [taskRows, workerRows, terminalPipelineRows, managedPoolCount] = await Promise.all([
    safeQuery(
      () =>
        db
          .select({
            status: tasks.status,
            count: sql<number>`cast(count(*) as integer)`,
          })
          .from(tasks)
          .groupBy(tasks.status),
      [] as Array<{ status: string; count: number }>,
    ),
    safeQuery(
      () =>
        db
          .select({
            status: workers.status,
            count: sql<number>`cast(count(*) as integer)`,
          })
          .from(workers)
          .groupBy(workers.status),
      [] as Array<{ status: string; count: number }>,
    ),
    safeQuery(
      () =>
        db
          .select({
            groupId: tasks.groupId,
            status: tasks.status,
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.source, 'terminal'),
              isNotNull(tasks.groupId),
              like(tasks.groupId, 'pipeline/%'),
            ),
          ),
      [] as Array<{ groupId: string | null; status: string }>,
    ),
    safeQuery(
      async () => {
        const rows = await db
          .select({
            count: sql<number>`cast(count(*) as integer)`,
          })
          .from(terminalSessionPool);
        return rows[0]?.count ?? 0;
      },
      0,
    ),
  ]);

  const taskMap: Record<string, number> = {};
  for (const row of taskRows) {
    taskMap[row.status] = row.count;
  }

  const workerMap: Record<string, number> = {};
  for (const row of workerRows) {
    workerMap[row.status] = row.count;
  }

  const pipelineState = new Map<string, { active: boolean }>();
  for (const row of terminalPipelineRows) {
    if (!row.groupId) continue;
    const current = pipelineState.get(row.groupId) || { active: false };
    if (ACTIVE_TASK_STATUSES.has(row.status)) {
      current.active = true;
    }
    pipelineState.set(row.groupId, current);
  }

  const sessionSummaries = agentSessionManager.getSessionSummaries();
  const activeSessions = sessionSummaries.filter((item) => item.status === 'running').length;

  return {
    tasks: {
      total: Object.values(taskMap).reduce((sum, value) => sum + value, 0),
      draft: taskMap.draft || 0,
      queued: taskMap.queued || 0,
      waiting: taskMap.waiting || 0,
      running: taskMap.running || 0,
      awaitingReview: taskMap.awaiting_review || 0,
      completed: taskMap.completed || 0,
      failed: taskMap.failed || 0,
      cancelled: taskMap.cancelled || 0,
    },
    workers: {
      total: Object.values(workerMap).reduce((sum, value) => sum + value, 0),
      idle: workerMap.idle || 0,
      busy: workerMap.busy || 0,
      draining: workerMap.draining || 0,
      offline: workerMap.offline || 0,
    },
    runtime: {
      totalSessions: sessionSummaries.length,
      activeSessions,
      totalPipelines: pipelineState.size,
      activePipelines: Array.from(pipelineState.values()).filter((item) => item.active).length,
      managedSessionPoolSize: managedPoolCount,
    },
  };
}

function buildHistoryPoint(snapshot: MonitoringSnapshot): HistoryPointInternal {
  const timestampMs = Date.parse(snapshot.timestamp);
  return {
    timestamp: snapshot.timestamp,
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : Date.now(),
    cpuUsagePercent: snapshot.system.cpuUsagePercent,
    memoryUsagePercent: snapshot.system.memoryUsagePercent,
    diskUsagePercent: snapshot.system.diskUsagePercent,
    networkRxBytesPerSec: snapshot.system.networkRxBytesPerSec,
    networkTxBytesPerSec: snapshot.system.networkTxBytesPerSec,
    runningTasks: snapshot.app.tasks.running,
    activeWorkers: snapshot.app.workers.busy,
    activeSessions: snapshot.app.runtime.activeSessions,
  };
}

function resolveMonitorPath(): string {
  const raw = (process.env.MONITOR_DISK_PATH || '').trim();
  if (raw) {
    return path.resolve(raw);
  }

  const dbPath = (process.env.DATABASE_PATH || '').trim();
  if (dbPath) {
    return path.dirname(path.resolve(dbPath));
  }

  return process.cwd();
}

function createState(): MonitorState {
  return {
    startedAt: new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString(),
    monitorPath: resolveMonitorPath(),
    lastCpuTimes: null,
    lastNetTotals: null,
    latest: null,
    history: [],
    lastSampledAtMs: 0,
  };
}

function getState(): MonitorState {
  if (!globalThis.__camMonitoringState) {
    globalThis.__camMonitoringState = createState();
  }
  return globalThis.__camMonitoringState;
}

async function sampleSnapshot(state: MonitorState): Promise<MonitoringSnapshot> {
  const nowMs = Date.now();
  const timestamp = new Date(nowMs).toISOString();

  const cpuTimes = readCpuTimes();
  let cpuUsagePercent = 0;

  if (state.lastCpuTimes) {
    const totalDelta = cpuTimes.total - state.lastCpuTimes.total;
    const idleDelta = cpuTimes.idle - state.lastCpuTimes.idle;
    if (totalDelta > 0) {
      cpuUsagePercent = clamp((1 - idleDelta / totalDelta) * 100, 0, 100);
    }
  }
  state.lastCpuTimes = cpuTimes;

  const memoryTotalBytes = os.totalmem();
  const memoryUsedBytes = Math.max(0, memoryTotalBytes - os.freemem());
  const memoryUsagePercent = toPercent(memoryUsedBytes, memoryTotalBytes);
  const disk = await readDiskUsage(state.monitorPath);

  const currentNet = await readLinuxNetworkTotals();
  let networkRxBytesPerSec = 0;
  let networkTxBytesPerSec = 0;
  let networkRxTotalBytes = state.lastNetTotals?.rxTotalBytes ?? 0;
  let networkTxTotalBytes = state.lastNetTotals?.txTotalBytes ?? 0;

  if (currentNet) {
    networkRxTotalBytes = currentNet.rxTotalBytes;
    networkTxTotalBytes = currentNet.txTotalBytes;

    if (state.lastNetTotals) {
      const elapsedSec = (nowMs - state.lastNetTotals.sampledAtMs) / 1000;
      if (elapsedSec > 0) {
        networkRxBytesPerSec = Math.max(
          0,
          Math.round((currentNet.rxTotalBytes - state.lastNetTotals.rxTotalBytes) / elapsedSec),
        );
        networkTxBytesPerSec = Math.max(
          0,
          Math.round((currentNet.txTotalBytes - state.lastNetTotals.txTotalBytes) / elapsedSec),
        );
      }
    }

    state.lastNetTotals = {
      ...currentNet,
      sampledAtMs: nowMs,
    };
  }

  const processMemory = process.memoryUsage();
  const app = await collectAppSnapshot();

  return {
    timestamp,
    system: {
      cpuUsagePercent: Number(cpuUsagePercent.toFixed(2)),
      loadAvg1m: Number(os.loadavg()[0].toFixed(2)),
      loadAvg5m: Number(os.loadavg()[1].toFixed(2)),
      loadAvg15m: Number(os.loadavg()[2].toFixed(2)),
      memoryTotalBytes,
      memoryUsedBytes,
      memoryUsagePercent: Number(memoryUsagePercent.toFixed(2)),
      diskTotalBytes: disk?.totalBytes ?? null,
      diskUsedBytes: disk?.usedBytes ?? null,
      diskUsagePercent: disk ? Number(disk.usagePercent.toFixed(2)) : null,
      networkRxTotalBytes,
      networkTxTotalBytes,
      networkRxBytesPerSec,
      networkTxBytesPerSec,
      processUptimeSec: Math.round(process.uptime()),
      processRssBytes: processMemory.rss,
      processHeapUsedBytes: processMemory.heapUsed,
      processHeapTotalBytes: processMemory.heapTotal,
    },
    app,
  };
}

async function ensureLatestSnapshot(state: MonitorState): Promise<MonitoringSnapshot> {
  const nowMs = Date.now();
  if (state.latest && nowMs - state.lastSampledAtMs < SAMPLE_MIN_INTERVAL_MS) {
    return state.latest;
  }

  const snapshot = await sampleSnapshot(state);
  state.latest = snapshot;
  state.lastSampledAtMs = nowMs;
  state.history.push(buildHistoryPoint(snapshot));

  if (state.history.length > HISTORY_CAPACITY) {
    state.history.splice(0, state.history.length - HISTORY_CAPACITY);
  }

  return snapshot;
}

function getSystemInfo(state: MonitorState): MonitoringSystemInfo {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    nodeVersion: process.version,
    pid: process.pid,
    monitorPath: state.monitorPath,
    startedAt: state.startedAt,
  };
}

export async function getMonitoringOverview(options?: { historyWindowMinutes?: number }): Promise<MonitoringOverview> {
  const state = getState();
  const current = await ensureLatestSnapshot(state);

  const historyWindowMinutes = clamp(
    Math.floor(options?.historyWindowMinutes || DEFAULT_HISTORY_WINDOW_MINUTES),
    5,
    MAX_HISTORY_WINDOW_MINUTES,
  );

  const nowMs = Date.now();
  const sinceMs = nowMs - historyWindowMinutes * 60 * 1000;
  const history = state.history
    .filter((point) => point.timestampMs >= sinceMs)
    .map((point) => ({
      timestamp: point.timestamp,
      cpuUsagePercent: point.cpuUsagePercent,
      memoryUsagePercent: point.memoryUsagePercent,
      diskUsagePercent: point.diskUsagePercent,
      networkRxBytesPerSec: point.networkRxBytesPerSec,
      networkTxBytesPerSec: point.networkTxBytesPerSec,
      runningTasks: point.runningTasks,
      activeWorkers: point.activeWorkers,
      activeSessions: point.activeSessions,
    }));

  return {
    systemInfo: getSystemInfo(state),
    current,
    history,
    historyWindowMinutes,
    sampleIntervalMs: SAMPLE_MIN_INTERVAL_MS,
  };
}
