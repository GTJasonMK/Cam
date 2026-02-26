-- Codex CLI 参数修正：--approval-mode full-auto → --quiet --full-auto
-- 同时添加 CODEX_API_KEY 环境变量支持
UPDATE agent_definitions
SET args = '["--quiet","--full-auto","{{prompt}}"]',
    description = 'OpenAI Codex CLI agent, supports --full-auto and --quiet modes',
    required_env_vars = '[{"name":"CODEX_API_KEY","description":"Codex API Key（优先）","required":false,"sensitive":true},{"name":"OPENAI_API_KEY","description":"OpenAI API Key（备选）","required":false,"sensitive":true}]'
WHERE id = 'codex' AND built_in = 1;
--> statement-breakpoint
-- 新增 Codex 专用任务模板
INSERT OR IGNORE INTO task_templates (
  id, name, title_template, prompt_template, agent_definition_id, created_at, updated_at
)
SELECT
  'tpl-codex-bug-fix',
  '缺陷修复（Codex）',
  '修复: {{问题简述}}',
  '请分析并修复以下缺陷。

## 问题描述
{{问题简述}}

## 复现步骤
{{复现步骤（如有）}}

## 要求
1. 定位根因，避免表面修补
2. 编写或补充覆盖该场景的测试
3. 确保修复不引入新的回归问题
4. 每个逻辑变更独立 commit，使用 Conventional Commits 格式
5. 如果修改了公共接口，更新相关文档或注释',
  'codex',
  datetime('now'),
  datetime('now')
WHERE EXISTS (SELECT 1 FROM agent_definitions WHERE id = 'codex');
--> statement-breakpoint
INSERT OR IGNORE INTO task_templates (
  id, name, title_template, prompt_template, agent_definition_id, created_at, updated_at
)
SELECT
  'tpl-codex-feature',
  '新功能开发（Codex）',
  '功能: {{功能名称}}',
  '请实现以下新功能。

## 功能描述
{{功能名称}}

## 详细需求
{{需求详情}}

## 验收标准
{{验收标准（如有）}}

## 要求
1. 遵循项目既有的架构模式和编码规范
2. 编写完整的单元测试，覆盖率不低于 80%
3. 处理边界条件和错误场景
4. 如涉及 API 变更，更新相关类型定义
5. 每个功能点独立 commit，保持每次提交可编译
6. 使用 Conventional Commits 格式',
  'codex',
  datetime('now'),
  datetime('now')
WHERE EXISTS (SELECT 1 FROM agent_definitions WHERE id = 'codex');
--> statement-breakpoint
INSERT OR IGNORE INTO task_templates (
  id, name, title_template, prompt_template, agent_definition_id, created_at, updated_at
)
SELECT
  'tpl-codex-refactor',
  '代码重构（Codex）',
  '重构: {{重构目标}}',
  '请对指定模块进行重构。

## 重构目标
{{重构目标}}

## 重构范围
{{涉及的文件或模块}}

## 原则
1. 保持外部行为不变（所有现有测试必须继续通过）
2. 遵循 SOLID 原则和 DRY 原则
3. 每个函数/方法不超过 50 行，每个文件不超过 400 行
4. 提取重复逻辑为可复用的工具函数
5. 改善命名，使代码自文档化
6. 分多个小 commit 提交，每个 commit 保持可编译状态',
  'codex',
  datetime('now'),
  datetime('now')
WHERE EXISTS (SELECT 1 FROM agent_definitions WHERE id = 'codex');
--> statement-breakpoint
INSERT OR IGNORE INTO task_templates (
  id, name, title_template, prompt_template, agent_definition_id, created_at, updated_at
)
SELECT
  'tpl-codex-review',
  '代码审查（Codex）',
  '审查: {{审查范围}}',
  '请对指定代码进行全面审查。

## 审查范围
{{审查范围（分支名/文件路径）}}

## 审查维度
请从以下维度逐一评审并输出报告：

1. **代码质量** — 命名、可读性、复杂度、重复代码
2. **架构合理性** — 模块划分、依赖方向、关注点分离
3. **错误处理** — 异常捕获、降级策略、用户提示
4. **性能隐患** — 不必要的计算、内存泄漏、N+1 查询
5. **类型安全** — any 滥用、类型断言、空值处理
6. **测试覆盖** — 缺失的测试场景、测试质量

## 输出格式
- 每个问题标注严重级别：严重 / 建议 / 优化
- 给出具体的修复建议和代码示例
- 最后给出总结评分（0-100）和通过/退回建议',
  'codex',
  datetime('now'),
  datetime('now')
WHERE EXISTS (SELECT 1 FROM agent_definitions WHERE id = 'codex');
