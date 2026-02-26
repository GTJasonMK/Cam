export type TaskPullRequestDraftInput = {
  id: string;
  title: string;
  agentDefinitionId: string;
  workBranch: string;
  description: string | null;
};

export function buildTaskPullRequestDraft(input: TaskPullRequestDraftInput): {
  title: string;
  body: string;
} {
  const title = `[CAM] ${input.title}`;
  const body = [
    `Task ID: ${input.id}`,
    `Agent: ${input.agentDefinitionId}`,
    `Branch: ${input.workBranch}`,
    '',
    input.description || '',
  ].join('\n');

  return { title, body };
}
