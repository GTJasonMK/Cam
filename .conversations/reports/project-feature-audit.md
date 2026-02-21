# 项目功能完成度与风险审查报告

- 审查日期：2026-02-20
- 审查深度：深度（功能盘点 + 风险分级 + 运行验证）
- review_target：当前仓库主代码（`apps/web` + `apps/worker` + `packages/shared`）及当前工作区状态
- report_path：`.conversations/reports/project-feature-audit.md`
- 综合评分：**78 / 100**
- 审查结论：**核心功能闭环已具备，需修复关键风险后再进入下一轮上线评审**

---

## 一、扫描结论（项目事实：可用命令、审查范围、相似约定）

### 1) 项目事实

- 架构：`pnpm workspace` monorepo，核心模块为：
  - `apps/web`：Next.js 15（App Router）+ API + WebSocket/SSE + Drizzle/SQLite
  - `apps/worker`：外部/容器 Worker 轮询执行器
  - `packages/shared`：共享类型与工具
- 关键规模：
  - API 路由处理器：`46`（`rg --files apps/web/src/app/api -g 'route.ts' | wc -l`）
  - 页面：`13`（`rg --files apps/web/src/app -g 'page.tsx' | wc -l`）
  - 核心数据表：`12`（`apps/web/src/lib/db/schema.ts`）
  - 单测文件：`13`（`apps/web/src/**/*.test.ts`）
  - E2E 用例：`4`（`apps/web/e2e/*.spec.ts`）

### 2) 已执行验证（留痕）

| 命令 | 结果 | 摘要 |
| --- | --- | --- |
| `timeout 60s pnpm --filter @cam/web test` | ✅ 通过 | `13/13` 全通过 |
| `timeout 60s pnpm --filter @cam/web exec tsc --noEmit --pretty false` | ✅ 通过 | 无类型错误输出 |
| `timeout 60s pnpm --filter @cam/web lint` | ⚠️ 超时 | 60s 内未完成，进程被 `SIGTERM` |
| `timeout 60s pnpm --filter @cam/web test:e2e` | ❌ 失败 | `Error: listen EPERM ... /tmp/tsx-1000/*.pipe`，WebServer 启动失败 |

### 3) 审查范围

- 代码结构与能力面扫描：
  - API：`apps/web/src/app/api/**/route.ts`
  - 页面：`apps/web/src/app/**/page.tsx`
  - 数据模型：`apps/web/src/lib/db/schema.ts`
  - 调度与执行：`apps/web/src/lib/scheduler/*`、`apps/worker/src/*`
  - 终端编排：`apps/web/src/lib/terminal/*`
- 重点抽样了认证、任务编排、模板导入导出、Worker 生命周期、可观测性链路。

### 4) 相似约定（用于判断“是否符合现有实现习惯”）

- API 层统一使用 `withAuth(...)` 做认证与权限门控。
- 输入校验集中在 `apps/web/src/lib/validation/*.ts`。
- 实时反馈统一通过 `sseManager.broadcast(...)`。
- 任务状态中心对象为 `tasks` 表；事件审计中心为 `system_events` 表。

---

## 二、当前项目已完成功能清单（我们当前项目完成了哪些功能）

### 1) 认证与账户体系（已完成）

- 登录模式：
  - 用户系统（用户名密码 + Session）
  - Legacy Token 模式兼容
  - 无认证模式（虚拟 admin）
- OAuth：
  - 支持 OAuth provider 跳转与回调建链
  - 首次 OAuth 用户可自动建档
- 用户与权限：
  - RBAC（`admin/developer/viewer`）
  - 用户管理（创建、编辑、禁用、删除、重置密码）
  - 个人中心（改密、会话管理、API Token 管理）
- 证据：
  - `apps/web/src/app/api/auth/*`
  - `apps/web/src/lib/auth/with-auth.ts`
  - `apps/web/src/lib/auth/permissions.ts`
  - `apps/web/src/app/users/page.tsx`
  - `apps/web/src/app/profile/page.tsx`

### 2) 任务与流水线编排（已完成）

- 任务全生命周期：
  - 创建、查询、更新、删除、取消、重跑、审批
  - 依赖关系（`dependsOn`）与分组（`groupId`）
- 批量流水线：
  - 支持 `batch` 创建串行依赖任务
  - 支持 group 级别的取消、失败重跑、从指定步骤重启
- 证据：
  - `apps/web/src/app/api/tasks/*`
  - `apps/web/src/app/api/task-groups/*`
  - `apps/web/src/app/tasks/page.tsx`
  - `apps/web/src/app/tasks/[id]/page.tsx`

### 3) 模板系统（单任务 + 流水线）（已完成）

- 模板能力：
  - 单任务模板 CRUD
  - 流水线模板（步骤列表 + 步骤级 agent）
- 导入导出能力：
  - JSON 导入/导出
  - 导入时 Agent 引用存在性校验
  - 文件大小校验（默认 2MB）
- 证据：
  - `apps/web/src/app/templates/page.tsx`
  - `apps/web/src/lib/pipeline-io.ts`
  - `apps/web/src/app/api/task-templates/*`
  - `apps/web/src/app/api/task-templates/_agent-validation.ts`

### 4) 终端与 Agent 会话（已完成）

- WebSocket + PTY 交互终端
- Agent 会话创建/恢复/继续
- 终端流水线步骤推进（含 hook 回调驱动）
- 会话与任务关联能力
- 证据：
  - `apps/web/src/app/terminal/page.tsx`
  - `apps/web/src/lib/terminal/ws-handler.ts`
  - `apps/web/src/lib/terminal/agent-session-manager.ts`
  - `apps/web/src/app/api/agent-sessions/[id]/link-task/route.ts`

### 5) Worker 调度与执行（已完成，存在稳定性风险）

- Worker 模式：
  - daemon 轮询模式
  - task 单任务模式
- 调度能力：
  - waiting/queued/running 状态转换
  - 依赖完成后晋级
  - 启动恢复（dangling running task recovery）
- 执行能力：
  - clone/branch/agent run/commit/push
  - 心跳、取消检测、日志缓冲
- 证据：
  - `apps/web/src/lib/scheduler/index.ts`
  - `apps/web/src/lib/scheduler/logic.ts`
  - `apps/web/src/app/api/workers/*`
  - `apps/worker/src/index.ts`
  - `apps/worker/src/executor.ts`
  - `apps/worker/src/git-ops.ts`

### 6) 可观测性与运维面板（已完成）

- Dashboard：KPI、Worker 状态、Agent 统计、最近事件
- 事件中心：系统事件查询 + SSE 实时流
- 健康检查：`/api/health`
- 运行配置检查：`/api/settings/env`（仅返回状态，不泄露值）
- 证据：
  - `apps/web/src/app/page.tsx`
  - `apps/web/src/app/dashboard-client.tsx`
  - `apps/web/src/app/events/page.tsx`
  - `apps/web/src/app/api/events/route.ts`
  - `apps/web/src/app/api/events/stream/route.ts`
  - `apps/web/src/app/api/settings/env/route.ts`

---

## 三、问题清单（P0/P1/P2）

| 分级 | 位置 | 问题 | 触发条件（边界） | 影响 | 建议（含建议测试） | 证据 | 验证方式 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **P0** | `apps/web/src/lib/auth/oauth/flow.ts:59`、`apps/web/src/app/api/auth/oauth/[provider]/callback/route.ts:51` | `verifyOAuthState` 可能抛异常导致 OAuth 回调 500 | 传入形如 `a:b:c:d` 但 `hmac` 长度异常时，`timingSafeEqual` 会抛 `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`；且调用在 `try` 外 | OAuth 登录可被畸形请求打成 500，影响登录可用性与告警噪音 | 1) 比较前先校验长度；2) `verifyOAuthState` 内部兜底 `try/catch`；3) 回调路由将 state 校验放入 `try` | `node -e ... timingSafeEqual(...)` 输出 `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`；代码调用点在 `try` 之外 | 增加单测：非法 state 长度应返回 `false`；增加回调集成测试：非法 state 应 302 回登录页（非 500） |
| **P1** | `apps/worker/src/api-client.ts:150`、`apps/web/src/middleware.ts:46`、`apps/web/src/app/api/` | Worker 调用的日志持久化接口不存在 | Worker 执行任务时触发 `appendTaskLogs`，请求 `/api/tasks/:id/logs/append` | 任务日志无法入库，排障信息丢失；执行期反复报错（噪音） | 1) 新增 `POST /api/tasks/[id]/logs/append`；2) 写入 `task_logs`；3) 受限鉴权（仅 worker 内部） | Worker 端有调用；middleware 已为该路径做限流豁免；但 `apps/web/src/app/api` 下无 logs 相关 `route.ts` | 跑一条真实任务，检查 `task_logs` 是否有行；API 返回应为 `200` |
| **P1** | `apps/web/src/lib/auth/session.ts:10`、`apps/web/src/lib/auth/session.ts:39`、`apps/web/src/lib/auth/session.ts:47` | `CAM_SESSION_TTL_HOURS` 非法值会导致会话创建异常 | 配置为非数字（如 `abc`）时，`expiresAt` 成为 `Invalid Date`，`toISOString()` 抛 `RangeError` | 密码登录/OAuth 登录/初始化后建会话均可能失败 | 1) TTL 统一通过 `safeParsePositiveInt` 解析；2) 创建会话和 cookie 逻辑共用同一兜底值 | 代码中 `parseInt` 结果未用于 `createSession` 兜底；`node` 复现输出 `Invalid Date` + `RangeError` | 增加配置单测：`abc/0/-1/24` 的行为断言；联调登录 API |
| **P1** | `apps/worker/src/index.ts:138`、`apps/worker/src/index.ts:160` | daemon Worker 优雅退出不完整（心跳 interval 未回收） | 收到 `SIGTERM/SIGINT` 时仅 `isRunning=false`，但 `setInterval` 仍在 | 进程可能无法及时退出，导致停机/发布窗口内僵持，Worker 状态回收变慢 | 1) `startIdleHeartbeat` 返回 `intervalId`；2) 在信号处理与 `main` 退出前 `clearInterval`；3) 退出前发一次 `offline` 心跳 | 代码中创建 interval 后无任何 `clearInterval` 调用 | 编写进程级测试：发送 `SIGTERM` 后 5 秒内退出；并校验最后状态上报 |
| **P2（风险点）** | `apps/web/src/lib/auth/oauth/flow.ts:10-13` | OAuth state secret 存在硬编码兜底 | 未配置 `CAM_OAUTH_STATE_SECRET` 且未配置 `CAM_AUTH_TOKEN` | 生产环境若误配置，state 签名熵不足，安全边界被动下探 | 1) 生产环境强制要求显式 secret；2) 启动时校验并 fail-fast | 代码存在固定兜底 `'cam-oauth-state-default-key'` | 在 `NODE_ENV=production` 且缺 secret 时启动应失败 |
| **P2（验证阻塞）** | `apps/web/playwright.config.ts`、本次运行日志 | E2E 当前环境无法稳定执行 | `pnpm --filter @cam/web test:e2e` 启动 webServer 时出现 `listen EPERM ... /tmp/tsx-1000/*.pipe` | 回归验证链条不完整，关键交互回归可能漏检 | 1) 使用 `PLAYWRIGHT_EXTERNAL_SERVER=1` 接入外部已启动服务；2) 统一 Node/WSL 执行环境 | 本次执行命令直接失败并给出 EPERM | 在统一环境重跑 E2E，至少覆盖 auth/templates/tasks-template |

---

## 四、整改优先级路线图（按 P0 → P1 → P2）

1. **P0：修复 OAuth state 校验异常路径**
- 收益：直接消除登录可用性故障点（500 -> 可控失败）。
- 风险：低（局部逻辑修正）。
- 预计工作量：**0.5 人日**。

2. **P1：补齐任务日志持久化端点**
- 收益：恢复关键可观测性，提升线上问题可定位性。
- 风险：中（涉及鉴权与写入限流策略）。
- 预计工作量：**0.5 ~ 1 人日**。

3. **P1：修复会话 TTL 配置健壮性**
- 收益：避免配置偏差导致整条登录链路失效。
- 风险：低。
- 预计工作量：**0.5 人日**。

4. **P1：完善 Worker 优雅退出**
- 收益：提高发布/缩容稳定性，减少僵尸 Worker。
- 风险：中（需验证 daemon 与 task 两模式一致性）。
- 预计工作量：**0.5 ~ 1 人日**。

5. **P2：生产安全基线与 E2E 环境治理**
- 收益：降低运维误配风险，补齐回归验证可信度。
- 风险：低到中（跨环境配置协调）。
- 预计工作量：**1 人日**。

---

## 五、建议验证清单（命令或手工步骤，不要求已执行）

### 1) 自动化命令

1. `pnpm --filter @cam/web exec tsc --noEmit --pretty false`
2. `pnpm --filter @cam/web test`
3. `pnpm --filter @cam/web lint`
4. `PLAYWRIGHT_EXTERNAL_SERVER=1 pnpm --filter @cam/web test:e2e`

### 2) 最小手工回归

1. OAuth 回调传非法 state（长度异常）应稳定重定向登录页，不应返回 500。
2. 启动 Worker 执行一条任务后，确认 `task_logs` 表有持续追加日志。
3. 将 `CAM_SESSION_TTL_HOURS` 设为非法值后，登录接口应仍可成功建会话（使用默认 TTL）。
4. 启动 daemon Worker 后发送 `SIGTERM`，应在预期时间内退出并回收状态。
5. 跑模板导入/导出回归（含步骤级 agentDefinitionId 非法场景）。

---

## 六、结论与 PR 自检结论

- 当前项目已具备完整的“认证 → 模板/任务编排 → Worker 执行 → 终端交互 → 事件可观测”主流程能力。
- 现阶段主要短板不是功能缺失，而是**稳定性与可观测性缺口**（P0/P1 项）。
- **PR 自检结论：需修复后再审。**
  - 必修门槛：P0 全部关闭 + P1 至少关闭日志持久化与会话 TTL 两项。
  - 建议门槛：E2E 恢复可跑后，再做一次完整回归评审。
