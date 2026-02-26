import { createHash } from 'crypto';
import fs from 'fs';
import Dockerode from 'dockerode';
import { db } from '@/lib/db';
import { agentDefinitions, tasks, workers } from '@/lib/db/schema';
import { resolveEnvVarValue } from '@/lib/secrets/resolve';
import { emitTaskStarted } from '@/lib/tasks/task-events';

const dockerSocketPath = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
const docker = new Dockerode({ socketPath: dockerSocketPath });
const PIPELINE_GROUP_PREFIX = 'pipeline/';
const PIPELINE_ARTIFACT_MOUNT_PATH = '/cam-pipeline-artifacts';

function isPipelineTaskGroup(groupId?: string | null): groupId is string {
  return Boolean(groupId && groupId.startsWith(PIPELINE_GROUP_PREFIX));
}

function buildPipelineArtifactVolumeName(groupId: string): string {
  const digest = createHash('sha1').update(groupId).digest('hex').slice(0, 16);
  return `cam-pipeline-${digest}`;
}

function isDockerVolumeAlreadyExistsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  const statusCode = typeof err === 'object' && err !== null && 'statusCode' in err
    ? Number((err as { statusCode?: number }).statusCode)
    : undefined;
  return statusCode === 409 || message.includes('already exists');
}

async function ensurePipelineArtifactVolume(volumeName: string, groupId: string): Promise<void> {
  try {
    await docker.createVolume({
      Name: volumeName,
      Labels: {
        'cam.pipeline-group-id': groupId,
      },
    });
  } catch (err) {
    if (isDockerVolumeAlreadyExistsError(err)) return;
    throw err;
  }
}

export function isDockerSchedulerAvailable(): boolean {
  return fs.existsSync(dockerSocketPath);
}

export async function startWorkerContainerForTask(
  task: typeof tasks.$inferSelect,
  agentDef: typeof agentDefinitions.$inferSelect,
  workerId: string,
): Promise<void> {
  const apiServerUrl = process.env.API_SERVER_URL || 'http://localhost:3000';

  console.log(`[Scheduler] 为任务 ${task.id} 启动容器, 镜像: ${agentDef.dockerImage}`);

  // 构建环境变量
  const envVars = [
    `WORKER_ID=${workerId}`,
    `API_SERVER_URL=${apiServerUrl}`,
    `TASK_ID=${task.id}`,
    `AGENT_DEF_ID=${agentDef.id}`,
    `REPO_URL=${task.repoUrl}`,
    `BASE_BRANCH=${task.baseBranch}`,
    `WORK_BRANCH=${task.workBranch}`,
    `TASK_DESCRIPTION=${task.description}`,
  ];
  const bindMounts: string[] = [];

  const apiAuthToken = (process.env.CAM_AUTH_TOKEN || '').trim();
  if (apiAuthToken) {
    envVars.push(`API_AUTH_TOKEN=${apiAuthToken}`);
  }

  if (task.workDir) {
    envVars.push(`WORK_DIR=${task.workDir}`);
  }

  if (isPipelineTaskGroup(task.groupId)) {
    const pipelineVolumeName = buildPipelineArtifactVolumeName(task.groupId);
    await ensurePipelineArtifactVolume(pipelineVolumeName, task.groupId);
    bindMounts.push(`${pipelineVolumeName}:${PIPELINE_ARTIFACT_MOUNT_PATH}`);
    envVars.push(`CAM_PIPELINE_ARTIFACT_DIR=${PIPELINE_ARTIFACT_MOUNT_PATH}`);
    envVars.push(`CAM_PIPELINE_GROUP_ID=${task.groupId}`);
  }

  // Secrets / Env 注入：按 repo/agent 维度解析最终值
  const scope = {
    repositoryId: (task as typeof task & { repositoryId?: string | null }).repositoryId || null,
    repoUrl: task.repoUrl,
    agentDefinitionId: agentDef.id,
  };

  const injected = new Set<string>();

  // GitHub Token：用于私有仓库 clone/push（如配置）
  const githubToken =
    (await resolveEnvVarValue('GITHUB_TOKEN', scope)) ||
    process.env.GITHUB_PAT ||
    process.env.GITHUB_API_TOKEN ||
    process.env.GIT_HTTP_TOKEN ||
    process.env.CAM_GIT_HTTP_TOKEN ||
    '';
  if (githubToken) {
    envVars.push(`GITHUB_TOKEN=${githubToken}`);
    injected.add('GITHUB_TOKEN');
  }

  // 注入 Agent 所需的 API Key 等环境变量
  const requiredEnvVars = (agentDef.requiredEnvVars as Array<{ name: string }>) || [];
  for (const envSpec of requiredEnvVars) {
    if (injected.has(envSpec.name)) continue;
    const val = await resolveEnvVarValue(envSpec.name, scope);
    if (val) {
      envVars.push(`${envSpec.name}=${val}`);
      injected.add(envSpec.name);
    }
  }

  // 创建并启动容器
  const container = await docker.createContainer({
    Image: agentDef.dockerImage,
    Env: envVars,
    HostConfig: {
      AutoRemove: true,
      Binds: bindMounts.length > 0 ? bindMounts : undefined,
      Memory: (agentDef.defaultResourceLimits as { memoryLimitMb?: number })?.memoryLimitMb
        ? ((agentDef.defaultResourceLimits as { memoryLimitMb: number }).memoryLimitMb * 1024 * 1024)
        : undefined,
      NetworkMode: 'host',
    },
    Labels: {
      'cam.task-id': task.id,
      'cam.agent-def-id': agentDef.id,
      'cam.worker-id': workerId,
      'cam.pipeline-group-id': task.groupId || '',
    },
  });

  await container.start();

  // 注册 Worker
  await db.insert(workers).values({
    id: workerId,
    name: workerId,
    supportedAgentIds: [agentDef.id],
    status: 'busy',
    currentTaskId: task.id,
    lastHeartbeatAt: new Date().toISOString(),
    uptimeSince: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: workers.id,
    set: {
      status: 'busy',
      currentTaskId: task.id,
      lastHeartbeatAt: new Date().toISOString(),
    },
  });

  await emitTaskStarted({
    taskId: task.id,
    workerId,
    agentDefinitionId: agentDef.id,
  });
}
