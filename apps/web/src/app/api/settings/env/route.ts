// ============================================================
// API: 环境配置状态（仅返回是否配置，不返回任何值）
// GET /api/settings/env
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentDefinitions } from '@/lib/db/schema';
import fs from 'fs';
import { hasUsableSecretValue } from '@/lib/secrets/resolve';
import { API_COMMON_MESSAGES } from '@/lib/i18n/messages';

const dockerSocketPath = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';

function isPresent(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

export async function GET() {
  try {
    const defs = await db.select().from(agentDefinitions).orderBy(agentDefinitions.createdAt);

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
        const present = isPresent(ev.name) || (await hasUsableSecretValue(ev.name, { agentDefinitionId: a.id }));
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
      keyStatus.push({ name, present: isPresent(name) || (await hasUsableSecretValue(name, {})) });
    }

    return NextResponse.json({
      success: true,
      data: {
        docker: {
          socketPath: dockerSocketPath,
          available: fs.existsSync(dockerSocketPath),
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
