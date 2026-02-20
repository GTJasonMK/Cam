// ============================================================
// RBAC 权限模型
// 角色：admin / developer / viewer
// ============================================================

export type Role = 'admin' | 'developer' | 'viewer';

export type Permission =
  // 任务
  | 'task:read' | 'task:create' | 'task:update' | 'task:delete' | 'task:review'
  // Agent 定义
  | 'agent:read' | 'agent:create' | 'agent:update' | 'agent:delete'
  // 仓库
  | 'repo:read' | 'repo:create' | 'repo:update' | 'repo:delete'
  // 任务模板
  | 'template:read' | 'template:create' | 'template:update' | 'template:delete'
  // Worker
  | 'worker:read' | 'worker:manage' | 'worker:prune'
  // Secrets
  | 'secret:read' | 'secret:create' | 'secret:update' | 'secret:delete'
  // 系统设置
  | 'settings:manage'
  // 用户管理
  | 'user:read' | 'user:create' | 'user:update' | 'user:delete'
  // 系统事件
  | 'event:read'
  // 终端
  | 'terminal:access';

/** 各角色权限映射表 */
const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    'task:read', 'task:create', 'task:update', 'task:delete', 'task:review',
    'agent:read', 'agent:create', 'agent:update', 'agent:delete',
    'repo:read', 'repo:create', 'repo:update', 'repo:delete',
    'template:read', 'template:create', 'template:update', 'template:delete',
    'worker:read', 'worker:manage', 'worker:prune',
    'secret:read', 'secret:create', 'secret:update', 'secret:delete',
    'settings:manage',
    'user:read', 'user:create', 'user:update', 'user:delete',
    'event:read',
    'terminal:access',
  ]),

  developer: new Set<Permission>([
    'task:read', 'task:create', 'task:update', 'task:delete', 'task:review',
    'agent:read',
    'repo:read', 'repo:create', 'repo:update', 'repo:delete',
    'template:read', 'template:create', 'template:update', 'template:delete',
    'worker:read', 'worker:manage',
    'secret:read', 'secret:create', 'secret:update',
    'event:read',
    'terminal:access',
  ]),

  viewer: new Set<Permission>([
    'task:read',
    'agent:read',
    'repo:read',
    'template:read',
    'worker:read',
    'event:read',
  ]),
};

/** 检查角色是否拥有指定权限 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/** 获取角色的全部权限列表 */
export function getPermissions(role: Role): Permission[] {
  const set = ROLE_PERMISSIONS[role];
  return set ? Array.from(set) : [];
}

/** 判断是否为有效角色字符串 */
export function isValidRole(value: string): value is Role {
  return value === 'admin' || value === 'developer' || value === 'viewer';
}
