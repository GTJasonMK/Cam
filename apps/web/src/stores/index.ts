// ============================================================
// Zustand Store: 全局状态管理
// ============================================================

import { create } from 'zustand';
import {
  readApiEnvelope,
  resolveApiErrorMessage,
  resolveMissingEnvVars,
} from '@/lib/http/client-response';

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
  /** 任务来源：'scheduler' | 'terminal' */
  source: string;
  createdAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export type TaskSourceFilter = 'scheduler' | 'terminal' | 'all';

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

/** 用户（用于用户系统模式的管理页 / 当前用户信息） */
export interface UserItem {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: string;
  status: string;
  avatarUrl?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
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
interface AgentSessionSummaryItem {
  sessionId: string;
  agentDisplayName: string;
  status: string;
  elapsedMs: number;
  repoPath?: string;
}

interface AgentSessionSummary {
  activeCount: number;
  totalToday: number;
  sessions: AgentSessionSummaryItem[];
}

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
  agentSessionSummary: AgentSessionSummary;
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

function shouldRefreshDashboardFromEvent(eventType: string): boolean {
  if (eventType.startsWith('task.')) return true;
  if (eventType.startsWith('agent.session.')) return true;
  return eventType === 'worker.online'
    || eventType === 'worker.offline'
    || eventType === 'worker.removed'
    || eventType === 'worker.pruned';
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
      const json = await readApiEnvelope<DashboardData>(res);
      if (res.ok && json?.success && json.data) {
        const payload = json.data as DashboardData;
        const statusMap = payload?.taskStatuses && typeof payload.taskStatuses === 'object'
          ? (payload.taskStatuses as Record<string, string>)
          : {};
        const { taskStatuses: _extractedStatuses, ...rest } = payload;
        void _extractedStatuses;
        set({ data: rest as DashboardData, taskStatuses: statusMap, loading: false });
      } else {
        set({ error: resolveApiErrorMessage(res, json, '获取失败'), loading: false });
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

      let nextData = state.data;
      let nextTaskStatuses = state.taskStatuses;
      const eventType = event.type;
      const payload = event.payload ?? {};
      if (shouldRefreshDashboardFromEvent(eventType)) {
        needReconcile = true;
      }

      const applyTaskStatus = (taskId: string, nextStatus: string) => {
        const prevStatus = nextTaskStatuses[taskId];
        if (prevStatus === nextStatus) return;

        // 口径防漂移：未知任务来源/筛选口径不明，交给后端全量统计校准
        if (!prevStatus) {
          needReconcile = true;
          return;
        }

        const nextMap = { ...nextTaskStatuses, [taskId]: nextStatus };
        const nextKpi = { ...nextData.kpi };
        const prevField = prevStatus ? KPI_STATUS_FIELD[prevStatus] : undefined;
        const nextField = KPI_STATUS_FIELD[nextStatus];

        if (prevField && nextKpi[prevField] > 0) {
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

      // ---- Agent 会话实时事件处理 ----
      if (eventType === 'agent.session.created') {
        const summary = nextData.agentSessionSummary ?? { activeCount: 0, totalToday: 0, sessions: [] };
        nextData = {
          ...nextData,
          agentSessionSummary: {
            ...summary,
            activeCount: summary.activeCount + 1,
            totalToday: summary.totalToday + 1,
          },
        };
      } else if (
        eventType === 'agent.session.completed' ||
        eventType === 'agent.session.failed' ||
        eventType === 'agent.session.cancelled'
      ) {
        const summary = nextData.agentSessionSummary ?? { activeCount: 0, totalToday: 0, sessions: [] };
        nextData = {
          ...nextData,
          agentSessionSummary: {
            ...summary,
            activeCount: Math.max(0, summary.activeCount - 1),
          },
        };
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
  fetchTasks: (status?: string, source?: TaskSourceFilter) => Promise<void>;
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
    steps: Array<{ title: string; description: string; agentDefinitionId?: string }>;
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

  fetchTasks: async (status?: string, source: TaskSourceFilter = 'scheduler') => {
    set({ loading: true });
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (source) params.set('source', source);
      const query = params.toString();
      const url = query ? `/api/tasks?${query}` : '/api/tasks';
      const res = await fetch(url);
      const json = await readApiEnvelope<TaskItem[]>(res);
      if (res.ok && json?.success && Array.isArray(json.data)) {
        set({ tasks: json.data, loading: false });
      } else {
        set({ loading: false });
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
      const json = await readApiEnvelope<unknown>(res);
      if (res.ok && json?.success) return { success: true };

      return {
        success: false,
        errorMessage: resolveApiErrorMessage(res, json, '创建任务失败'),
        missingEnvVars: resolveMissingEnvVars(json),
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
      const json = await readApiEnvelope<{ pipelineId?: string; groupId?: string; tasks?: Array<{ id: string }> }>(res);
      if (res.ok && json?.success) {
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

      return {
        success: false,
        errorMessage: resolveApiErrorMessage(res, json, '创建流水线失败'),
        missingEnvVars: resolveMissingEnvVars(json),
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
      const json = await readApiEnvelope<AgentDefinitionItem[]>(res);
      if (res.ok && json?.success && Array.isArray(json.data)) {
        set({ agents: json.data, loading: false });
      } else {
        set({ loading: false });
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
      const json = await readApiEnvelope<RepositoryItem[]>(res);
      if (!res.ok || !json?.success || !Array.isArray(json.data)) {
        set({ loading: false, error: resolveApiErrorMessage(res, json, '获取仓库列表失败') });
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
      const json = await readApiEnvelope<RepositoryItem>(res);
      if (res.ok && json?.success && json.data) {
        const createdRepo = json.data;
        set((s) => ({ repos: [...s.repos, createdRepo], error: null }));
        return { success: true };
      }
      const errorMessage = resolveApiErrorMessage(res, json, '创建仓库失败');
      set({ error: errorMessage });
      return { success: false, errorMessage };
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
      const json = await readApiEnvelope<RepositoryItem>(res);
      if (res.ok && json?.success && json.data) {
        const updatedRepo = json.data;
        set((s) => ({
          repos: s.repos.map((r) => (r.id === id ? updatedRepo : r)),
          error: null,
        }));
        return { success: true };
      }
      const errorMessage = resolveApiErrorMessage(res, json, '更新仓库失败');
      set({ error: errorMessage });
      return { success: false, errorMessage };
    } catch (err) {
      set({ error: (err as Error).message });
      return { success: false, errorMessage: (err as Error).message };
    }
  },

  deleteRepo: async (id) => {
    try {
      const res = await fetch(`/api/repos/${id}`, { method: 'DELETE' });
      const json = await readApiEnvelope<unknown>(res);
      if (res.ok && json?.success) {
        set((s) => ({ repos: s.repos.filter((r) => r.id !== id), error: null }));
        return { success: true };
      }
      const errorMessage = resolveApiErrorMessage(res, json, '删除仓库失败');
      set({ error: errorMessage });
      return { success: false, errorMessage };
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
      const json = await readApiEnvelope<WorkerItem[]>(res);
      if (res.ok && json?.success && Array.isArray(json.data)) {
        set({ workers: json.data, loading: false });
      } else {
        set({ loading: false });
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
      const json = await readApiEnvelope<WorkerItem>(res);
      if (!res.ok || !json?.success || !json.data) {
        return {
          success: false,
          errorMessage: resolveApiErrorMessage(res, json, '更新节点状态失败'),
        };
      }

      const updated = json.data;
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
      const json = await readApiEnvelope<{ removed?: number; workerIds?: string[] }>(res);
      if (!res.ok || !json?.success) {
        return {
          success: false,
          errorMessage: resolveApiErrorMessage(res, json, '清理离线节点失败'),
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

// ----- Navigation Store -----
interface NavigationStore {
  /** 当前正在跳转的目标路径（用于路由切换过渡） */
  pendingPath: string | null;
  setPendingPath: (path: string | null) => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  pendingPath: null,
  setPendingPath: (path) => set({ pendingPath: path }),
}));

// ----- Auth Store -----
export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: string;
  status: string;
  avatarUrl?: string | null;
  authSource: string;
  hasPassword?: boolean;
};

interface AuthStore {
  user: AuthUser | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  statusCode: number | null;
  fetchCurrentUser: () => Promise<void>;
  clearUser: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  loading: false,
  initialized: false,
  error: null,
  statusCode: null,

  clearUser: () => set({ user: null, initialized: true, statusCode: null, error: null }),

  fetchCurrentUser: async () => {
    set({ loading: true, error: null, statusCode: null });
    try {
      const res = await fetch('/api/auth/me');
      const status = res.status;
      const json = await readApiEnvelope<AuthUser>(res);

      if (!res.ok || !json?.success || !json.data) {
        set({
          user: null,
          loading: false,
          initialized: true,
          error: resolveApiErrorMessage(res, json, '获取当前用户失败'),
          statusCode: status,
        });
        return;
      }

      set({
        user: json.data,
        loading: false,
        initialized: true,
        error: null,
        statusCode: status,
      });
    } catch (err) {
      set({
        user: null,
        loading: false,
        initialized: true,
        error: (err as Error).message,
        statusCode: null,
      });
    }
  },
}));

// ----- User Store -----
interface UserStore {
  users: UserItem[];
  loading: boolean;
  error: string | null;
  fetchUsers: () => Promise<void>;
  createUser: (input: {
    username: string;
    displayName: string;
    password: string;
    email?: string;
    role: string;
  }) => Promise<{ success: boolean; errorMessage?: string }>;
  updateUser: (
    id: string,
    patch: Partial<Pick<UserItem, 'displayName' | 'email' | 'role' | 'status'>>
  ) => Promise<{ success: boolean; errorMessage?: string }>;
  deleteUser: (id: string) => Promise<{ success: boolean; errorMessage?: string }>;
  resetPassword: (id: string, newPassword: string) => Promise<{ success: boolean; errorMessage?: string }>;
}

export const useUserStore = create<UserStore>((set) => ({
  users: [],
  loading: false,
  error: null,

  fetchUsers: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/users');
      const json = await readApiEnvelope<UserItem[]>(res);
      if (!res.ok || !json?.success || !Array.isArray(json.data)) {
        set({ loading: false, error: resolveApiErrorMessage(res, json, '获取用户列表失败') });
        return;
      }
      set({ users: json.data, loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  createUser: async (input) => {
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await readApiEnvelope<UserItem>(res);
      if (!res.ok || !json?.success || !json.data) {
        return { success: false, errorMessage: resolveApiErrorMessage(res, json, '创建用户失败') };
      }

      const createdUser = json.data;
      set((state) => ({ users: [...state.users, createdUser], error: null }));
      return { success: true };
    } catch (err) {
      return { success: false, errorMessage: (err as Error).message };
    }
  },

  updateUser: async (id, patch) => {
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await readApiEnvelope<UserItem>(res);
      if (!res.ok || !json?.success || !json.data) {
        return { success: false, errorMessage: resolveApiErrorMessage(res, json, '更新用户失败') };
      }

      const updated = json.data;
      set((state) => ({
        users: state.users.map((u) => (u.id === id ? { ...u, ...updated } : u)),
        error: null,
      }));
      return { success: true };
    } catch (err) {
      return { success: false, errorMessage: (err as Error).message };
    }
  },

  deleteUser: async (id) => {
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      const json = await readApiEnvelope<unknown>(res);
      if (!res.ok || !json?.success) {
        return { success: false, errorMessage: resolveApiErrorMessage(res, json, '删除用户失败') };
      }
      set((state) => ({ users: state.users.filter((u) => u.id !== id), error: null }));
      return { success: true };
    } catch (err) {
      return { success: false, errorMessage: (err as Error).message };
    }
  },

  resetPassword: async (id, newPassword) => {
    try {
      const res = await fetch(`/api/users/${id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });
      const json = await readApiEnvelope<unknown>(res);
      if (!res.ok || !json?.success) {
        return { success: false, errorMessage: resolveApiErrorMessage(res, json, '重置密码失败') };
      }
      return { success: true };
    } catch (err) {
      return { success: false, errorMessage: (err as Error).message };
    }
  },
}));
