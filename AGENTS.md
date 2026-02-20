# Repository Guidelines

## 项目结构与模块组织

- `apps/web/`：Next.js 15（App Router）Web UI + API 路由 + 调度器（Dockerode）。源码在 `apps/web/src/`；E2E 在 `apps/web/e2e/`；迁移在 `apps/web/drizzle/`；SQLite 默认 `apps/web/data/cam.db`。
- `apps/worker/`：任务执行 Worker（通常在容器中运行），负责 clone/分支/运行 Agent CLI/推送。源码 `apps/worker/src/` → 构建产物 `apps/worker/dist/`。
- `packages/shared/`：共享类型与工具，`tsup` 构建（`packages/shared/src/` → `packages/shared/dist/`）。

## 构建、测试与本地开发命令

- 安装依赖：`corepack enable && pnpm install`
- Web 开发：`pnpm dev:web`（默认 `http://localhost:3000`）
- 全部开发：`pnpm dev`（同时起 web + worker；仅在你要跑“常驻 worker”时使用）
- 单独启动 Worker：`pnpm dev:worker`（外部常驻 worker 模式；需本机可运行对应 Agent CLI）
- DB 初始化：`pnpm db:migrate && pnpm db:seed`（修改 schema 后生成迁移：`pnpm db:generate`）
- 构建 Agent 镜像：`pnpm docker:build:agents`（生成 `cam-worker:claude-code/codex/aider`）
- 代码检查/构建：`pnpm lint` / `pnpm build`
- 单元测试/E2E：`pnpm --filter @cam/web test` / `pnpm --filter @cam/web test:e2e`（交互：`pnpm --filter @cam/web test:e2e:ui`）
- 单机 Docker 部署：`docker compose up --build`（见 `docker-compose.yml`）
- Windows 快速启动：`start-dev.bat`（SQLite 模式；主要用于 UI 开发）

## 本地跑通一个任务（Windows + WSL2）

- 前置：Docker Desktop 开启 WSL2 集成；在 WSL 中能运行 `docker ps`。
- 运行：先 `pnpm docker:build:agents`，再 `pnpm db:migrate && pnpm db:seed`，最后 `pnpm dev:web` 打开 WebUI 创建任务。
- 密钥：按所选 Agent 配置 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`；需要 push/PR 时配置 `GITHUB_TOKEN`（PAT，需 repo 写权限）。

## 代码风格与命名约定

- TypeScript strict；2 空格缩进、单引号、分号；Web 侧导入优先 `@/…`。
- 命名：组件 `PascalCase.tsx`；hooks `useX.ts`；其余文件名尽量小写。

## 提交与 PR 指南

- 使用 Conventional Commits：`feat(web): ...`、`fix(worker): ...`。
- PR 必填：变更说明 + 验证命令（例如 `pnpm lint && pnpm build`）+ UI 变更截图；涉及 DB 同步提交 `apps/web/drizzle/` 迁移。

## 配置提示

- `CAM_AUTH_TOKEN`：启用 Web 访问令牌保护；E2E 默认用 `playwright-token`。
- `CAM_MASTER_KEY`：启用 Secrets 加密入库；未配置时可直接用进程环境变量注入密钥。
- `DATABASE_PATH` / `DOCKER_SOCKET_PATH` / `API_SERVER_URL`：分别覆盖 SQLite 路径、Docker sock、Worker → Web API 地址。
- `CAM_WORKER_REPORTED_ENV_VARS`：外部常驻 Worker 用于“上报已配置的变量名”（不上传值），便于 WebUI 做可用性提示。
