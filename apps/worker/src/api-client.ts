// ============================================================
// Worker API 客户端
// 封装与 API Server 的 HTTP 通信
// ============================================================

const apiUrl = process.env.API_SERVER_URL || 'http://localhost:3000';
const apiAuthToken = (process.env.API_AUTH_TOKEN || process.env.CAM_AUTH_TOKEN || '').trim();

type NextTaskPayload = {
  task: Record<string, unknown>;
  agentDefinition: Record<string, unknown>;
  env?: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => typeof item === 'string');
}

function parseApiEnvelope(value: unknown, endpoint: string): { success: boolean; data: unknown } {
  if (!isRecord(value)) {
    throw new Error(`API 响应格式错误: ${endpoint} 不是对象`);
  }
  if (typeof value.success !== 'boolean') {
    throw new Error(`API 响应格式错误: ${endpoint} 缺少 success`);
  }
  return { success: value.success, data: value.data };
}

function isNextTaskPayload(value: unknown): value is NextTaskPayload {
  if (!isRecord(value)) return false;
  if (!isRecord(value.task) || !isRecord(value.agentDefinition)) return false;
  if (typeof value.task.id !== 'string') return false;
  if (typeof value.agentDefinition.id !== 'string') return false;
  if (value.env !== undefined && !isStringRecord(value.env)) return false;
  return true;
}

/** 通用请求方法 */
async function request(path: string, options?: RequestInit): Promise<unknown> {
  const url = `${apiUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (apiAuthToken) {
    headers.Authorization = `Bearer ${apiAuthToken}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API 请求失败 [${res.status}]: ${text}`);
  }

  return res.json();
}

/** 注册 Worker */
export async function registerWorker(input: {
  id: string;
  name: string;
  supportedAgentIds: string[];
}): Promise<void> {
  await request('/api/workers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  console.log(`[Worker] 注册成功: ${input.id}`);
}

/** 发送心跳 */
export async function sendHeartbeat(
  workerId: string,
  input: {
    status: string;
    currentTaskId?: string | null;
    cpuUsage?: number;
    memoryUsageMb?: number;
    logTail?: string;
  }
): Promise<void> {
  await request(`/api/workers/${workerId}/heartbeat`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 获取下一个待执行的任务 */
export async function fetchNextTask(
  workerId: string
): Promise<{ task: Record<string, unknown>; agentDefinition: Record<string, unknown>; env?: Record<string, string> } | null> {
  const raw = await request(`/api/workers/${workerId}/next-task`);
  const parsed = parseApiEnvelope(raw, `/api/workers/${workerId}/next-task`);
  if (!parsed.success || parsed.data == null) return null;

  if (!isNextTaskPayload(parsed.data)) {
    console.warn(`[Worker] next-task 响应结构异常，已忽略本次任务分配: ${JSON.stringify(parsed.data)}`);
    return null;
  }

  return parsed.data;
}

/** 获取任务详情 */
export async function getTask(taskId: string): Promise<Record<string, unknown>> {
  const raw = await request(`/api/tasks/${taskId}`);
  const parsed = parseApiEnvelope(raw, `/api/tasks/${taskId}`);
  if (!parsed.success || !isRecord(parsed.data)) {
    throw new Error(`任务数据格式错误: ${taskId}`);
  }
  return parsed.data;
}

/** 获取 AgentDefinition 详情 */
export async function getAgentDefinition(agentDefinitionId: string): Promise<Record<string, unknown>> {
  const raw = await request(`/api/agents/${agentDefinitionId}`);
  const parsed = parseApiEnvelope(raw, `/api/agents/${agentDefinitionId}`);
  if (!parsed.success || !isRecord(parsed.data)) {
    throw new Error(`AgentDefinition 数据格式错误: ${agentDefinitionId}`);
  }
  return parsed.data;
}

/** 更新任务状态 */
export async function updateTaskStatus(
  taskId: string,
  status: string,
  extra?: Record<string, unknown>
): Promise<void> {
  await request(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...extra }),
  });
}

/** 追加任务日志（持久化） */
export async function appendTaskLogs(taskId: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  await request(`/api/tasks/${taskId}/logs/append`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
  });
}
