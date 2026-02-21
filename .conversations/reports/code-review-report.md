# 代码审查报告（以 Bug/风险为核心）

- 审查日期：2026-02-20
- 审查深度：标准
- review_target：当前工作区相对 `HEAD` 的改动（默认目标）
- report_path：`.conversations/reports/code-review-report.md`
- 结论评分：**66 / 100**
- 总结结论：**需修复后再审**

## 扫描结论（项目事实：可用命令、审查范围、相似约定）

### 项目事实

- 技术栈：`TypeScript` + `Next.js 15 (App Router)` + `React 19` + `pnpm workspace` + `drizzle` + `Playwright`。
- 可用质量命令（来自 `package.json`）：
  - `pnpm --filter @cam/web lint`
  - `pnpm --filter @cam/web test`
  - `pnpm --filter @cam/web test:e2e`
  - `pnpm --filter @cam/web exec tsc --noEmit --pretty false`

### 审查范围

- `git diff --name-only`：44 个文件处于改动状态。
- `git diff --ignore-all-space --numstat`：存在语义变化的文件仅 3 个：
  - `apps/web/src/app/templates/page.tsx`
  - `apps/web/src/components/terminal/pipeline-create-dialog.tsx`
  - `apps/web/src/lib/i18n/ui-messages.ts`
- 另有 1 个**未跟踪新文件**：
  - `apps/web/src/lib/pipeline-io.ts`

### 相似约定（用于对照）

- 输入校验约定集中在 `apps/web/src/lib/validation/*.ts`（纯函数解析与规范化）。
- 任务模板接口在 `apps/web/src/app/api/task-templates/*.ts`，对顶层 `agentDefinitionId` 有存在性校验。
- 相关测试现状：
  - 单测：`apps/web/src/lib/validation/task-template-input.test.ts`（覆盖任务模板基础校验）
  - E2E：`apps/web/e2e/templates.spec.ts`（覆盖模板增删改）
  - 当前新增导入/导出功能未发现直接测试覆盖。

### 已执行验证（留痕）

- `timeout 60s pnpm --filter @cam/web test`：**通过**（11/11）。
- `timeout 60s pnpm --filter @cam/web lint`：**超时终止**（exit 124）。
- `timeout 60s pnpm --filter @cam/web exec eslint ...`：**超时终止**（exit 124）。
- `timeout 60s pnpm --filter @cam/web exec tsc --noEmit --pretty false`：**通过**（exit 0）。

---

## 问题清单（P0/P1/P2）

| 分级 | 位置 | 问题 | 触发条件（边界） | 影响 | 建议（含建议测试） | 证据 | 验证方式 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | `apps/web/src/app/templates/page.tsx:20`、`apps/web/src/components/terminal/pipeline-create-dialog.tsx:22`、`apps/web/src/lib/pipeline-io.ts` | 新增依赖文件 `pipeline-io.ts` 仍为未跟踪状态，存在提交遗漏风险 | 若提交/PR 未包含该文件（当前状态即 `??`） | CI/构建直接失败（模块无法解析），属于阻塞合并问题 | 1) 将 `apps/web/src/lib/pipeline-io.ts` 纳入版本控制。2) 加 pre-commit 检查：禁止有 `??` 文件时合并。建议测试：在干净克隆中执行 `pnpm --filter @cam/web exec tsc --noEmit` | `git status --short` 显示 `?? apps/web/src/lib/pipeline-io.ts`；`git ls-files apps/web/src/lib/pipeline-io.ts` 无输出 | 干净工作区执行：`git clean -fdx && pnpm install && pnpm --filter @cam/web build`，确认无 `Module not found` |
| P1 | `apps/web/src/lib/pipeline-io.ts:141`、`apps/web/src/lib/pipeline-io.ts:149`、`apps/web/src/app/templates/page.tsx:203`、`apps/web/src/app/api/task-templates/route.ts:67`、`apps/web/src/lib/terminal/agent-session-manager.ts:487` | 导入流程缺少“步骤级 agentDefinitionId 存在性校验”，可写入不可执行模板/配置 | 导入 JSON 中 `steps[*].agentDefinitionId` 为不存在的 agent id（格式合法但业务无效） | 模板可被保存，但运行流水线时在服务端抛错 `Agent 定义不存在`，导致运行期失败 | 1) 导入前调用 `/api/agents` 校验 root/step agent id。2) API 层补充对 `pipelineSteps[*].agentDefinitionId` 的存在性校验（create+update）。3) 对未知 agent 提示可选“替换为默认 Agent/阻断导入”。建议测试：新增 API 单测 + 前端导入失败 E2E | `parsePipelineImport` 仅校验字符串，不校验业务存在性；`task-templates` API 仅校验顶层 `agentDefinitionId`；`createPipeline` 遇不存在 agent 抛错 | 构造含不存在 agent id 的 JSON 导入，预期在导入阶段被阻断；并验证 API 对非法步骤 agent 返回 4xx |
| P1 | 变更集整体（44 文件） | 大量无语义的格式/换行改动与功能改动混在同一批次，降低审查可见性 | 当前 diff 44 文件中，语义变更主要集中在 3 文件 | 容易掩盖真实缺陷、增加冲突与回滚复杂度，提升回归风险 | 将“格式化/换行规范化”与“功能改动”拆分为独立提交；增加 `.gitattributes` 统一行尾。建议测试：拆分后再次 review，保证功能 PR 只含语义改动 | `git diff --name-only`=44；`git diff --ignore-all-space --numstat` 仅 3 文件有有效增删 | 重新生成两组提交并复跑 `git diff --stat`，确保功能 PR 的改动面可控 |
| P2 | 新增功能路径（导入/导出） | 缺少针对导入/导出能力的测试覆盖（单测与 E2E） | 当前 feature 新增后，无对应 `*.test.ts`/`*.spec.ts` 覆盖关键流程 | 后续重构时容易出现解析兼容性回归、按钮行为回归 | 增加最小回归：1) `parsePipelineImport` 单测（正常/非法 JSON/非法 type/未知字段/边界值）；2) `Templates` 导入成功与失败提示 E2E；3) `PipelineCreateDialog` 导入后发起执行 E2E | `rg -n "importTemplate|exportTemplate|importConfig|exportConfig|pipeline-io" ... -g '*.test.ts' -g '*.spec.ts'` 无命中；`git diff --name-only | rg "(test|spec)..."` 无命中 | 新增测试后执行：`pnpm --filter @cam/web test`、`pnpm --filter @cam/web test:e2e` |
| P2（风险点/待验证） | `apps/web/src/lib/pipeline-io.ts:105`、`apps/web/src/lib/pipeline-io.ts:174` | 导入文件无体积上限与分层校验，`JSON.parse` 在主线程直接解析 | 导入超大 JSON（例如数十 MB）或恶意嵌套数据 | 前端卡顿、页面短暂失去响应（可用性风险） | 1) 在读取阶段限制 `file.size`（如 1~2MB）。2) 先做轻量 schema 快速失败。3) 必要时 Web Worker 解析。建议测试：手工导入 1MB/5MB/20MB 文件观察耗时与可用性 | `openPipelineFile` 直接 `readAsText`；`parsePipelineImport` 直接 `JSON.parse`，无体积阈值分支 | 手工性能回归：导入不同体积文件并记录 UI 响应时间（首次渲染与交互） |

---

## 整改优先级路线图（按 P0→P1→P2；每项含收益/风险/预计工作量）

1. P0：补齐提交完整性（`pipeline-io.ts` 入库）
   - 收益：立即解除构建/合并阻塞，保证分支可复现。
   - 风险：极低（流程修复）。
   - 预计工作量：**0.5 人时**。

2. P1：补齐导入链路的业务校验（尤其步骤级 agent）
   - 收益：把运行期失败前移到导入阶段，降低线上错误与脏数据沉淀。
   - 风险：中（需兼顾历史数据与错误提示文案）。
   - 预计工作量：**1~1.5 人日**（前端校验 + API 校验 + 回归测试）。

3. P1：拆分无语义改动与功能改动
   - 收益：提升审查效率，减少回滚/冲突风险。
   - 风险：低（提交整理成本）。
   - 预计工作量：**0.5 人时**。

4. P2：补最小回归测试（导入/导出主链路）
   - 收益：降低功能回归概率，提高改动可维护性。
   - 风险：低（测试编写与环境耗时）。
   - 预计工作量：**0.5~1 人日**。

5. P2：导入性能与文件大小保护
   - 收益：提升大文件场景稳定性，减少前端冻结风险。
   - 风险：低到中（阈值设计与 UX 提示）。
   - 预计工作量：**0.5 人日**。

---

## 建议验证清单（命令或手工步骤，不要求已执行）

### 自动化命令

1. `pnpm --filter @cam/web exec tsc --noEmit --pretty false`
2. `pnpm --filter @cam/web test`
3. `pnpm --filter @cam/web lint`（建议在无 60s 限制的 CI 环境执行）
4. `pnpm --filter @cam/web test:e2e --grep "模板|流水线|导入|导出"`（补测试后执行）

### 手工回归（最小集）

1. 在 `Templates` 页面导入合法流水线 JSON，确认创建成功并可见。
2. 导入包含不存在 `agentDefinitionId` 的 JSON，确认在导入阶段被阻断（而非运行时失败）。
3. 在 `PipelineCreateDialog` 导入配置后直接启动，确认能成功创建流水线。
4. 导入超大 JSON（>2MB）时，确认有明确错误提示且 UI 不冻结。
5. 使用导出的 JSON 再导入（round-trip），确认字段不丢失且行为一致。

---

## 审查结论

- 当前 PR 状态：**需修复后再审**
- 阻塞项：**存在 P0（未跟踪关键新增文件）**
- 通过门槛建议：
  1. 先清除 P0；
  2. 完成 P1 的 agent 校验闭环；
  3. 至少补充 1 条导入失败回归测试（非法 agent id）。
