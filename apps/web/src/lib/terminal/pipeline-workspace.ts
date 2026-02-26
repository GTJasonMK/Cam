import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function resolvePipelineStepWorkspaceDirs(input: {
  repoPath: string;
  stepIndex: number;
}): {
  stepDir: string;
  previousStepDir: string | null;
} {
  const stepDir = path.join(input.repoPath, '.conversations', `step${input.stepIndex + 1}`);
  const previousStepDir = input.stepIndex > 0
    ? path.join(input.repoPath, '.conversations', `step${input.stepIndex}`)
    : null;
  return { stepDir, previousStepDir };
}

export async function initializePipelineStepWorkspace(input: {
  repoPath: string;
  pipelineId: string;
  stepIndex: number;
  stepTitle: string;
  stepPrompt: string;
  inputFiles: string[];
  inputCondition: string | null;
  stepDir: string;
  previousStepDir: string | null;
}): Promise<void> {
  await mkdir(input.stepDir, { recursive: true });
  await writeFile(
    path.join(input.stepDir, 'workspace.json'),
    JSON.stringify({
      pipelineId: input.pipelineId,
      stepIndex: input.stepIndex,
      stepTitle: input.stepTitle,
      stepPrompt: input.stepPrompt,
      inputFiles: input.inputFiles,
      inputCondition: input.inputCondition,
      previousStepDir: input.previousStepDir
        ? path.relative(input.repoPath, input.previousStepDir)
        : null,
      generatedAt: new Date().toISOString(),
    }, null, 2),
    'utf-8',
  );
}

export async function writePipelineNodeTaskPromptFile(input: {
  stepDir: string;
  nodeIndex: number;
  prompt: string;
}): Promise<void> {
  await writeFile(
    path.join(input.stepDir, `agent-${input.nodeIndex + 1}-task.md`),
    input.prompt,
    'utf-8',
  );
}
