import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const promptsDir = path.join(rootDir, 'prompts');
const outDir = path.join(rootDir, 'pipelines', 'cam-import');
const defaultAgentId = 'codex';

function getHandoffPaths(pipelineId) {
  const baseDir = `.conversations/pipeline-handoffs/${pipelineId}`;
  return {
    baseDir,
    step1Summary: `${baseDir}/step1-summary.md`,
    step1Json: `${baseDir}/step1-handoff.json`,
    step2Summary: `${baseDir}/step2-summary.md`,
    step2Json: `${baseDir}/step2-handoff.json`,
    step3Summary: `${baseDir}/step3-summary.md`,
    step3Json: `${baseDir}/step3-handoff.json`,
    step4Summary: `${baseDir}/step4-summary.md`,
    step4Json: `${baseDir}/step4-handoff.json`,
    finalSummary: `${baseDir}/final-delivery.md`,
    finalJson: `${baseDir}/final-delivery.json`,
  };
}

function buildStep1HandoffPrompt(handoff, upstreamTitle) {
  return [
    '',
    '流水线通信要求（必须执行）：',
    '- 本步骤结束前必须写入以下文件：',
    `  1) ${handoff.step1Summary}`,
    `  2) ${handoff.step1Json}`,
    '- `step1-summary.md` 必须包含：输入范围、关键发现（P0/P1/P2）、报告路径、阻塞项。',
    '- `step1-handoff.json` 必填字段：',
    `  - pipeline_id（固定为当前流水线 id）`,
    '  - step（固定为 "step1"）',
    `  - upstream_title（固定为 "${upstreamTitle}"）`,
    '  - upstream_report_path（本步骤实际产出的 report_path）',
    `  - summary_path（固定为 "${handoff.step1Summary}"）`,
    '  - priority_items（数组，按优先级排序）',
    '  - blockers（数组）',
    '  - generated_at（ISO 时间）',
  ].join('\n');
}

function buildStep2HandoffPrompt(handoff) {
  return [
    '',
    '流水线通信要求（必须执行）：',
    '- 本步骤开始前必须读取以下文件：',
    `  1) ${handoff.step1Summary}`,
    `  2) ${handoff.step1Json}`,
    '- 若通信文件缺失或字段不完整：必须先输出阻塞原因与修复动作，不得直接跳过。',
    '- 本步骤整改必须逐条映射 step1 的优先级问题，并在输出中给出“问题 → 改动 → 验证”映射。',
    '- 本步骤结束前必须写入以下文件：',
    `  1) ${handoff.step2Summary}`,
    `  2) ${handoff.step2Json}`,
    '- `step2-summary.md` 必须包含：执行计划、变更清单、验证结果、未完成项。',
    '- `step2-handoff.json` 必填字段：',
    '  - pipeline_id / step("step2")',
    `  - input_handoff_path（固定为 "${handoff.step1Json}"）`,
    `  - summary_path（固定为 "${handoff.step2Summary}"）`,
    '  - changed_files（数组）',
    '  - verification_commands（数组）',
    '  - unresolved_items（数组）',
    '  - generated_at（ISO 时间）',
  ].join('\n');
}

function buildStep2PlanningHandoffPrompt(handoff) {
  return [
    '',
    '流水线通信要求（必须执行）：',
    '- 本步骤开始前必须读取以下文件：',
    `  1) ${handoff.step1Summary}`,
    `  2) ${handoff.step1Json}`,
    '- 若通信文件缺失或字段不完整：必须先输出阻塞原因与修复动作，不得直接跳过。',
    '- 本步骤仅输出可执行计划，不改代码；计划需覆盖里程碑、影响面、验证与回滚策略。',
    '- 本步骤结束前必须写入以下文件：',
    `  1) ${handoff.step2Summary}`,
    `  2) ${handoff.step2Json}`,
    '- `step2-summary.md` 必须包含：目标拆解、执行顺序、风险点、验证门禁。',
    '- `step2-handoff.json` 必填字段：',
    '  - pipeline_id / step("step2")',
    `  - input_handoff_path（固定为 "${handoff.step1Json}"）`,
    `  - summary_path（固定为 "${handoff.step2Summary}"）`,
    '  - milestones（数组）',
    '  - execution_plan（数组）',
    '  - blockers（数组）',
    '  - generated_at（ISO 时间）',
  ].join('\n');
}

function buildStep3HandoffPrompt(handoff) {
  return [
    '',
    '流水线通信要求（必须执行）：',
    '- 本步骤开始前必须读取以下文件：',
    `  1) ${handoff.step1Summary}`,
    `  2) ${handoff.step1Json}`,
    `  3) ${handoff.step2Summary}`,
    `  4) ${handoff.step2Json}`,
    '- 若通信文件缺失或字段不完整：必须先输出阻塞原因与修复动作，不得直接跳过。',
    '- 本步骤复审必须逐条核对 step2 的改动与验证证据，输出“问题关闭状态 + 回归风险”。',
    '- 本步骤结束前必须写入以下文件：',
    `  1) ${handoff.step3Summary}`,
    `  2) ${handoff.step3Json}`,
    '- `step3-summary.md` 必须包含：复审结论、问题关闭状态、回归风险、阻塞项。',
    '- `step3-handoff.json` 必填字段：',
    '  - pipeline_id / step("step3")',
    `  - input_handoffs（固定为 ["${handoff.step1Json}", "${handoff.step2Json}"]）`,
    `  - summary_path（固定为 "${handoff.step3Summary}"）`,
    '  - review_decision（approved / revise_required / blocked）',
    '  - closed_items（数组）',
    '  - open_items（数组）',
    '  - generated_at（ISO 时间）',
  ].join('\n');
}

function buildStep3ExecutionHandoffPrompt(handoff) {
  return [
    '',
    '流水线通信要求（必须执行）：',
    '- 本步骤开始前必须读取以下文件：',
    `  1) ${handoff.step1Summary}`,
    `  2) ${handoff.step1Json}`,
    `  3) ${handoff.step2Summary}`,
    `  4) ${handoff.step2Json}`,
    '- 若通信文件缺失或字段不完整：必须先输出阻塞原因与修复动作，不得直接跳过。',
    '- 本步骤执行必须逐条映射 step2 的计划项，并在输出中给出“计划项 → 改动 → 验证”映射。',
    '- 本步骤结束前必须写入以下文件：',
    `  1) ${handoff.step3Summary}`,
    `  2) ${handoff.step3Json}`,
    '- `step3-summary.md` 必须包含：执行进展、变更清单、验证结果、未完成项。',
    '- `step3-handoff.json` 必填字段：',
    '  - pipeline_id / step("step3")',
    `  - input_handoffs（固定为 ["${handoff.step1Json}", "${handoff.step2Json}"]）`,
    `  - summary_path（固定为 "${handoff.step3Summary}"）`,
    '  - changed_files（数组）',
    '  - verification_commands（数组）',
    '  - unresolved_items（数组）',
    '  - generated_at（ISO 时间）',
  ].join('\n');
}

function buildStep4HandoffPrompt(handoff) {
  return [
    '',
    '流水线通信要求（必须执行）：',
    '- 本步骤开始前必须读取以下文件：',
    `  1) ${handoff.step1Summary}`,
    `  2) ${handoff.step1Json}`,
    `  3) ${handoff.step2Summary}`,
    `  4) ${handoff.step2Json}`,
    `  5) ${handoff.step3Summary}`,
    `  6) ${handoff.step3Json}`,
    '- 若通信文件缺失或字段不完整：必须先输出阻塞原因与修复动作，不得直接跳过。',
    '- 本步骤复审必须逐条核对 step3 的改动与验证证据，输出“问题关闭状态 + 回归风险”。',
    '- 本步骤结束前必须写入以下文件：',
    `  1) ${handoff.step4Summary}`,
    `  2) ${handoff.step4Json}`,
    '- `step4-summary.md` 必须包含：复审结论、问题关闭状态、回归风险、阻塞项。',
    '- `step4-handoff.json` 必填字段：',
    '  - pipeline_id / step("step4")',
    `  - input_handoffs（固定为 ["${handoff.step1Json}", "${handoff.step2Json}", "${handoff.step3Json}"]）`,
    `  - summary_path（固定为 "${handoff.step4Summary}"）`,
    '  - review_decision（approved / revise_required / blocked）',
    '  - closed_items（数组）',
    '  - open_items（数组）',
    '  - generated_at（ISO 时间）',
  ].join('\n');
}

function buildFinalizeStepPrompt(handoff, previousStepCount = 3) {
  const stepPairs = [
    [handoff.step1Summary, handoff.step1Json],
    [handoff.step2Summary, handoff.step2Json],
    [handoff.step3Summary, handoff.step3Json],
    [handoff.step4Summary, handoff.step4Json],
  ].slice(0, previousStepCount);
  const inputHandoffs = JSON.stringify(stepPairs.map(([, jsonPath]) => jsonPath));
  const readLines = stepPairs.flatMap(([summaryPath, jsonPath], index) => [
    `  ${index * 2 + 1}) ${summaryPath}`,
    `  ${index * 2 + 2}) ${jsonPath}`,
  ]);

  return [
    '请基于上一步执行结果进行最终校验与交付整理：',
    '1. 对照原始目标逐条核对完成状态，明确已完成/未完成/阻塞项。',
    '2. 汇总可验证证据（命令、结果摘要、关键输出路径）。',
    '3. 输出可直接交付的结构化结果：变更清单、验证结果、回归清单、风险与下一步行动。',
    '4. 若上一步是审查或分析任务，必须确认报告已落盘并给出保存路径与摘要。',
    '',
    '流水线通信要求（必须执行）：',
    '- 本步骤开始前必须读取以下文件：',
    ...readLines,
    '- 若存在缺失：必须先输出阻塞原因，不得直接给“已完成”。',
    '- 本步骤结束前必须写入以下文件：',
    `  1) ${handoff.finalSummary}`,
    `  2) ${handoff.finalJson}`,
    '- `final-delivery.md` 必须包含：完成度核对、证据清单、回归清单、风险与下一步行动。',
    '- `final-delivery.json` 必填字段：',
    '  - pipeline_id / step("final")',
    `  - input_handoffs（固定为 ${inputHandoffs}）`,
    `  - summary_path（固定为 "${handoff.finalSummary}"）`,
    '  - status（success / partial / blocked）',
    '  - completed_items（数组）',
    '  - pending_items（数组）',
    '  - generated_at（ISO 时间）',
  ].join('\n');
}

const e2ePromptPairs = [
  {
    id: '01-一键工作流分析到脚本落地',
    pipelineName: '端到端｜一键工作流分析到脚本落地',
    upstreamPrompt: 'prompts/by-demand/01-一键部署运行测试打包/关于项目构建的工作流.txt',
    executionPrompt: 'prompts/by-demand/01-一键部署运行测试打包/关于跨平台一键脚本.txt',
    reviewPrompt: 'prompts/by-demand/01-一键部署运行测试打包/关于一键流程落地结果复审.txt',
  },
  {
    id: '02-重构方案分析到模块重构执行',
    pipelineName: '端到端｜重构方案分析到模块重构执行',
    upstreamPrompt: 'prompts/by-demand/02-项目重构/关于重构方案分析.txt',
    executionPrompt: 'prompts/by-demand/02-项目重构/关于模块的重构.txt',
    reviewPrompt: 'prompts/by-demand/02-项目重构/关于重构结果回归审查.txt',
  },
  {
    id: '03-冗余审查到重复治理执行',
    pipelineName: '端到端｜冗余审查到重复治理执行',
    upstreamPrompt: 'prompts/by-demand/03-冗余度检查并修复/关于冗余与重复审查.txt',
    executionPrompt: 'prompts/by-demand/03-冗余度检查并修复/关于重构与消除重复.txt',
    reviewPrompt: 'prompts/by-demand/03-冗余度检查并修复/关于冗余治理回归审查.txt',
  },
  {
    id: '04-代码审查到缺陷修复',
    pipelineName: '端到端｜代码审查到缺陷修复',
    upstreamPrompt: 'prompts/by-demand/04-Bug审查并修复/关于代码审查与PR自检.txt',
    executionPrompt: 'prompts/by-demand/04-Bug审查并修复/关于根据审查报告执行修复.txt',
    reviewPrompt: 'prompts/by-demand/04-Bug审查并修复/关于修复结果回归审查.txt',
  },
  {
    id: '05-UI审查到整改落地',
    pipelineName: '端到端｜UI审查到整改落地',
    upstreamPrompt: 'prompts/by-demand/06-前端美化设计并执行/关于ui的审查.txt',
    executionPrompt: 'prompts/by-demand/06-前端美化设计并执行/关于ui问题整改落地.txt',
    reviewPrompt: 'prompts/by-demand/06-前端美化设计并执行/关于ui整改结果复审.txt',
  },
  {
    id: '06-后端性能分析到优化落地',
    pipelineName: '端到端｜后端性能分析到优化落地',
    upstreamPrompt: 'prompts/by-demand/05-前后端性能提升审查并修复/关于性能分析.txt',
    executionPrompt: 'prompts/by-demand/05-前后端性能提升审查并修复/关于根据性能分析报告执行优化.txt',
    reviewPrompt: 'prompts/by-demand/05-前后端性能提升审查并修复/关于后端性能优化结果复审.txt',
  },
  {
    id: '07-前端性能分析到优化落地',
    pipelineName: '端到端｜前端性能分析到优化落地',
    upstreamPrompt: 'prompts/by-demand/05-前后端性能提升审查并修复/关于前端性能与包体积优化.txt',
    executionPrompt: 'prompts/by-demand/05-前后端性能提升审查并修复/关于根据前端性能分析执行优化.txt',
    reviewPrompt: 'prompts/by-demand/05-前后端性能提升审查并修复/关于前端性能优化结果复审.txt',
  },
  {
    id: '08-功能扩展分析到开发交付',
    pipelineName: '端到端｜功能扩展分析到开发交付',
    upstreamPrompt: 'prompts/by-demand/07-功能盘点扩展发现与实现/关于功能扩展机会分析.txt',
    executionPrompt: 'prompts/by-demand/07-功能盘点扩展发现与实现/关于根据功能扩展方案执行落地.txt',
    reviewPrompt: 'prompts/by-demand/07-功能盘点扩展发现与实现/关于功能扩展落地回归审查.txt',
  },
  {
    id: '09-跨项目对标分析到借鉴落地',
    pipelineName: '端到端｜跨项目对标分析到借鉴落地',
    upstreamPrompt: 'prompts/by-demand/09-跨项目功能借鉴落地/关于跨项目对标分析.txt',
    executionPrompt: 'prompts/by-demand/09-跨项目功能借鉴落地/关于跨项目功能借鉴落地.txt',
    reviewPrompt: 'prompts/by-demand/09-跨项目功能借鉴落地/关于借鉴落地回归审查.txt',
  },
  {
    id: '10-上传前风险审查到仓库整理',
    pipelineName: '端到端｜上传前风险审查到仓库整理',
    upstreamPrompt: 'prompts/by-demand/10-GitHub上传前准备/关于上传前扫描与风险审查.txt',
    executionPrompt: 'prompts/by-demand/10-GitHub上传前准备/关于仓库清理与GitHub上传准备.txt',
    reviewPrompt: 'prompts/by-demand/10-GitHub上传前准备/关于上传前最终核验.txt',
  },
  {
    id: '11-从文档到MVP实现交付',
    pipelineName: '端到端｜从文档到 MVP 实现交付',
    upstreamPrompt: 'prompts/by-demand/11-从文档到MVP实现/关于MVP需求澄清与验收定义.txt',
    planningPrompt: 'prompts/by-demand/11-从文档到MVP实现/关于MVP实施计划制定.txt',
    executionPrompt: 'prompts/by-demand/11-从文档到MVP实现/关于根据计划实现MVP.txt',
    reviewPrompt: 'prompts/by-demand/11-从文档到MVP实现/关于MVP交付回归审查.txt',
  },
];

async function listPromptFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listPromptFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.txt')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function getTemplateName(content, fallbackName) {
  const lines = content.split(/\r?\n/);
  const titleLine = lines.find((line) => line.trim().startsWith('# '));
  if (titleLine) return titleLine.replace(/^#\s+/, '').trim();
  return fallbackName;
}

function sanitizeFileName(name) {
  const sanitized = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return sanitized.length > 0 ? sanitized : 'pipeline';
}

function toE2EPipelineData(pair, upstream, execution, review = null, planning = null) {
  const handoff = getHandoffPaths(pair.id);
  const steps = [
    {
      title: `分析/审查：${upstream.title}`,
      description: [upstream.description, buildStep1HandoffPrompt(handoff, upstream.title)].join('\n'),
      agentDefinitionId: defaultAgentId,
    },
  ];
  let previousStepCount = 2;

  if (planning) {
    steps.push({
      title: `实施计划：${planning.title}`,
      description: [planning.description, buildStep2PlanningHandoffPrompt(handoff)].join('\n'),
      agentDefinitionId: defaultAgentId,
    });
    steps.push({
      title: `执行落地：${execution.title}`,
      description: [
        execution.description,
        buildStep3ExecutionHandoffPrompt(handoff),
        '',
        '补充要求：',
        '1. 必须基于 step2 计划逐条落地，不允许跳过高优先级计划项。',
        '2. 若 step2 输出了里程碑与顺序，必须保持一致，偏离时说明原因与风险。',
        '3. 本步骤必须实际改代码并完成验证，不仅给结论。',
      ].join('\n'),
      agentDefinitionId: defaultAgentId,
    });
    previousStepCount = 3;
    if (review) {
      steps.push({
        title: `复审核验：${review.title}`,
        description: [review.description, buildStep4HandoffPrompt(handoff)].join('\n'),
        agentDefinitionId: defaultAgentId,
      });
      previousStepCount = 4;
    }
  } else {
    steps.push({
      title: `执行整改：${execution.title}`,
      description: [
        execution.description,
        buildStep2HandoffPrompt(handoff),
        '',
        '补充要求：',
        '1. 必须基于上一步的分析/审查结果逐条整改，不允许跳过高优先级问题。',
        '2. 若上一步生成了报告，必须读取默认 report_path 并做“问题→改动→验证”一一映射。',
        '3. 本步骤必须实际改代码并完成验证，不仅给结论。',
      ].join('\n'),
      agentDefinitionId: defaultAgentId,
    });
    if (review) {
      steps.push({
        title: `复审核验：${review.title}`,
        description: [review.description, buildStep3HandoffPrompt(handoff)].join('\n'),
        agentDefinitionId: defaultAgentId,
      });
      previousStepCount = 3;
    }
  }

  steps.push({
    title: '端到端交付验收',
    description: buildFinalizeStepPrompt(handoff, previousStepCount),
    agentDefinitionId: defaultAgentId,
  });

  return {
    version: 1,
    type: 'cam-pipeline',
    exportedAt: new Date().toISOString(),
    name: pair.pipelineName ?? `端到端｜${upstream.title} 到 ${execution.title}`,
    agentDefinitionId: defaultAgentId,
    repoUrl: null,
    baseBranch: null,
    workDir: null,
    maxRetries: 2,
    steps,
  };
}

async function run() {
  const promptFiles = await listPromptFiles(promptsDir);
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const promptMap = new Map();

  for (const promptPath of promptFiles) {
    const relativePromptPath = path.relative(rootDir, promptPath).replaceAll('\\', '/');
    const fileBaseName = path.basename(promptPath, '.txt');
    const content = await fs.readFile(promptPath, 'utf8');
    const promptText = content.trim();
    const templateName = getTemplateName(promptText, fileBaseName);
    promptMap.set(relativePromptPath, {
      title: templateName,
      description: promptText,
    });
  }

  const e2eDir = path.join(outDir, 'e2e');
  await fs.mkdir(e2eDir, { recursive: true });

  const e2eItems = [];
  const missingPairs = [];
  for (const pair of e2ePromptPairs) {
    const upstream = promptMap.get(pair.upstreamPrompt);
    const planning = pair.planningPrompt ? promptMap.get(pair.planningPrompt) : null;
    const execution = promptMap.get(pair.executionPrompt);
    const review = pair.reviewPrompt ? promptMap.get(pair.reviewPrompt) : null;
    if (!upstream || !execution || (pair.planningPrompt && !planning) || (pair.reviewPrompt && !review)) {
      missingPairs.push(pair.id);
      continue;
    }

    const e2eData = toE2EPipelineData(pair, upstream, execution, review, planning);
    const handoff = getHandoffPaths(pair.id);
    const fileName = `${sanitizeFileName(pair.id)}.json`;
    const outputPath = path.join(e2eDir, fileName);
    await fs.writeFile(outputPath, `${JSON.stringify(e2eData, null, 2)}\n`, 'utf8');

    const item = {
      pipelineKind: 'e2e',
      name: e2eData.name,
      category: 'e2e',
      promptFiles: [
        pair.upstreamPrompt,
        ...(pair.planningPrompt ? [pair.planningPrompt] : []),
        pair.executionPrompt,
        ...(pair.reviewPrompt ? [pair.reviewPrompt] : []),
      ],
      pipelineFile: path.relative(rootDir, outputPath).replaceAll('\\', '/'),
      handoffDir: handoff.baseDir,
      stepCount: e2eData.steps.length,
      type: e2eData.type,
      version: e2eData.version,
    };
    e2eItems.push(item);
  }

  if (missingPairs.length > 0) {
    console.warn(`[warn] 跳过未找到提示词的 E2E 配对: ${missingPairs.join(', ')}`);
  }

  await fs.writeFile(
    path.join(e2eDir, 'index.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), total: e2eItems.length, items: e2eItems }, null, 2)}\n`,
    'utf8'
  );

  await fs.writeFile(
    path.join(outDir, 'index.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: e2eItems.length,
        singleCount: 0,
        e2eCount: e2eItems.length,
        items: e2eItems,
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
