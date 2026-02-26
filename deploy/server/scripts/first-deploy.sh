#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# CAM 服务器首次部署脚本
# 在仓库根目录执行：
#   bash deploy/server/scripts/first-deploy.sh
# ============================================================

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/server/.env.prod"
COMPOSE_FILE="$ROOT_DIR/deploy/server/docker-compose.server.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ERROR] 缺少 $ENV_FILE"
  echo "请先复制模板并填写："
  echo "  cp deploy/server/.env.prod.example deploy/server/.env.prod"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] 未检测到 docker"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[ERROR] 未检测到 docker compose 插件"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[ERROR] 未检测到 pnpm"
  exit 1
fi

cd "$ROOT_DIR"

echo "[INFO] 载入环境变量: $ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${CAM_DATA_DIR:=/opt/cam/data}"
: "${CAM_LOGS_DIR:=/opt/cam/logs}"
: "${CAM_REPOS_DIR:=/opt/cam/repos}"

mkdir -p "$CAM_DATA_DIR" "$CAM_LOGS_DIR" "$CAM_REPOS_DIR"

echo "[INFO] 安装依赖"
corepack enable
pnpm install --frozen-lockfile

echo "[INFO] 初始化数据库"
DATABASE_PATH="$CAM_DATA_DIR/cam.db" pnpm db:migrate
DATABASE_PATH="$CAM_DATA_DIR/cam.db" pnpm db:seed

if [[ "${CAM_BUILD_AGENT_IMAGES:-false}" == "true" ]]; then
  echo "[INFO] 构建 worker agent 镜像"
  pnpm docker:build:agents
else
  echo "[INFO] 跳过 worker agent 镜像构建（如需构建请设置 CAM_BUILD_AGENT_IMAGES=true）"
fi

echo "[INFO] 启动服务"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

echo "[INFO] 健康检查"
curl -fsS http://127.0.0.1:3000/api/health >/dev/null
echo "[OK] 部署完成，web 已启动在 127.0.0.1:3000（请继续配置 Nginx + HTTPS）"
