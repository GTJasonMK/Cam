import path from 'node:path';

export function buildPipelineNodePromptText(input: {
  nodePrompt: string;
  pipelineId: string;
  stepIndex: number;
  stepCount: number;
  stepTitle: string;
  stepPrompt: string;
  stepInputCondition: string | null;
  stepInputFiles: string[];
  nodeIndex: number;
  nodeCount: number;
  nodeTitle: string;
  repoPath: string;
  stepDir: string;
  previousStepDir: string | null;
}): string {
  const stepDirRelative = path.relative(input.repoPath, input.stepDir) || '.';
  const prevStepDirRelative = input.previousStepDir
    ? path.relative(input.repoPath, input.previousStepDir)
    : null;
  const nodeOutputRelative = path.join(stepDirRelative, `agent-${input.nodeIndex + 1}-output.md`);
  const stepSummaryRelative = path.join(stepDirRelative, 'summary.md');
  const lines: string[] = [];
  lines.push(input.nodePrompt.trim());
  lines.push('');
  lines.push('## 流水线协作约束（必须遵守）');
  lines.push(`- 流水线 ID: ${input.pipelineId}`);
  lines.push(`- 当前步骤: ${input.stepIndex + 1}/${input.stepCount} (${input.stepTitle})`);
  lines.push(`- 当前并行子任务: ${input.nodeIndex + 1}/${input.nodeCount} (${input.nodeTitle})`);
  lines.push(`- 本步骤协作目录: ${stepDirRelative}`);
  if (prevStepDirRelative) {
    lines.push(`- 上一步输出目录: ${prevStepDirRelative}`);
  } else {
    lines.push('- 当前为第一步，没有上一步输出');
  }
  if (input.stepInputCondition) {
    lines.push(`- 输入条件: ${input.stepInputCondition}`);
  }
  if (input.stepInputFiles.length > 0) {
    lines.push(`- 优先输入文件: ${input.stepInputFiles.join(', ')}`);
  } else if (prevStepDirRelative) {
    lines.push(`- 默认输入建议: ${path.join(prevStepDirRelative, 'summary.md')}`);
  }
  lines.push(`- 请将本子任务输出写入: ${nodeOutputRelative}`);
  lines.push(`- 并维护步骤汇总文件: ${stepSummaryRelative}`);
  lines.push('- 步骤内 Agent 通过共享目录文件协作，不要仅在终端输出。');

  if (input.nodeCount > 1) {
    lines.push('');
    lines.push('## 步骤共享目标');
    lines.push(input.stepPrompt.trim());
  }

  return lines.join('\n');
}
