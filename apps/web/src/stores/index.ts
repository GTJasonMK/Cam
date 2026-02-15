// ============================================================
// Zustand Store: 全局状态管理
// ============================================================

import { create } from 'zustand';

// ----- 前端使用的类型定义 -----

/** Agent 定义 */
export interface AgentDefinitionItem {
  id: string;
  displayName: string;
  description: string | null;
  dockerImage: string;
  command: string;
  args: string[];
  requiredEnvVars: Array<{ name: string; required: boolean; sensitive?: boolean; description?: string }>;
  capabilities: Record<string, boolean>;
  defaultResourceLimits: { memoryLimitMb: number; timeoutMinutes: number };
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 仓库（Repo Preset） */
export interface RepositoryItem {
  id: string;
  name: string;
  repoUrl: string;
  defaultBaseBranch: string;
  defaultWorkDir: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 任务 */
export interface TaskItem {
  id: string;
  title: string;
  description: string;
  agentDefinitionId: string;
  repoUrl: string;
  baseBranch: string;
  workBranch: string;
  workDir: string | null;
  status: string;
  retryCount: number;
  maxRetries: number;
  dependsOn: string[];
  groupId: string | null;
  assignedWorkerId: string | null;
  prUrl: string | null;
  summary: string | null;
  logFileUrl: string | null;
  reviewComment: string | null;
  reviewedAt: string | null;
  feedback: string | null;
  createdAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/** Worker */
export interface WorkerItem {
  id: string;
  name: string;
  supportedAgentIds: string[];
  status: string;
  currentTaskId: string | null;
  lastHeartbeatAt: string | null;
  cpuUsage: number | null;
  memoryUsageMb: number | null;
  diskUsageMb: number | null;
  totalTasksCompleted: number;
  totalTasksFailed: number;
  registeredAt: string;
}

/** 系统事件 */
export interface SystemEventItem {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/** Agent 运行统计 */
export interface AgentStatItem {
  agentDefinitionId: string;
  displayName: string;
  total: number;
  completed: number;
  failed: number;
  successRate: number | null;
  avgDurationMs: number | null;
}

// ----- Dashboard Store -----
interface DashboardData {
  kpi: {
    totalTasks: number;
    runningTasks: number;
    awaitingReview: number;
    completedTasks: number;
    failedTasks: number;
    queuedTasks: number;
  };
  workerSummary: {
    total: number;
    idle: number;
    busy: number;
    offline: number;
    draining: number;
  };
  workers: WorkerItem[];
  recentEvents: SystemEventItem[];
  agentStats: AgentStatItem[];
  durationSummary: {
    completedAvgDurationMs: number | null;
    completedMaxDurationMs: number | null;
    activeAvgDurationMs: number | null;
    completedSampleCount: number;
    activeSampleCount: number;
  };
  taskStatuses?: Record<string, string>;
}

type DashboardKpiKey = keyof DashboardData['kpi'];

interface DashboardRealtimeEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

const KPI_STATUS_FIELD: Partial<Record<string, DashboardKpiKey>> = {
  running: 'runningTasks',
  awaiting_review: 'awaitingReview',
  completed: 'completedTasks',
  failed: 'failedTasks',
  queued: 'queuedTasks',
};

function toWorkerStatusSummary(workerList: WorkerItem[]): DashboardData['workerSummary'] {
  const summary = { total: workerList.length, idle: 0, busy: 0, offline: 0, draining: 0 };
  for (const worker of workerList) {
    if (worker.status === 'idle') summary.idle += 1;
    else if (worker.status === 'busy') summary.busy += 1;
    else if (worker.status === 'offline') summary.offline += 1;
    else if (worker.status === 'draining') summary.draining += 1;
  }
  return summary;
}

function withRecentEvent(data: DashboardData, event: DashboardRealtimeEvent): DashboardData {
  const payload = event.payload ?? {};
  const taskId = typeof payload.taskId === 'string' ? payload.taskId : '';
  const workerId = typeof payload.workerId === 'string' ? payload.workerId : '';
  const suffix = taskId || workerId || event.timestamp;

  const nextEvent: SystemEventItem = {
    id: `rt-${event.type}-${suffix}`,
    type: event.type,
    payload,
    timestamp: event.timestamp,
  };

  return {
    ...data,
    recentEvents: [nextEvent, ...data.recentEvents].slice(0, 20),
  };
}

interface DashboardStore {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  taskStatuses: Record<string, string>;
  sseConnected: boolean;
  setSseConnected: (connected: boolean) => void;
  fetchDashboard: (options?: { silent?: boolean }) => Promise<void>;
  applyRealtimeEvent: (event: DashboardRealtimeEvent) => boolean;
}

export const useDashboardStore = create<DashboardStore>((set) => ({
  data: null,
  loading: false,
  error: null,
  taskStatuses: {},
  sseConnected: false,

  setSseConnected: (connected) => set({ sseConnected: connected }),

  fetchDashboard: async (options) => {
    if (options?.silent) {
      set({ error: null });
    } else {
      set({ loading: true, error: null });
    }
    try {
      const res = await fetch('/api/dashboard');
      const json = await res.json();
      if (json.success) {
        const payload = json.data as DashboardData;
        const statusMap = payload?.taskStatuses && typeof payload.taskStatuses === 'object'
          ? (payload.taskStatuses as Record<string, string>)
          : {};
        const { taskStatuses: _extractedStatuses, ...rest } = payload;
        void _extractedStatuses;
        set({ data: rest as DashboardData, taskStatuses: statusMap, loading: false });
      } else {
        set({ error: json.error?.message || '获取失败', loading: false });
      }
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  applyRealtimeEvent: (event) => {
    let needReconcile = false;

    set((state) => {
      if (!state.data) {
        needReconcile = true;
        return state;
      }

      let nextData = withRecentEvent(state.data, event);
      let nextTaskStatuses = state.taskStatuses;
      const eventType = event.type;
      const payload = event.payload ?? {};

      const applyTaskStatus = (taskId: string, nextStatus: string) => {
        const prevStatus = nextTaskStatuses[taskId];
        if (prevStatus === nextStatus) return;

        const nextMap = { ...nextTaskStatuses, [taskId]: nextStatus };
        const nextKpi = { ...nextData.kpi };
        const prevField = prevStatus ? KPI_STATUS_FIELD[prevStatus] : undefined;
        const nextField = KPI_STATUS_FIELD[nextStatus];

        if (!prevStatus) {
          nextKpi.totalTasks += 1;
        } else if (prevField && nextKpi[prevField] > 0) {
          nextKpi[prevField] -= 1;
        }

        if (nextField) {
          nextKpi[nextField] += 1;
        }

        nextTaskStatuses = nextMap;
        nextData = { ...nextData, kpi: nextKpi };
      };

      if (eventType === 'task.progress') {
        const taskId = typeof payload.taskId === 'string' ? payload.taskId : '';
        const status = typeof payload.status === 'string' ? payload.status : '';
        if (!taskId || !status) {
          needReconcile = true;
        } else {
          applyTaskStatus(taskId, status);
        }
      } else if (eventType === 'task.started') {
        const taskId = typeof payload.taskId === 'string' ? payload.taskId : '';
        if (!taskId) {
          needReconcile = true;
        } else {
          applyTaskStatus(taskId, 'running');
        }
      }

      if (eventType === 'worker.removed') {
        const workerId = typeof payload.workerId === 'string' ? payload.workerId : '';
        if (!workerId) {
          needReconcile = true;
        } else {
          const workers = nextData.workers.filter((worker) => worker.id !== workerId);
          nextData = {
            ...nextData,
            workers,
            workerSummary: toWorkerStatusSummary(workers),
          };
        }
      } else if (eventType === 'worker.pruned') {
        const workerIds = Array.isArray(payload.workerIds)
          ? payload.workerIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
          : [];
        if (workerIds.length === 0) {
          const removed = typeof payload.removed === 'number' ? payload.removed : 0;
          if (removed > 0) needReconcile = true;
        } else {
          const removeSet = new Set(workerIds);
          const workers = nextData.workers.filter((worker) => !removeSet.has(worker.id));
          nextData = {
            ...nextData,
            workers,
            workerSummary: toWorkerStatusSummary(workers),
          };
        }
      } else if (
        eventType === 'worker.online' ||
        eventType === 'worker.offline' ||
        eventType === 'worker.heartbeat' ||
        eventType === 'worker.status_changed'
      ) {
        const workerId = typeof payload.workerId === 'string' ? payload.workerId : '';
        if (!workerId) {
          needReconcile = true;
        } else {
          const workers = [...nextData.workers];
          const workerIndex = workers.findIndex((worker) => worker.id === workerId);
          const existing = workerIndex >= 0 ? workers[workerIndex] : null;

          let nextStatus = existing?.status || 'idle';
          if (eventType === 'worker.online') nextStatus = 'idle';
          if (eventType === 'worker.offline') nextStatus = 'offline';
          if ((eventType === 'worker.heartbeat' || eventType === 'worker.status_changed') && typeof payload.status === 'string') {
            nextStatus = payload.status;
          }

          const cpuUsage = typeof payload.cpuUsage === 'number' ? payload.cpuUsage : existing?.cpuUsage ?? null;
          const memoryUsageMb =
            typeof payload.memoryUsageMb === 'number' ? payload.memoryUsageMb : existing?.memoryUsageMb ?? null;
          const currentTaskId =
            typeof payload.currentTaskId === 'string' || payload.currentTaskId === null
              ? (payload.currentTaskId as string | null)
              : existing?.currentTaskId ?? null;

          const nextWorker: WorkerItem = {
            id: workerId,
            name:
              (typeof payload.name === 'string' && payload.name) ||
              existing?.name ||
              workerId,
            supportedAgentIds: existing?.supportedAgentIds || [],
            status: nextStatus,
            currentTaskId,
            lastHeartbeatAt: event.timestamp,
            cpuUsage,
            memoryUsageMb,
            diskUsageMb: existing?.diskUsageMb ?? null,
            totalTasksCompleted: existing?.totalTasksCompleted ?? 0,
            totalTasksFailed: existing?.totalTasksFailed ?? 0,
            registeredAt: existing?.registeredAt || event.timestamp,
          };

          if (workerIndex >= 0) {
            workers[workerIndex] = nextWorker;
          } else {
            workers.push(nextWorker);
          }

          nextData = {
            ...nextData,
            workers,
            workerSummary: toWorkerStatusSummary(workers),
          };
        }
      }

      if (nextData === state.data && nextTaskStatuses === state.taskStatuses) {
        return state;
      }

      return { ...state, data: nextData, taskStatuses: nextTaskStatuses };
    });

    return needReconcile;
  },
}));

// ----- Task Store -----
interface TaskStore {
  tasks: TaskItem[];
  loading: boolean;
  fetchTasks: (status?: string) => Promise<void>;
  createTask: (
    input: Record<string, unknown>
  ) => Promise<{ success: boolean; errorMessage?: string; missingEnvVars?: string[] }>;
  createPipeline: (input: {
    agentDefinitionId: string;
    repositoryId?: string;
    repoUrl: string;
    baseBranch?: string;
    workDir?: string;
    maxRetries?: number;
    groupId?: string;
    steps: Array<{ title: string; description: string }>;
  }) => Promise<{
    success: boolean;
    pipelineId?: string;
    groupId?: string;
    taskIds?: string[];
    errorMessage?: string;
    missingEnvVars?: string[];
  }>;
}

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  loading: false,

  fetchTasks: async (status?: string) => {
    set({ loading: true });
    try {
      const url = status ? `/api/tasks?status=${status}` : '/api/tasks';
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        set({ tasks: json.data, loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  createTask: async (input) => {
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await res.json().catch(() => null);
      if (json?.success) return { success: true };

      const missingEnvVars = Array.isArray(json?.error?.missingEnvVars)
        ? (json.error.missingEnvVars as string[])
        : undefined;

      return {
        success: false,
        errorMessage: json?.error?.message || '创建任务失败',
        missingEnvVars,
      };
    } catch (err) {
      return { success: false, errorMessage: (err as Error).message };
    }
  },

  createPipeline: async (input) => {
    try {
      const res = await fetch('/api/tasks/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await res.json().catch(() => null);
      if (json?.success) {
        const taskIds = Array.isArray(json?.data?.tasks)
          ? (json.data.tasks as Array<{ id: string }>).map((t) => t.id)
          : undefined;
        return {
          success: true,
          pipelineId: json?.data?.pipelineId,
          groupId: json?.data?.groupId,
          taskIds,
        };
      }

      const missingEnvVars = Array.isArray(json?.error?.missingEnvVars)
        ? (json.error.missingEnvVars as string[])
        : undefined;

      return {
        success: false,
        errorMessage: json?.error?.message || '创建流水线失败',
        missingEnvVars,
      };
    } catch (err) {
      return { success: false, errorMessage: (err as Error).message };
    }
  },
}));

// ----- Agent Definition Store -----
interface AgentStore {
  agents: AgentDefinitionItem[];
  loading: boolean;
  fetchAgents: () => Promise<void>;
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: [],
  loading: false,

  fetchAgents: async () => {
    set({ loading: true });
    try {
      const res = await fetch('/api/agents');
      const json = await res.json();
      if (json.success) {
        set({ agents: json.data, loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },
}));

// ----- Repository Store -----
interface RepoStore {
  repos: RepositoryItem[];
  loading: boolean;
  error: string | null;
  fetchRepos: () => Promise<void>;
  createRepo: (input: {
    name: string;
    repoUrl: string;
    defaultBaseBranch?: string;
    defaultWorkDir?: string;
  }) => Promise<{ success: boolean; errorMessage?: string }>;
  updateRepo: (
    id: string,
    patch: Partial<{
      name: string;
      repoUrl: string;
      defaultBaseBranch: string;
      defaultWorkDir: string | null;
    }>
  ) => Promise<{ success: boolean; errorMessage?: string }>;
  deleteRepo: (id: string) => Promise<{ success: boolean; errorMessage?: string }>;
}

export const useRepoStore = create<RepoStore>((set) => ({
  repos: [],
  loading: false,
  error: null,

  fetchRepos: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/repos');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        set({ loading: false, error: json?.error?.message || `HTTP ${res.status}` });
        return;
      }
      set({ repos: json.data, loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  createRepo: async (input) => {
    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await res.json().catch(() => null);
      if (json?.success) {
        set((s) => ({ repos: [...s.repos, json.data], error: null }));
        return { success: true };
      }
      set({ error: json?.error?.message || '创建仓库失败' });
      return { success: false, errorMessage: json?.error?.message || '创建仓库失败' };
    } catch (err) {
      set({ error: (err as Error).message });
      return { success: false, errorMessage: (err as Error).message };
    }
  },

  updateRepo: async (id, patch) => {
    try {
      const res = await fetch(`/api/repos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => null);
      if (json?.success) {
        set((s) => ({
          repos: s.repos.map((r) => (r.id === id ? (json.data as RepositoryItem) : r)),
          error: null,
        }));
        return { success: true };
      }
      set({ error: json?.error?.message || '更新仓库失败' });
      return { success: false, errorMessage: json?.error?.message || '更新仓库失败' };
    } catch (err) {
      set({ error: (err as Error).message });
      return { success: false, errorMessage: (err as Error).message };
    }
  },

  deleteRepo: async (id) => {
    try {
      const res = await fetch(`/api/repos/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => null);
      if (json?.success) {
        set((s) => ({ repos: s.repos.filter((r) => r.id !== id), error: null }));
        return { success: true };
      }
      set({ error: json?.error?.message || '删除仓库失败' });
      return { success: false, errorMessage: json?.error?.message || '删除仓库失败' };
    } catch (err) {
      set({ error: (err as Error).message });
      return { success: false, errorMessage: (err as Error).message };
    }
  },
}));

// ----- Worker Store -----
interface WorkerStore {
  workers: WorkerItem[];
  loading: boolean;
  fetchWorkers: () => Promise<void>;
  updateWorkerStatus: (
    id: string,
    action: 'drain' | 'offline' | 'activate'
  ) => Promise<{ success: boolean; errorMessage?: string }>;
  pruneOfflineWorkers: () => Promise<{ success: boolean; removed?: number; errorMessage?: string }>;
}

export const useWorkerStore = create<WorkerStore>((set) => ({
  workers: [],
  loading: false,

  fetchWorkers: async () => {
    set({ loading: true });
    try {
      const res = await fetch('/api/workers');
      const json = await res.json();
      if (json.success) {
        set({ workers: json.data, loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  updateWorkerStatus: async (id, action) => {
    try {
      const res = await fetch(`/api/workers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        return {
          success: false,
          errorMessage: json?.error?.message || `HTTP ${res.status}`,
        };
      }

      const updated = json.data as WorkerItem;
      set((state) => ({
        workers: state.workers.map((worker) => (worker.id === id ? updated : worker)),
      }));
      return { success: true };
    } catch (err) {
      return { success: false, errorMessage: (err as Error).message };
    }
  },

  pruneOfflineWorkers: async () => {
    try {
      const res = await fetch('/api/workers?status=offline', { method: 'DELETE' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        return {
          success: false,
          errorMessage: json?.error?.message || `HTTP ${res.status}`,
        };
      }

      const workerIds = Array.isArray(json?.data?.workerIds)
        ? (json.data.workerIds as string[])
        : [];
      const removed = Number(json?.data?.removed || 0);
      const removeSet = new Set(workerIds);

      set((state) => ({
        workers:
          removeSet.size > 0
            ? state.workers.filter((worker) => !removeSet.has(worker.id))
            : state.workers.filter((worker) => worker.status !== 'offline'),
      }));

      return { success: true, removed };
    } catch (err) {
      return { success: false, errorMessage: (err as Error).message };
    }
  },
}));
