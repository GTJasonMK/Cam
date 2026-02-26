#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# CAM 服务器升级脚本
# 自动检测当前部署模式（host / docker）并执行对应升级流程
# ============================================================

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/server/.env.prod"
COMPOSE_FILE="$ROOT_DIR/deploy/server/docker-compose.server.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ERROR] 缺少 $ENV_FILE"
  exit 1
fi

cd "$ROOT_DIR"

echo "[INFO] 拉取最新代码"
git pull --ff-only

echo "[INFO] 载入环境变量: $ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${CAM_DATA_DIR:=/opt/cam/data}"
: "${CAM_DEPLOY_MODE:=host}"

echo "[INFO] 安装依赖"
corepack enable
pnpm install --frozen-lockfile

echo "[INFO] 执行数据库迁移"
DATABASE_PATH="$CAM_DATA_DIR/cam.db" pnpm db:migrate

if [[ "${CAM_BUILD_AGENT_IMAGES:-false}" == "true" ]]; then
  echo "[INFO] 重新构建 worker agent 镜像"
  pnpm docker:build:agents
fi

if [[ "$CAM_DEPLOY_MODE" == "docker" ]]; then
  echo "[INFO] Docker 模式：重建并拉起容器"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build
else
  echo "[INFO] 宿主机模式：重新构建 Next.js"
  pnpm --filter @cam/shared build
  pnpm --filter @cam/web build

  echo "[INFO] 重启服务"
  systemctl restart cam-web
  sleep 3
fi

echo "[INFO] 健康检查"
retries=0
while (( retries < 10 )); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "[OK] 升级完成 (模式: ${CAM_DEPLOY_MODE})"
    exit 0
  fi
  sleep 2
  (( retries++ ))
done
echo "[WARN] 健康检查未通过，请检查日志："
if [[ "$CAM_DEPLOY_MODE" == "docker" ]]; then
  echo "  docker logs server-web-1 --tail 30"
else
  echo "  journalctl -u cam-web --no-pager -n 30"
fi
exit 1
