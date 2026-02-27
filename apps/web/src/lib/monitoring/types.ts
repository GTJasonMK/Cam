export interface MonitoringSystemInfo {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  nodeVersion: string;
  pid: number;
  monitorPath: string;
  startedAt: string;
}

export interface MonitoringSnapshot {
  timestamp: string;
  system: {
    cpuUsagePercent: number;
    loadAvg1m: number;
    loadAvg5m: number;
    loadAvg15m: number;
    memoryTotalBytes: number;
    memoryUsedBytes: number;
    memoryUsagePercent: number;
    diskTotalBytes: number | null;
    diskUsedBytes: number | null;
    diskUsagePercent: number | null;
    networkRxTotalBytes: number;
    networkTxTotalBytes: number;
    networkRxBytesPerSec: number;
    networkTxBytesPerSec: number;
    processUptimeSec: number;
    processRssBytes: number;
    processHeapUsedBytes: number;
    processHeapTotalBytes: number;
  };
  app: {
    tasks: {
      total: number;
      draft: number;
      queued: number;
      waiting: number;
      running: number;
      awaitingReview: number;
      completed: number;
      failed: number;
      cancelled: number;
    };
    workers: {
      total: number;
      idle: number;
      busy: number;
      draining: number;
      offline: number;
    };
    runtime: {
      totalSessions: number;
      activeSessions: number;
      totalPipelines: number;
      activePipelines: number;
      managedSessionPoolSize: number;
    };
  };
}

export interface MonitoringHistoryPoint {
  timestamp: string;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  diskUsagePercent: number | null;
  networkRxBytesPerSec: number;
  networkTxBytesPerSec: number;
  runningTasks: number;
  activeWorkers: number;
  activeSessions: number;
}

export interface MonitoringOverview {
  systemInfo: MonitoringSystemInfo;
  current: MonitoringSnapshot;
  history: MonitoringHistoryPoint[];
  historyWindowMinutes: number;
  sampleIntervalMs: number;
}
