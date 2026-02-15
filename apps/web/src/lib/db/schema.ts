// ============================================================
// 数据库 Schema 定义 (Drizzle ORM + SQLite)
// ============================================================

import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { randomUUID } from 'crypto';

// ----- Agent 定义表 -----
export const agentDefinitions = sqliteTable('agent_definitions', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  icon: text('icon'),

  dockerImage: text('docker_image').notNull(),
  command: text('command').notNull(),
  args: text('args', { mode: 'json' }).notNull().$type<string[]>().default([]),

  requiredEnvVars: text('required_env_vars', { mode: 'json' })
    .notNull()
    .$type<Array<{ name: string; description: string; required: boolean; sensitive: boolean }>>()
    .default([]),

  capabilities: text('capabilities', { mode: 'json' })
    .notNull()
    .$type<{
      nonInteractive: boolean;
      autoGitCommit: boolean;
      outputSummary: boolean;
      promptFromFile: boolean;
    }>(),

  defaultResourceLimits: text('default_resource_limits', { mode: 'json' })
    .notNull()
    .$type<{ cpuLimit?: string; memoryLimitMb?: number; timeoutMinutes?: number }>()
    .default({}),

  builtIn: integer('built_in', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ----- 仓库表（用于 Repo Preset / 编排时复用配置） -----
export const repositories = sqliteTable(
  'repositories',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    name: text('name').notNull(),
    repoUrl: text('repo_url').notNull(),
    defaultBaseBranch: text('default_base_branch').notNull().default('main'),
    defaultWorkDir: text('default_work_dir'),
    createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('idx_repos_name').on(table.name),
    index('idx_repos_repo_url').on(table.repoUrl),
  ]
);

// ----- 任务模板表（创建任务时复用 Prompt 与默认配置） -----
export const taskTemplates = sqliteTable(
  'task_templates',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    name: text('name').notNull(),
    titleTemplate: text('title_template').notNull(),
    promptTemplate: text('prompt_template').notNull(),
    agentDefinitionId: text('agent_definition_id').references(() => agentDefinitions.id),
    repositoryId: text('repository_id').references(() => repositories.id),
    repoUrl: text('repo_url'),
    baseBranch: text('base_branch'),
    workDir: text('work_dir'),
    createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('idx_task_templates_name').on(table.name),
    index('idx_task_templates_agent_id').on(table.agentDefinitionId),
    index('idx_task_templates_repo_id').on(table.repositoryId),
  ]
);

// ----- 任务表 -----
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    title: text('title').notNull(),
    description: text('description').notNull(),

    agentDefinitionId: text('agent_definition_id')
      .notNull()
      .references(() => agentDefinitions.id),
    repositoryId: text('repository_id').references(() => repositories.id),
    repoUrl: text('repo_url').notNull(),
    baseBranch: text('base_branch').notNull().default('main'),
    workBranch: text('work_branch').notNull(),
    workDir: text('work_dir'),

    status: text('status').notNull().default('draft'),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(2),

    dependsOn: text('depends_on', { mode: 'json' }).notNull().$type<string[]>().default([]),
    groupId: text('group_id'),

    assignedWorkerId: text('assigned_worker_id'),
    prUrl: text('pr_url'),
    summary: text('summary'),
    logFileUrl: text('log_file_url'),

    reviewComment: text('review_comment'),
    reviewedAt: text('reviewed_at'),

    createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
    queuedAt: text('queued_at'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),

    feedback: text('feedback'),
  },
  (table) => [
    index('idx_tasks_status').on(table.status),
    index('idx_tasks_agent_def_id').on(table.agentDefinitionId),
    index('idx_tasks_repo_id').on(table.repositoryId),
  ]
);

// ----- 任务日志表（持久化 Worker 执行日志） -----
export const taskLogs = sqliteTable(
  'task_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    line: text('line').notNull(),
    createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('idx_task_logs_task_id').on(table.taskId),
    index('idx_task_logs_created_at').on(table.createdAt),
  ]
);

// ----- Secrets 表（按 Repo / Agent 维度存储敏感配置，值加密） -----
export const secrets = sqliteTable(
  'secrets',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    name: text('name').notNull(),
    repositoryId: text('repository_id').references(() => repositories.id),
    agentDefinitionId: text('agent_definition_id').references(() => agentDefinitions.id),
    valueEncrypted: text('value_encrypted').notNull(),
    createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex('uniq_secrets_scope').on(table.name, table.repositoryId, table.agentDefinitionId),
    index('idx_secrets_name').on(table.name),
    index('idx_secrets_repo_id').on(table.repositoryId),
    index('idx_secrets_agent_def_id').on(table.agentDefinitionId),
  ]
);

// ----- Worker 表 -----
export const workers = sqliteTable(
  'workers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),

    supportedAgentIds: text('supported_agent_ids', { mode: 'json' }).notNull().$type<string[]>().default([]),
    maxConcurrent: integer('max_concurrent').notNull().default(1),

    status: text('status').notNull().default('offline'),
    currentTaskId: text('current_task_id'),

    lastHeartbeatAt: text('last_heartbeat_at').notNull().$defaultFn(() => new Date().toISOString()),

    cpuUsage: real('cpu_usage'),
    memoryUsageMb: real('memory_usage_mb'),
    diskUsageMb: real('disk_usage_mb'),
    logTail: text('log_tail'),

    totalTasksCompleted: integer('total_tasks_completed').notNull().default(0),
    totalTasksFailed: integer('total_tasks_failed').notNull().default(0),
    uptimeSince: text('uptime_since').notNull().$defaultFn(() => new Date().toISOString()),

    createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index('idx_workers_status').on(table.status)]
);

// ----- 系统事件表 -----
export const systemEvents = sqliteTable(
  'system_events',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    type: text('type').notNull(),
    actor: text('actor'),
    payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>().default({}),
    timestamp: text('timestamp').notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('idx_events_type').on(table.type),
    index('idx_events_actor').on(table.actor),
    index('idx_events_timestamp').on(table.timestamp),
  ]
);
