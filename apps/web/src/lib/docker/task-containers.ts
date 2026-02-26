import Dockerode from 'dockerode';
import fs from 'fs';

const dockerSocketPath = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
const docker = new Dockerode({ socketPath: dockerSocketPath });

export function getDockerSocketPath(): string {
  return dockerSocketPath;
}

export function isDockerSocketAvailable(): boolean {
  return fs.existsSync(dockerSocketPath);
}

export async function stopTaskContainers(taskId: string, timeoutSeconds = 10): Promise<number> {
  if (!isDockerSocketAvailable()) return 0;

  const containers = await docker.listContainers({
    all: true,
    filters: {
      label: [`cam.task-id=${taskId}`],
    },
  });

  let stopped = 0;
  for (const container of containers) {
    try {
      await docker.getContainer(container.Id).stop({ t: timeoutSeconds });
      stopped += 1;
    } catch {
      // 容器已停止/不存在时忽略
    }
  }

  return stopped;
}

export async function stopManyTaskContainers(taskIds: string[], timeoutSeconds = 10): Promise<number> {
  const uniqueTaskIds = Array.from(new Set(taskIds));
  let stopped = 0;

  for (const taskId of uniqueTaskIds) {
    try {
      stopped += await stopTaskContainers(taskId, timeoutSeconds);
    } catch {
      // best-effort：单个任务 stop 失败不影响其他任务
    }
  }

  return stopped;
}
