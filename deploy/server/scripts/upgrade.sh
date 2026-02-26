#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# CAM 服务器升级脚本
# 在仓库根目录执行：
#   bash deploy/server/scripts/upgrade.sh
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

echo "[INFO] 安装依赖"
corepack enable
pnpm install --frozen-lockfile

echo "[INFO] 重新构建 worker agent 镜像"
pnpm docker:build:agents

echo "[INFO] 执行数据库迁移"
DATABASE_PATH="$CAM_DATA_DIR/cam.db" pnpm db:migrate

echo "[INFO] 重建并拉起 web"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

echo "[INFO] 健康检查"
curl -fsS http://127.0.0.1:3000/api/health >/dev/null
echo "[OK] 升级完成"
