# Web 应用 Dockerfile (Next.js)
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

# 运行阶段
FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 预创建数据/日志/仓库目录并赋予 nextjs 用户写权限
RUN mkdir -p /app/data /app/logs /app/repos && \
    chown -R nextjs:nodejs /app/data /app/logs /app/repos

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/builtin ./apps/web/builtin
# standalone 不含原生 .node 二进制，从 builder 补充完整 node_modules
COPY --from=builder /app/node_modules ./node_modules

USER nextjs
EXPOSE 3000
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "apps/web/server.js"]
