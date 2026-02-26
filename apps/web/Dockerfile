# Web 应用 Dockerfile (Next.js + WebSocket 自定义服务器)
FROM node:20-slim AS base

RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 构建阶段
FROM base AS builder

# node-pty 需要 python3 + make + gcc 编译原生模块
RUN apt-get update && apt-get install -y \
    python3 make gcc g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

RUN corepack enable && pnpm install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY apps/web/ ./apps/web/

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @cam/shared build && pnpm --filter @cam/web build

# 运行阶段：使用自定义 server.ts（包含 WebSocket 终端支持）
FROM base AS runner

# tsx 运行 TypeScript 需要的最小运行时；安装 Agent CLI 供终端使用
RUN corepack enable && npm install -g @anthropic-ai/claude-code @openai/codex

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --home /home/nextjs --ingroup nodejs nextjs

# 预创建数据/日志/仓库目录并赋予 nextjs 用户写权限
RUN mkdir -p /app/data /app/logs /app/repos && \
    chown -R nextjs:nodejs /app/data /app/logs /app/repos

ENV HOME=/home/nextjs

# 复制依赖（含原生模块）
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/tsconfig.base.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared

# 复制 web 应用（源码 + 构建产物）
COPY --from=builder /app/apps/web/package.json ./apps/web/
COPY --from=builder /app/apps/web/tsconfig.json ./apps/web/
COPY --from=builder /app/apps/web/server.ts ./apps/web/
COPY --from=builder /app/apps/web/src ./apps/web/src
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/builtin ./apps/web/builtin
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules

USER nextjs
EXPOSE 3000
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

WORKDIR /app/apps/web
CMD ["npx", "tsx", "server.ts"]
