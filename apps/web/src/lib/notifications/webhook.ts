// ============================================================
// Webhook 通知
// 将关键系统事件推送到外部通知端点（Slack/飞书/钉钉等）
// ============================================================

type WebhookPayload = Record<string, unknown>;
type WebhookProvider = 'generic' | 'slack' | 'feishu' | 'dingtalk';

type WebhookRuntimeConfig = {
  urls: string[];
  token: string;
  timeoutMs: number;
  provider: WebhookProvider;
  eventFilters: string[];
  progressStatuses: Set<string>;
};

type CachedWebhookConfig = {
  expiresAt: number;
  value: WebhookRuntimeConfig;
};

const DEFAULT_TIMEOUT_MS = 4_000;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 30_000;
const CONFIG_CACHE_TTL_MS = 5_000;
const SKIPPED_EVENT_TYPES = new Set(['worker.heartbeat']);
const DEFAULT_PROGRESS_STATUSES = new Set(['running', 'awaiting_review', 'completed', 'failed', 'cancelled']);
const SUPPORTED_PROVIDERS = new Set<WebhookProvider>(['generic', 'slack', 'feishu', 'dingtalk']);

let cachedConfig: CachedWebhookConfig | null = null;
let loadingConfigPromise: Promise<WebhookRuntimeConfig> | null = null;
let resolveEnvVarValueFromSecrets:
  | ((name: string, scope: { repositoryId?: string | null; repoUrl?: string | null; agentDefinitionId?: string | null }) => Promise<string | null>)
  | null = null;

function normalizeList(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function parseWebhookUrls(raw: string): string[] {
  return normalizeList(raw).filter(isHttpUrl);
}

async function resolveConfigValue(name: string): Promise<string | null> {
  const envValue = process.env[name];
  if (typeof envValue === 'string' && envValue.trim()) {
    return envValue;
  }

  try {
    if (!resolveEnvVarValueFromSecrets) {
      const mod = await import('../secrets/resolve.ts');
      resolveEnvVarValueFromSecrets = mod.resolveEnvVarValue;
    }
    return await resolveEnvVarValueFromSecrets(name, {});
  } catch {
    return null;
  }
}

function clampTimeoutMs(raw: string | null): number {
  const value = Number(raw || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  if (value < MIN_TIMEOUT_MS) return MIN_TIMEOUT_MS;
  if (value > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS;
  return Math.floor(value);
}

function parseProvider(raw: string | null): WebhookProvider {
  const normalized = (raw || '').trim().toLowerCase();
  if (SUPPORTED_PROVIDERS.has(normalized as WebhookProvider)) {
    return normalized as WebhookProvider;
  }
  return 'generic';
}

function parseEventFilters(raw: string | null): string[] {
  return normalizeList(raw || '').map((item) => item.toLowerCase());
}

function parseProgressStatuses(raw: string | null): Set<string> {
  const parsed = normalizeList(raw || '').map((item) => item.toLowerCase());
  if (parsed.length === 0) return new Set(DEFAULT_PROGRESS_STATUSES);
  return new Set(parsed);
}

function matchEventFilter(eventType: string, filter: string): boolean {
  if (filter === '*') return true;
  if (filter.endsWith('.*')) {
    const prefix = filter.slice(0, -1);
    return eventType.startsWith(prefix);
  }
  return eventType === filter;
}

export function shouldSendWebhookEvent(
  eventType: string,
  payload: WebhookPayload,
  options: { eventFilters: string[]; progressStatuses: Set<string> }
): boolean {
  if (SKIPPED_EVENT_TYPES.has(eventType)) return false;

  if (eventType === 'task.progress') {
    const status = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : '';
    if (!status || !options.progressStatuses.has(status)) return false;
  }

  if (options.eventFilters.length === 0) return true;
  const normalizedType = eventType.toLowerCase();
  return options.eventFilters.some((filter) => matchEventFilter(normalizedType, filter));
}

function truncateText(value: string, maxLen = 120): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen - 1)}…`;
}

function buildWebhookText(eventType: string, payload: WebhookPayload, timestamp: string): string {
  const taskId = typeof payload.taskId === 'string' ? payload.taskId : '';
  const status = typeof payload.status === 'string' ? payload.status : '';
  const workerId = typeof payload.workerId === 'string' ? payload.workerId : '';
  const prUrl = typeof payload.prUrl === 'string' ? payload.prUrl : '';
  const summary = typeof payload.summary === 'string' ? payload.summary : '';

  const fields: string[] = [`事件=${eventType}`];
  if (taskId) fields.push(`任务=${taskId}`);
  if (status) fields.push(`状态=${status}`);
  if (workerId) fields.push(`节点=${workerId}`);
  if (prUrl) fields.push(`PR=${prUrl}`);
  if (summary) fields.push(`摘要=${truncateText(summary)}`);
  fields.push(`时间=${timestamp}`);

  return `[CAM] ${fields.join(' | ')}`;
}

export function buildWebhookRequest(
  eventType: string,
  payload: WebhookPayload,
  options: {
    provider: WebhookProvider;
    token: string;
    timestamp: string;
  }
): { headers: Record<string, string>; body: Record<string, unknown> } {
  const text = buildWebhookText(eventType, payload, options.timestamp);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  if (options.provider === 'slack') {
    return { headers, body: { text } };
  }

  if (options.provider === 'feishu') {
    return {
      headers,
      body: {
        msg_type: 'text',
        content: { text },
      },
    };
  }

  if (options.provider === 'dingtalk') {
    return {
      headers,
      body: {
        msgtype: 'text',
        text: { content: text },
      },
    };
  }

  return {
    headers,
    body: {
      source: 'coding-agents-manager',
      type: eventType,
      payload,
      timestamp: options.timestamp,
      text,
    },
  };
}

async function loadWebhookRuntimeConfig(): Promise<WebhookRuntimeConfig> {
  const [singleUrl, multipleUrls, token, timeoutMs, provider, events, progressStatuses] = await Promise.all([
    resolveConfigValue('CAM_WEBHOOK_URL'),
    resolveConfigValue('CAM_WEBHOOK_URLS'),
    resolveConfigValue('CAM_WEBHOOK_TOKEN'),
    resolveConfigValue('CAM_WEBHOOK_TIMEOUT_MS'),
    resolveConfigValue('CAM_WEBHOOK_PROVIDER'),
    resolveConfigValue('CAM_WEBHOOK_EVENTS'),
    resolveConfigValue('CAM_WEBHOOK_PROGRESS_STATUSES'),
  ]);

  const urls = parseWebhookUrls([singleUrl || '', multipleUrls || ''].filter(Boolean).join(','));

  return {
    urls,
    token: (token || '').trim(),
    timeoutMs: clampTimeoutMs(timeoutMs),
    provider: parseProvider(provider),
    eventFilters: parseEventFilters(events),
    progressStatuses: parseProgressStatuses(progressStatuses),
  };
}

async function getWebhookRuntimeConfig(): Promise<WebhookRuntimeConfig> {
  const now = Date.now();
  if (cachedConfig && cachedConfig.expiresAt > now) {
    return cachedConfig.value;
  }

  if (!loadingConfigPromise) {
    loadingConfigPromise = loadWebhookRuntimeConfig()
      .then((config) => {
        cachedConfig = { value: config, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
        return config;
      })
      .finally(() => {
        loadingConfigPromise = null;
      });
  }

  return loadingConfigPromise;
}

async function postWebhook(url: string, request: { headers: Record<string, string>; body: Record<string, unknown> }, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[Webhook] 推送失败: url=${url}, status=${res.status}`);
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.warn(`[Webhook] 推送超时: url=${url}, timeoutMs=${timeoutMs}`);
    } else {
      console.warn(`[Webhook] 推送异常: url=${url}, error=${(err as Error).message}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchWebhookEvent(eventType: string, payload: WebhookPayload): Promise<void> {
  const config = await getWebhookRuntimeConfig();
  if (config.urls.length === 0) return;

  if (!shouldSendWebhookEvent(eventType, payload, config)) return;

  const timestamp = new Date().toISOString();
  const request = buildWebhookRequest(eventType, payload, {
    provider: config.provider,
    token: config.token,
    timestamp,
  });

  await Promise.allSettled(config.urls.map((url) => postWebhook(url, request, config.timeoutMs)));
}

export function sendWebhookEvent(eventType: string, payload: WebhookPayload): void {
  void dispatchWebhookEvent(eventType, payload);
}

export function __unsafeResetWebhookConfigCacheForTests(): void {
  cachedConfig = null;
  loadingConfigPromise = null;
  resolveEnvVarValueFromSecrets = null;
}
