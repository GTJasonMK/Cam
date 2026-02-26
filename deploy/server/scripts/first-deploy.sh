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

echo "[INFO] 部署模式: ${CAM_DEPLOY_MODE}"

# ============================================================
# 前置检查
# ============================================================

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[ERROR] 未检测到 pnpm，请先安装 Node.js 和 pnpm"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[ERROR] 未检测到 curl，请先安装: apt install -y curl"
  exit 1
fi

# 宿主机模式需要编译原生模块（node-pty, better-sqlite3）
if [[ "$CAM_DEPLOY_MODE" == "host" ]]; then
  missing_tools=()
  for tool in python3 make gcc g++; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      missing_tools+=("$tool")
    fi
  done
  if [[ ${#missing_tools[@]} -gt 0 ]]; then
    echo "[ERROR] 宿主机模式需要编译工具，缺少: ${missing_tools[*]}"
    echo "请先安装: apt install -y python3 make gcc g++"
    exit 1
  fi
fi

# 检查 3000 端口是否被占用
if command -v fuser >/dev/null 2>&1 && fuser 3000/tcp >/dev/null 2>&1; then
  echo "[WARN] 端口 3000 被占用，尝试释放..."
  # 先停掉可能残留的 Docker 容器
  if command -v docker >/dev/null 2>&1 && [[ -f "$COMPOSE_FILE" ]]; then
    docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
  fi
  # 停掉可能残留的 systemd 服务
  systemctl stop cam-web 2>/dev/null || true
  sleep 1
  # 如果还被占用，强制释放
  if fuser 3000/tcp >/dev/null 2>&1; then
    fuser -k 3000/tcp 2>/dev/null || true
    sleep 1
  fi
fi

# ============================================================
# 安装依赖 & 初始化数据库
# ============================================================

mkdir -p "$CAM_DATA_DIR" "$CAM_LOGS_DIR" "$CAM_REPOS_DIR"

echo "[INFO] 安装依赖"
corepack enable
pnpm install --frozen-lockfile

echo "[INFO] 初始化数据库"
DATABASE_PATH="$CAM_DATA_DIR/cam.db" pnpm db:migrate
DATABASE_PATH="$CAM_DATA_DIR/cam.db" pnpm db:seed

# 验证关键表存在
if command -v sqlite3 >/dev/null 2>&1; then
  tables=$(sqlite3 "$CAM_DATA_DIR/cam.db" ".tables")
  for required_table in users tasks agent_definitions system_events; do
    if ! echo "$tables" | grep -qw "$required_table"; then
      echo "[ERROR] 数据库缺少 $required_table 表，迁移可能不完整"
      echo "尝试手动修复: sqlite3 $CAM_DATA_DIR/cam.db < apps/web/drizzle/对应迁移文件.sql"
      exit 1
    fi
  done
  echo "[INFO] 数据库表验证通过"
fi

if [[ "${CAM_BUILD_AGENT_IMAGES:-false}" == "true" ]]; then
  echo "[INFO] 构建 worker agent 镜像"
  pnpm docker:build:agents
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
  # 使用自定义 server.ts（含 WebSocket 终端），直接用 .next 构建产物 + 完整 node_modules
  echo "[INFO] 宿主机模式：构建 Next.js"
  pnpm --filter @cam/shared build
  pnpm --filter @cam/web build

  echo "[INFO] 安装 systemd 服务"
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

# ============================================================
# 健康检查
# ============================================================

echo "[INFO] 健康检查"
retries=0
while (( retries < 15 )); do
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
