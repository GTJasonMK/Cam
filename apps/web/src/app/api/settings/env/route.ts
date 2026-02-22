// ============================================================
// API: 环境配置状态（仅返回是否配置，不返回任何值）
// GET /api/settings/env
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentDefinitions, workers } from '@/lib/db/schema';
import fs from 'fs';
import { hasUsableSecretValue } from '@/lib/secrets/resolve';
import { API_COMMON_MESSAGES } from '@/lib/i18n/messages';
import { isEligibleCapabilityWorker, workerSupportsAgent, type WorkerCapabilitySnapshot } from '@/lib/workers/capabilities';
import { withAuth } from '@/lib/auth/with-auth';

const dockerSocketPath = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';

function isPresent(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

async function handler() {
  try {
    const defs = await db.select().from(agentDefinitions).orderBy(agentDefinitions.createdAt);

    const nowMs = Date.now();
    const staleTimeoutMs = Number(process.env.WORKER_STALE_TIMEOUT_MS || 30_000);

    const workerRows = await db
      .select({
        id: workers.id,
        name: workers.name,
        status: workers.status,
        mode: workers.mode,
        lastHeartbeatAt: workers.lastHeartbeatAt,
        supportedAgentIds: workers.supportedAgentIds,
        reportedEnvVars: workers.reportedEnvVars,
      })
      .from(workers);

    const workerSnapshots: Array<WorkerCapabilitySnapshot & { name: string }> = workerRows.map((w) => ({
      id: w.id,
      name: w.name,
      status: w.status,
      mode: w.mode,
      lastHeartbeatAt: w.lastHeartbeatAt,
      supportedAgentIds: (w.supportedAgentIds as string[]) || [],
      reportedEnvVars: (w.reportedEnvVars as string[]) || [],
    }));

    const eligibleDaemonWorkers = workerSnapshots.filter((w) =>
      isEligibleCapabilityWorker(w, { nowMs, staleTimeoutMs })
    );

    const isPresentOnAnyWorker = (name: string): boolean => {
      return eligibleDaemonWorkers.some((w) => (w.reportedEnvVars || []).includes(name));
    };

    const isPresentOnAnyWorkerForAgent = (agentDefinitionId: string, name: string): boolean => {
      return eligibleDaemonWorkers.some(
        (w) => workerSupportsAgent(w, agentDefinitionId) && (w.reportedEnvVars || []).includes(name)
      );
    };

    const agents: Array<{
      id: string;
      displayName: string;
      requiredEnvVars: Array<{ name: string; required: boolean; sensitive: boolean; present: boolean }>;
    }> = [];

    for (const a of defs) {
      const requiredEnvVars =
        (a.requiredEnvVars as Array<{ name: string; description?: string; required?: boolean; sensitive?: boolean }>) ||
        [];

      const rows: Array<{ name: string; required: boolean; sensitive: boolean; present: boolean }> = [];
      for (const ev of requiredEnvVars) {
        const presentOnServer = isPresent(ev.name) || (await hasUsableSecretValue(ev.name, { agentDefinitionId: a.id }));
        const presentOnWorker = isPresentOnAnyWorkerForAgent(a.id, ev.name);
        const present = presentOnServer || presentOnWorker;
        rows.push({
          name: ev.name,
          required: Boolean(ev.required),
          sensitive: Boolean(ev.sensitive),
          present,
        });
      }

      agents.push({
        id: a.id,
        displayName: a.displayName,
        requiredEnvVars: rows,
      });
    }

    const keyVars = [
      'CAM_MASTER_KEY',
      'CAM_AUTH_TOKEN',
      'CAM_ALLOW_ANONYMOUS_ACCESS',
      'CAM_SESSION_TTL_HOURS',
      'CAM_COOKIE_SECURE',
      'CAM_COOKIE_DOMAIN',
      'CAM_PUBLIC_BASE_URL',
      'CAM_OAUTH_STATE_SECRET',
      'CAM_OAUTH_GITHUB_CLIENT_ID',
      'CAM_OAUTH_GITHUB_CLIENT_SECRET',
      'CAM_OAUTH_GITLAB_CLIENT_ID',
      'CAM_OAUTH_GITLAB_CLIENT_SECRET',
      'CAM_OAUTH_GITLAB_BASE_URL',
      'CAM_RATE_LIMIT_ENABLED',
      'CAM_RATE_LIMIT_WINDOW_MS',
      'CAM_RATE_LIMIT_MAX_REQUESTS',
      'CAM_WEBHOOK_URL',
      'CAM_WEBHOOK_URLS',
      'CAM_WEBHOOK_TOKEN',
      'CAM_WEBHOOK_PROVIDER',
      'CAM_WEBHOOK_EVENTS',
      'CAM_WEBHOOK_PROGRESS_STATUSES',
      'CAM_GIT_PROVIDER',
      'GITHUB_TOKEN',
      'GITLAB_TOKEN',
      'GITEA_TOKEN',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
    ];
    const keyStatus: Array<{ name: string; present: boolean }> = [];
    for (const name of keyVars) {
      if (name === 'CAM_MASTER_KEY') {
        keyStatus.push({ name, present: isPresent(name) });
        continue;
      }
      const presentOnServer = isPresent(name) || (await hasUsableSecretValue(name, {}));
      const presentOnWorker = isPresentOnAnyWorker(name);
      keyStatus.push({ name, present: presentOnServer || presentOnWorker });
    }

    return NextResponse.json({
      success: true,
      data: {
        docker: {
          socketPath: dockerSocketPath,
          available: fs.existsSync(dockerSocketPath),
        },
        workers: {
          staleTimeoutMs,
          daemonCount: eligibleDaemonWorkers.length,
          daemonWorkers: eligibleDaemonWorkers.map((w) => ({
            id: w.id,
            name: w.name,
            status: w.status,
            lastHeartbeatAt: w.lastHeartbeatAt,
            reportedEnvVars: w.reportedEnvVars || [],
          })),
        },
        keys: keyStatus,
        agents,
      },
    });
  } catch (err) {
    console.error('[API] 获取环境状态失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.fetchFailed } },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
