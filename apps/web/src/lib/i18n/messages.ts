export const AUTH_ERROR_QUERY_CODE = {
  notConfigured: 'auth_not_configured',
} as const;

export const AUTH_MESSAGES = {
  notConfigured: '服务端未配置 CAM_AUTH_TOKEN',
  notConfiguredGuide: '服务端未配置 CAM_AUTH_TOKEN，请先完成环境变量配置。',
  tokenRequired: 'token 不能为空',
  tokenInvalid: 'token 不正确',
  loginFailed: '登录失败',
  loginFailedWithStatus: (status: number) => `登录失败（HTTP ${status}）`,
  tokenInputHint: '请输入访问令牌（CAM_AUTH_TOKEN）',
} as const;

export const GATEWAY_MESSAGES = {
  unauthorized: '未授权访问',
  rateLimited: '请求过于频繁，请稍后再试',
} as const;

export const HEALTH_MESSAGES = {
  failed: '健康检查失败',
} as const;

export const API_COMMON_MESSAGES = {
  listFailed: '获取列表失败',
  fetchFailed: '获取失败',
  queryFailed: '查询失败',
  dataFetchFailed: '数据获取失败',
  querySystemEventsFailed: '查询系统事件失败',
  createFailed: '创建失败',
  updateFailed: '更新失败',
  deleteFailed: '删除失败',
  registerFailed: '注册失败',
  cleanupFailed: '清理失败',
  heartbeatUpdateFailed: '心跳更新失败',
  fetchTaskFailed: '获取任务失败',
  cancelFailed: '取消失败',
  rerunFailed: '重跑失败',
  restartFailed: '重启失败',
  reviewFailed: '审批失败',
  schedulerTickExecuted: '调度循环已执行',
} as const;

export const REPO_MESSAGES = {
  notFound: (id: string) => `Repository ${id} 不存在`,
  missingRequiredFields: '缺少必填字段: name, repoUrl',
} as const;

export const TASK_TEMPLATE_MESSAGES = {
  notFound: (id: string) => `任务模板 ${id} 不存在`,
  missingRequiredFields: '缺少必填字段: name, titleTemplate, promptTemplate',
  bodyMustBeObject: '请求体必须是 JSON object',
} as const;

export const AGENT_MESSAGES = {
  notFound: (id: string) => `Agent 定义 ${id} 不存在`,
  notFoundDefinition: (id: string) => `AgentDefinition ${id} 不存在`,
  missingRequiredFields: '缺少必填字段: id, displayName, dockerImage, command',
  builtInDeleteForbidden: '内置 Agent 定义不可删除',
} as const;

export const SECRET_MESSAGES = {
  notFound: (id: string) => `Secret ${id} 不存在`,
  missingRequiredFields: '缺少必填字段: name, value',
  missingMasterKeyOnCreate: '缺少 CAM_MASTER_KEY，无法写入 Secrets',
  missingMasterKeyOnUpdate: '缺少 CAM_MASTER_KEY，无法更新 Secrets',
  duplicateOnCreate: '相同作用域下已存在同名 Secret，请改用 Update',
  duplicateOnUpdate: '相同作用域下已存在同名 Secret',
  nameRequired: 'name 不能为空',
  valueRequired: 'value 不能为空',
} as const;

export const WORKER_MESSAGES = {
  notFound: (id: string) => `Worker ${id} 不存在`,
  missingRequiredFields: '缺少必填字段: id, name',
  unsupportedCleanupStatus: '仅支持 status=offline 清理',
  invalidAction: 'action 必须是 drain/offline/activate',
} as const;

export const TASK_MESSAGES = {
  notFound: (id: string) => `任务 ${id} 不存在`,
  missingAgentEnvVars: (displayName: string, vars: string[]) =>
    `缺少 Agent "${displayName}" 所需环境变量: ${vars.join(', ')}`,
  reviewStateConflict: (status: string) => `任务状态为 ${status}，只有 awaiting_review 状态可审批`,
  rerunStateConflict: (status: string) => `任务状态为 ${status}，无需重跑`,
  invalidAwaitingReviewRerun: 'awaiting_review 状态请使用 Review 的 Reject & Re-run',
  missingGitProviderToken: '缺少 Git Provider Token，无法合并 PR/MR',
  unsupportedRepoProvider: '无法识别 repoUrl 的 Git Provider，无法合并 PR/MR',
  invalidPrUrlForMerge: '无法解析 prUrl，无法合并 PR',
} as const;

export const TASK_GROUP_MESSAGES = {
  groupIdRequired: 'groupId 必填',
  groupIdAndFromTaskIdRequired: 'groupId/fromTaskId 必填',
  groupNotFound: (groupId: string) => `groupId=${groupId} 下没有任务`,
  fromTaskNotInGroup: (fromTaskId: string) => `fromTaskId=${fromTaskId} 不属于该 group`,
  closureRunningConflict: (runningTaskIds: string[]) =>
    `closure 中存在 running 任务，建议先 Cancel（running: ${runningTaskIds.join(', ')})`,
} as const;
