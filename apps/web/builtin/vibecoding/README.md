# vibe coding 提示词仓库

更新时间：2026-02-23（Codex）

本仓库按“**需求目录 + 原子模板**”组织提示词，目标是让 CLI Agent 在任意项目中实现：可编排、可执行、可验证。

## 使用方法

### 单模板模式（快速）
1. 在 `prompts/by-demand/<需求目录>/` 选一个模板。
2. 原样发送给 Agent，优先填写 `【输入】`（至少补 `scope / acceptance_criteria / constraints`）。
3. 要求按模板 `【输出】` 原顺序返回。

### 编排模式（推荐）
1. 先跑“仅分析/仅审查”模板。
2. 再跑“仅执行”模板（读取上一步报告或 handoff）。
3. 需要收口时再跑“仅审查”模板做最终核验。
4. 步骤通信统一走 `.conversations/pipeline-handoffs/<pipeline_id>/`。

更多示例见：`docs/使用示例.md`。

## 模板硬约束

- 固定四段：`【输入】/【需要完成的功能】/【注意事项】/【输出】`
- 单一职责：执行只执行、审查只审查、分析只分析
- 最多追问 3 个阻塞问题
- 必须包含：验收映射表 + 机器可读摘要（JSON）
- 审查/分析模板默认报告落盘：`.conversations/reports/`

## 需求目录与推荐链路

### 01 一键部署、运行、测试、打包
1. `prompts/by-demand/01-一键部署运行测试打包/关于项目构建的工作流.txt`（分析）
2. `prompts/by-demand/01-一键部署运行测试打包/关于跨平台一键脚本.txt`（执行）
3. `prompts/by-demand/01-一键部署运行测试打包/关于一键流程落地结果复审.txt`（审查）
4. `prompts/by-demand/01-一键部署运行测试打包/关于一键部署执行与验证.txt`（执行，扩展步骤）
5. `prompts/by-demand/01-一键部署运行测试打包/关于发布打包与版本管理.txt`（执行，扩展步骤）

### 02 项目重构
1. `prompts/by-demand/02-项目重构/关于重构方案分析.txt`（分析）
2. `prompts/by-demand/02-项目重构/关于模块的重构.txt`（执行）
3. `prompts/by-demand/02-项目重构/关于重构结果回归审查.txt`（审查）

### 03 冗余度检查并修复
1. `prompts/by-demand/03-冗余度检查并修复/关于冗余与重复审查.txt`（审查）
2. `prompts/by-demand/03-冗余度检查并修复/关于重构与消除重复.txt`（执行）
3. `prompts/by-demand/03-冗余度检查并修复/关于冗余治理回归审查.txt`（审查）

### 04 Bug 审查并修复
1. `prompts/by-demand/04-Bug审查并修复/关于代码审查与PR自检.txt`（审查）
2. `prompts/by-demand/04-Bug审查并修复/关于根据审查报告执行修复.txt`（执行）
3. `prompts/by-demand/04-Bug审查并修复/关于修复结果回归审查.txt`（审查）
4. `prompts/by-demand/04-Bug审查并修复/关于调试定位与修复Bug.txt`（执行，单步直修场景）

### 05 前后端性能提升审查并修复
1. `prompts/by-demand/05-前后端性能提升审查并修复/关于性能分析.txt`（后端分析）
2. `prompts/by-demand/05-前后端性能提升审查并修复/关于根据性能分析报告执行优化.txt`（后端执行）
3. `prompts/by-demand/05-前后端性能提升审查并修复/关于后端性能优化结果复审.txt`（后端审查）
4. `prompts/by-demand/05-前后端性能提升审查并修复/关于前端性能与包体积优化.txt`（前端分析）
5. `prompts/by-demand/05-前后端性能提升审查并修复/关于根据前端性能分析执行优化.txt`（前端执行）
6. `prompts/by-demand/05-前后端性能提升审查并修复/关于前端性能优化结果复审.txt`（前端审查）

### 06 前端美化设计并执行
1. `prompts/by-demand/06-前端美化设计并执行/关于ui的审查.txt`（审查）
2. `prompts/by-demand/06-前端美化设计并执行/关于ui问题整改落地.txt`（执行）
3. `prompts/by-demand/06-前端美化设计并执行/关于ui整改结果复审.txt`（审查）

### 07 已实现功能盘点、扩展发现与实现
1. `prompts/by-demand/07-功能盘点扩展发现与实现/关于功能扩展机会分析.txt`（分析）
2. `prompts/by-demand/07-功能盘点扩展发现与实现/关于根据功能扩展方案执行落地.txt`（执行）
3. `prompts/by-demand/07-功能盘点扩展发现与实现/关于功能扩展落地回归审查.txt`（审查）

### 08 实现与文档一致性
1. `prompts/by-demand/08-实现与文档一致性/关于实现与文档一致性审查.txt`（审查）
2. `prompts/by-demand/08-实现与文档一致性/关于API文档与OpenAPI维护.txt`（执行）
3. `prompts/by-demand/08-实现与文档一致性/关于文档补齐与README快速开始.txt`（执行）

### 09 跨项目优缺点借鉴并落地
1. `prompts/by-demand/09-跨项目功能借鉴落地/关于跨项目对标分析.txt`（分析）
2. `prompts/by-demand/09-跨项目功能借鉴落地/关于跨项目功能借鉴落地.txt`（执行）
3. `prompts/by-demand/09-跨项目功能借鉴落地/关于借鉴落地回归审查.txt`（审查）

### 10 GitHub 上传前准备
1. `prompts/by-demand/10-GitHub上传前准备/关于上传前扫描与风险审查.txt`（审查）
2. `prompts/by-demand/10-GitHub上传前准备/关于仓库清理与GitHub上传准备.txt`（执行）
3. `prompts/by-demand/10-GitHub上传前准备/关于上传前最终核验.txt`（审查）

### 11 从简单文档到 MVP 实现
1. `prompts/by-demand/11-从文档到MVP实现/关于MVP需求澄清与验收定义.txt`（分析）
2. `prompts/by-demand/11-从文档到MVP实现/关于MVP实施计划制定.txt`（分析）
3. `prompts/by-demand/11-从文档到MVP实现/关于根据计划实现MVP.txt`（执行）
4. `prompts/by-demand/11-从文档到MVP实现/关于MVP交付回归审查.txt`（审查）

## CAM 流水线导入

- 输出目录：`pipelines/cam-import/e2e/`（端到端工作流）
- 索引文件：`pipelines/cam-import/index.json`
- 通信目录：`.conversations/pipeline-handoffs/<pipeline_id>/`
- 重新生成：`node tools/generate-cam-pipelines.mjs`
- 步数策略：
  - `01~10`：4 步严格闭环（分析/审查 → 执行 → 复审 → 交付）
  - `11`：5 步闭环（需求澄清 → 计划制定 → 执行 → 复审 → 交付）

## 文档

- 写作指南：`docs/提示词模板写作指南.md`
- 模板骨架：`docs/模板骨架.txt`
- 使用示例：`docs/使用示例.md`
- CAM 导入指南：`docs/CAM流水线导入指南.md`
- 灵感参考：`docs/提示词灵感与参考.md`

## 维护说明

- 新增模板时优先放入对应需求目录并更新本索引。
- 文本文件统一：UTF-8 + LF。
