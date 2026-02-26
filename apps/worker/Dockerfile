# Worker 基础镜像
FROM node:20-slim AS base

RUN apt-get update && apt-get install -y \
    git \
    openssh-client \
    curl \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 构建阶段
FROM base AS builder

COPY apps/worker/package.json apps/worker/tsconfig.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

RUN corepack enable && pnpm install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY apps/worker/ ./apps/worker/

RUN pnpm --filter @cam/shared build && pnpm --filter @cam/worker build

# 运行阶段
FROM base AS runner

COPY --from=builder /app/apps/worker/dist /app/dist
COPY --from=builder /app/apps/worker/package.json /app/
COPY --from=builder /app/node_modules /app/node_modules

# 环境变量由 Docker 启动时注入:
# WORKER_ID, API_SERVER_URL, SUPPORTED_AGENTS, ANTHROPIC_API_KEY, OPENAI_API_KEY, ...

CMD ["node", "dist/index.js"]
