// ============================================================
// 用户管理页面（仅 admin 可访问）
// 使用 DataTable 展示用户列表，支持创建、编辑、禁用、删除
// ============================================================

'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { useFeedback } from '@/components/providers/feedback-provider';
import { useUserStore, useAuthStore, type UserItem } from '@/stores';
import { USER_STATUS_COLORS } from '@/lib/constants';
import { Plus, RefreshCw, KeyRound } from 'lucide-react';

// ---- 角色徽章 ----

const ROLE_COLOR: Record<string, string> = {
  admin: 'bg-primary/10 text-primary',
  developer: 'bg-blue-500/10 text-blue-600',
  viewer: 'bg-gray-500/10 text-gray-600',
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${ROLE_COLOR[role] || 'bg-muted text-muted-foreground'}`}>
      {role}
    </span>
  );
}

// ---- 表单类型 ----

interface UserFormData {
  username: string;
  displayName: string;
  password: string;
  email: string;
  role: string;
}

const EMPTY_FORM: UserFormData = { username: '', displayName: '', password: '', email: '', role: 'developer' };
const ROLE_OPTIONS = [
  { value: 'admin', label: '管理员 (admin)' },
  { value: 'developer', label: '开发者 (developer)' },
  { value: 'viewer', label: '观察者 (viewer)' },
];

export default function UsersPage() {
  const { users, loading, error, fetchUsers, createUser, updateUser, deleteUser, resetPassword } = useUserStore();
  const currentUser = useAuthStore((s) => s.user);
  const { notify, confirm, prompt } = useFeedback();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [form, setForm] = useState<UserFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // ---- 操作回调 ----

  const handleCreate = useCallback(async () => {
    setSaving(true);
    const result = await createUser({
      username: form.username,
      displayName: form.displayName,
      password: form.password,
      email: form.email || undefined,
      role: form.role,
    });
    setSaving(false);
    if (result.success) {
      notify({ title: '用户已创建', message: `${form.username} 创建成功`, type: 'success' });
      setShowCreateModal(false);
      setForm(EMPTY_FORM);
    } else {
      notify({ title: '创建失败', message: result.errorMessage || '未知错误', type: 'error' });
    }
  }, [form, createUser, notify]);

  const handleUpdate = useCallback(async () => {
    if (!editingUser) return;
    setSaving(true);
    const result = await updateUser(editingUser.id, {
      displayName: form.displayName,
      email: form.email || null,
      role: form.role,
    });
    setSaving(false);
    if (result.success) {
      notify({ title: '用户已更新', message: `${editingUser.username} 更新成功`, type: 'success' });
      setEditingUser(null);
    } else {
      notify({ title: '更新失败', message: result.errorMessage || '未知错误', type: 'error' });
    }
  }, [editingUser, form, updateUser, notify]);

  const handleDelete = useCallback(async (user: UserItem) => {
    if (user.id === currentUser?.id) {
      notify({ title: '操作被拒绝', message: '不能删除自己的账户', type: 'error' });
      return;
    }
    const ok = await confirm({
      title: `删除用户「${user.username}」？`,
      description: '删除后该用户的所有会话和 Token 也将被清除。',
      confirmText: '删除',
      confirmVariant: 'destructive',
    });
    if (!ok) return;
    const result = await deleteUser(user.id);
    if (result.success) {
      notify({ title: '用户已删除', message: `${user.username} 已删除`, type: 'success' });
    } else {
      notify({ title: '删除失败', message: result.errorMessage || '未知错误', type: 'error' });
    }
  }, [currentUser, deleteUser, confirm, notify]);

  const handleResetPassword = useCallback(async (user: UserItem) => {
    const newPwd = await prompt({
      title: `重置「${user.username}」的密码`,
      description: '重置后该用户将被强制退出所有会话。',
      label: '新密码',
      placeholder: '至少 8 个字符',
    });
    if (!newPwd || newPwd.length < 8) {
      if (newPwd !== null) {
        notify({ title: '操作取消', message: '密码长度不能少于 8 字符', type: 'error' });
      }
      return;
    }
    const result = await resetPassword(user.id, newPwd);
    if (result.success) {
      notify({ title: '密码已重置', message: `${user.username} 的密码已重置`, type: 'success' });
    } else {
      notify({ title: '重置失败', message: result.errorMessage || '未知错误', type: 'error' });
    }
  }, [resetPassword, prompt, notify]);

  const handleToggleStatus = useCallback(async (user: UserItem) => {
    const nextStatus = user.status === 'active' ? 'disabled' : 'active';
    const label = nextStatus === 'disabled' ? '禁用' : '启用';
    const ok = await confirm({
      title: `${label}用户「${user.username}」？`,
      description: nextStatus === 'disabled' ? '禁用后该用户将无法登录，所有会话将被清除。' : '启用后该用户可以正常登录。',
      confirmText: label,
      confirmVariant: nextStatus === 'disabled' ? 'destructive' : 'default',
    });
    if (!ok) return;
    const result = await updateUser(user.id, { status: nextStatus });
    if (result.success) {
      notify({ title: `用户已${label}`, message: `${user.username} 已${label}`, type: 'success' });
    } else {
      notify({ title: `${label}失败`, message: result.errorMessage || '未知错误', type: 'error' });
    }
  }, [updateUser, confirm, notify]);

  // 权限检查 — 放在所有 hooks 之后
  if (currentUser && !currentUser.id.startsWith('__') && currentUser.role !== 'admin') {
    return (
      <div className="space-y-12">
        <PageHeader title="用户管理" subtitle="管理系统用户、角色和权限" />
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          你没有权限访问此页面（需要 admin）。
        </div>
      </div>
    );
  }

  // ---- 表格列定义 ----

  const columns: Column<UserItem>[] = [
    {
      key: 'username',
      header: '用户名',
      cell: (row) => <span className="font-medium text-foreground">{row.username}</span>,
    },
    {
      key: 'displayName',
      header: '显示名称',
      cell: (row) => <span className="text-foreground">{row.displayName}</span>,
    },
    {
      key: 'role',
      header: '角色',
      className: 'w-[100px]',
      cell: (row) => <RoleBadge role={row.role} />,
    },
    {
      key: 'status',
      header: '状态',
      className: 'w-[90px]',
      cell: (row) => {
        const colorToken = USER_STATUS_COLORS[row.status] || 'muted-foreground';
        return <StatusBadge status={row.status} colorToken={colorToken} />;
      },
    },
    {
      key: 'email',
      header: '邮箱',
      cell: (row) => <span className="text-xs text-muted-foreground">{row.email || '-'}</span>,
    },
    {
      key: 'lastLoginAt',
      header: '最后登录',
      className: 'w-[140px]',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString('zh-CN') : '从未'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[220px] text-right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditingUser(row);
              setForm({
                username: row.username,
                displayName: row.displayName,
                password: '',
                email: row.email || '',
                role: row.role,
              });
            }}
          >
            编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => handleResetPassword(row)}
            aria-label="重置密码"
          >
            <KeyRound size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={
              row.status === 'active'
                ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                : 'text-success hover:bg-success/10'
            }
            onClick={() => handleToggleStatus(row)}
          >
            {row.status === 'active' ? '禁用' : '启用'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={() => handleDelete(row)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-12">
      <PageHeader title="用户管理" subtitle="管理系统用户、角色和权限">
        <Button size="sm" variant="secondary" onClick={() => fetchUsers()}>
          <RefreshCw size={14} />
          刷新
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setForm(EMPTY_FORM);
            setShowCreateModal(true);
          }}
        >
          <Plus size={14} />
          创建用户
        </Button>
      </PageHeader>

      {error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={users}
        rowKey={(r) => r.id}
        loading={loading && users.length === 0}
        emptyMessage="暂无用户"
      />

      {/* 创建用户 Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="创建用户"
      >
        <div className="space-y-4">
          <Input
            label="用户名"
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            placeholder="3-32 字符，字母数字下划线连字符"
            autoFocus
          />
          <Input
            label="显示名称"
            value={form.displayName}
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            placeholder="显示名称"
          />
          <Input
            label="密码"
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            placeholder="至少 8 个字符"
          />
          <Input
            label="邮箱（可选）"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="user@example.com"
          />
          <Select
            label="角色"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            options={ROLE_OPTIONS}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreateModal(false)}>取消</Button>
            <Button onClick={handleCreate} loading={saving} disabled={saving || !form.username || !form.displayName || form.password.length < 8}>
              创建
            </Button>
          </div>
        </div>
      </Modal>

      {/* 编辑用户 Modal */}
      <Modal
        open={!!editingUser}
        onClose={() => setEditingUser(null)}
        title={`编辑用户: ${editingUser?.username || ''}`}
      >
        <div className="space-y-4">
          <Input
            label="显示名称"
            value={form.displayName}
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            autoFocus
          />
          <Input
            label="邮箱（可选）"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <Select
            label="角色"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            options={ROLE_OPTIONS}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setEditingUser(null)}>取消</Button>
            <Button onClick={handleUpdate} loading={saving} disabled={saving || !form.displayName}>
              保存
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
