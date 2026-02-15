// ============================================================
// AgentDefinition: 描述"如何运行一种 Coding Agent"
// 这是系统实现 Agent 无关性的核心模型
// ============================================================

export interface EnvVarSpec {
  name: string;
  description: string;
  required: boolean;
  sensitive: boolean;
}

export interface AgentCapabilities {
  /** Agent 是否支持非交互模式（直接给 prompt 跑完退出） */
  nonInteractive: boolean;
  /** Agent 是否自己管理 Git（自动 commit/push） */
  autoGitCommit: boolean;
  /** Agent 完成后是否输出结构化摘要 */
  outputSummary: boolean;
  /** Agent 是否支持从文件读取 prompt */
  promptFromFile: boolean;
}

export interface ResourceLimits {
  cpuLimit?: string;
  memoryLimitMb?: number;
  timeoutMinutes?: number;
}

export interface AgentDefinition {
  id: string;
  displayName: string;
  description?: string | null;
  icon?: string | null;

  dockerImage: string;
  command: string;
  /** 命令参数模板，支持 {{prompt}}, {{workDir}}, {{baseBranch}} 等变量 */
  args: string[];

  requiredEnvVars: EnvVarSpec[];
  capabilities: AgentCapabilities;
  defaultResourceLimits: ResourceLimits;

  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 创建/更新 AgentDefinition 的请求体 */
export interface AgentDefinitionInput {
  id: string;
  displayName: string;
  description?: string;
  icon?: string;
  dockerImage: string;
  command: string;
  args: string[];
  requiredEnvVars: EnvVarSpec[];
  capabilities: AgentCapabilities;
  defaultResourceLimits: ResourceLimits;
}
