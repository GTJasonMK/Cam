export type PipelineNodeStatus = 'draft' | 'running' | 'completed' | 'failed' | 'cancelled';
export type PipelineStepStatus = 'draft' | 'running' | 'completed' | 'failed' | 'cancelled';

export type MutablePipelineNode = {
  status: PipelineNodeStatus;
  sessionId?: string;
};

export type MutablePipelineStep<TNode extends MutablePipelineNode = MutablePipelineNode> = {
  status: PipelineStepStatus;
  nodes: TNode[];
};

export type PipelineNodeRef<
  TStep extends MutablePipelineStep,
  TNode extends MutablePipelineNode = TStep['nodes'][number],
> = {
  step: TStep;
  node: TNode;
};

export function cancelRunningNodesInStep<TStep extends MutablePipelineStep>(
  step: TStep,
  opts?: { excludeSessionId?: string },
): Array<PipelineNodeRef<TStep>> {
  const result: Array<PipelineNodeRef<TStep>> = [];
  for (const node of step.nodes) {
    if (node.status !== 'running') continue;
    if (!node.sessionId) continue;
    if (opts?.excludeSessionId && node.sessionId === opts.excludeSessionId) continue;
    node.status = 'cancelled';
    result.push({ step, node });
  }
  return result;
}

export function cancelDraftNodesFromSteps<TStep extends MutablePipelineStep>(
  steps: TStep[],
  startStepIndex: number,
): Array<PipelineNodeRef<TStep>> {
  const result: Array<PipelineNodeRef<TStep>> = [];
  for (let i = startStepIndex; i < steps.length; i++) {
    const step = steps[i];
    if (step.status === 'draft') {
      step.status = 'cancelled';
    }
    for (const node of step.nodes) {
      if (node.status !== 'draft') continue;
      node.status = 'cancelled';
      result.push({ step, node });
    }
  }
  return result;
}

export function cancelActiveNodesFromSteps<TStep extends MutablePipelineStep>(
  steps: TStep[],
  startStepIndex: number,
): Array<PipelineNodeRef<TStep>> {
  const result: Array<PipelineNodeRef<TStep>> = [];
  for (let i = startStepIndex; i < steps.length; i++) {
    const step = steps[i];
    if (step.status !== 'completed') {
      step.status = 'cancelled';
    }
    for (const node of step.nodes) {
      if (node.status !== 'draft' && node.status !== 'running') continue;
      node.status = 'cancelled';
      result.push({ step, node });
    }
  }
  return result;
}
