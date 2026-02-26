#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# CAM 服务器首次部署脚本
# 支持两种模式：
#   CAM_DEPLOY_MODE=host   — 宿主机直接运行（默认，快速迭代）
#   CAM_DEPLOY_MODE=docker — Docker Compose 部署（完整隔离）
# ============================================================

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/server/.env.prod"
COMPOSE_FILE="$ROOT_DIR/deploy/server/docker-compose.server.yml"
SERVICE_FILE="$ROOT_DIR/deploy/server/systemd/cam-web.service"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ERROR] 缺少 $ENV_FILE"
  echo "请先复制模板并填写："
  echo "  cp deploy/server/.env.prod.example deploy/server/.env.prod"
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
: "${CAM_DEPLOY_MODE:=host}"

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

# ============================================================
# 按部署模式启动
# ============================================================

if [[ "$CAM_DEPLOY_MODE" == "docker" ]]; then
  # ---- Docker 模式 ----
  if ! command -v docker >/dev/null 2>&1; then
    echo "[ERROR] 未检测到 docker"
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "[ERROR] 未检测到 docker compose 插件"
    exit 1
  fi

  echo "[INFO] Docker 模式：构建并启动容器"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

else
  # ---- 宿主机模式 ----
  echo "[INFO] 宿主机模式：构建 Next.js"
  pnpm --filter @cam/shared build
  pnpm --filter @cam/web build

  # standalone 输出不包含静态资源，需手动复制
  echo "[INFO] 复制静态资源到 standalone 目录"
  cp -r "$ROOT_DIR/apps/web/.next/static" "$ROOT_DIR/apps/web/.next/standalone/apps/web/.next/static"

  echo "[INFO] 安装 systemd 服务"
  # 生成 service 文件（注入实际路径和环境变量）
  mkdir -p /etc/systemd/system
  sed \
    -e "s|__ROOT_DIR__|${ROOT_DIR}|g" \
    -e "s|__ENV_FILE__|${ENV_FILE}|g" \
    -e "s|__CAM_DATA_DIR__|${CAM_DATA_DIR}|g" \
    -e "s|__CAM_LOGS_DIR__|${CAM_LOGS_DIR}|g" \
    -e "s|__CAM_REPOS_DIR__|${CAM_REPOS_DIR}|g" \
    "$SERVICE_FILE" > /etc/systemd/system/cam-web.service

  systemctl daemon-reload
  systemctl enable cam-web
  systemctl restart cam-web

  echo "[INFO] 等待服务启动..."
  sleep 3
fi

echo "[INFO] 健康检查"
retries=0
while (( retries < 10 )); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "[OK] 部署完成 (模式: ${CAM_DEPLOY_MODE})，web 已启动在 127.0.0.1:3000"
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
