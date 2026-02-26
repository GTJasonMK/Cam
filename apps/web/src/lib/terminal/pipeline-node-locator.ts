export type LocatedPipelineNode<TStep, TNode> = {
  stepIndex: number;
  nodeIndex: number;
  step: TStep;
  node: TNode;
};

function locatePipelineNode<TStep extends { nodes: unknown[] }>(
  steps: TStep[],
  predicate: (node: TStep['nodes'][number]) => boolean,
): LocatedPipelineNode<TStep, TStep['nodes'][number]> | null {
  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    const step = steps[stepIndex];
    const nodeIndex = step.nodes.findIndex((node) => predicate(node));
    if (nodeIndex >= 0) {
      return {
        stepIndex,
        nodeIndex,
        step,
        node: step.nodes[nodeIndex],
      };
    }
  }
  return null;
}

export function locatePipelineNodeBySessionId<TStep extends { nodes: Array<{ sessionId?: string }> }>(
  steps: TStep[],
  sessionId: string,
): LocatedPipelineNode<TStep, TStep['nodes'][number]> | null {
  return locatePipelineNode(steps, (node) => node.sessionId === sessionId);
}

export function locatePipelineNodeByTaskId<TStep extends { nodes: Array<{ taskId: string }> }>(
  steps: TStep[],
  taskId: string,
): LocatedPipelineNode<TStep, TStep['nodes'][number]> | null {
  return locatePipelineNode(steps, (node) => node.taskId === taskId);
}
