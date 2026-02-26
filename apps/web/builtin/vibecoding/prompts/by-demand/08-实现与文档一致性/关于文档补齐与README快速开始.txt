# 文档补齐与 README 快速开始（执行版）

【输入】
- scope：文档范围（全仓库/模块/命令/API）。
- acceptance_criteria：Quickstart 固定 3-6 步；明确前置条件、关键命令（install/run/test/build）、配置项（含 `.env.example` 策略）。
- constraints：篇幅限制、是否允许改代码、是否禁止引入新工具。
- （可留空）audience：使用者/贡献者/两者。

【需要完成的功能】
- 补齐/修正文档，重点完善 `README.md` 的 Quickstart，让新同学 clone 后可直接跑通。

【注意事项】
- 通用执行基线（必须）：先确认目标与验收（≤3 行）→扫描仓库事实→3-7 步执行（每步含影响面/验证/回滚）→回填证据；最多追问 3 个阻塞问题；每条 `acceptance_criteria` 必须映射证据；至少 1 条失败路径验证；按【输出】原样输出。
- 默认从仓库自动提取命令与入口，不得凭空编写命令。
- 文档以“可运行”为准：能跑就跑，不能跑说明阻塞与替代验证。
- README、脚本、示例配置的命名和参数必须一致。

【输出】
- 输入确认结果（范围、验收口径、约束）。
- 扫描结论（文档现状、可用命令、缺口清单）。
- 执行计划（3-7 步，每步含验证与回滚点）。
- 变更清单（按文件：README/docs/.env.example 等）。
- 验证命令与结果摘要。
- Quickstart 最终文本（可直接粘贴）。
- 风险补充（未完成项/原因/下一步）。
- 回归清单（至少覆盖 install/run/test 或 smoke）。
- 验收映射表（acceptance_criteria → 改动点 → 验证证据）。
- 机器可读摘要（JSON）：{"status":"success|partial|blocked","scope":[],"changed_files":[],"verification":[],"unresolved":[],"next_actions":[]}。
