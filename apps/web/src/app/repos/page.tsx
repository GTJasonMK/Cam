// ============================================================
// 仓库预设管理页面
// 使用 DataTable + Modal 的标准管理页面模式
// ============================================================

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRepoStore } from '@/stores';
import type { RepositoryItem } from '@/stores';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFeedback } from '@/components/providers/feedback-provider';
import { Plus, Pencil, Trash2 } from 'lucide-react';

// ---- 仓库表单状态 ----
interface RepoFormData {
  name: string;
  repoUrl: string;
  defaultBaseBranch: string;
  defaultWorkDir: string;
}

const EMPTY_FORM: RepoFormData = {
  name: '',
  repoUrl: '',
  defaultBaseBranch: 'main',
  defaultWorkDir: '',
};

export default function ReposPage() {
  const { repos, loading, error, fetchRepos, createRepo, updateRepo, deleteRepo } = useRepoStore();
  const { confirm: confirmDialog, notify } = useFeedback();

  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRepo, setEditingRepo] = useState<RepositoryItem | null>(null);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  // 搜索过滤
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.name.toLowerCase().includes(q) || r.repoUrl.toLowerCase().includes(q));
  }, [repos, query]);

  // 删除操作
  const handleDelete = async (repo: RepositoryItem) => {
    const confirmed = await confirmDialog({
      title: `删除仓库预设 "${repo.name}"?`,
      description: '删除后将无法在创建任务时直接复用该预设。',
      confirmText: '删除',
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;

    const res = await deleteRepo(repo.id);
    if (!res.success) {
      notify({ type: 'error', title: '删除失败', message: res.errorMessage || '请求失败' });
      return;
    }
    notify({ type: 'success', title: '仓库预设已删除', message: `${repo.name} 已删除。` });
  };

  // 表格列定义
  const columns: Column<RepositoryItem>[] = [
    {
      key: 'name',
      header: '名称',
      className: 'w-[180px]',
      cell: (row) => <span className="font-medium text-foreground">{row.name}</span>,
    },
    {
      key: 'repoUrl',
      header: '仓库地址',
      cell: (row) => <span className="block max-w-[380px] truncate font-mono text-sm text-muted-foreground">{row.repoUrl}</span>,
    },
    {
      key: 'defaultBaseBranch',
      header: '默认分支',
      className: 'w-[120px]',
      cell: (row) => <span className="text-sm">{row.defaultBaseBranch}</span>,
    },
    {
      key: 'defaultWorkDir',
      header: '工作目录',
      className: 'w-[150px]',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{row.defaultWorkDir || '-'}</span>
      ),
    },
    {
      key: 'updatedAt',
      header: '更新时间',
      className: 'w-[160px]',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.updatedAt).toLocaleString('zh-CN')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[120px] text-right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0"
            onClick={() => setEditingRepo(row)}
            aria-label="编辑"
          >
            <Pencil size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 hover:bg-destructive/10 hover:text-destructive"
            onClick={() => handleDelete(row)}
            aria-label="删除"
          >
            <Trash2 size={16} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-12">
      <PageHeader title="仓库预设" subtitle="用于任务编排的仓库预设">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} className="mr-1.5" />
          新建仓库
        </Button>
      </PageHeader>

      {/* 搜索栏 */}
      <div className="max-w-lg">
        <Input placeholder="搜索名称或仓库地址..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {/* 错误提示 */}
      {!loading && error ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-base text-destructive">
          加载失败: {error}
        </div>
      ) : null}

      {/* 数据表格 */}
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(r) => r.id}
        loading={loading}
        emptyMessage="暂无仓库预设"
        emptyHint="创建后可在新建任务时复用仓库地址、基线分支和工作目录。"
      />

      {/* 创建 Modal */}
      <RepoFormModal
        open={createOpen}
        title="创建仓库预设"
        initialData={EMPTY_FORM}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (data) => {
          const res = await createRepo({
            name: data.name,
            repoUrl: data.repoUrl,
            defaultBaseBranch: data.defaultBaseBranch,
            defaultWorkDir: data.defaultWorkDir || undefined,
          });
          if (!res.success) throw new Error(res.errorMessage || '创建失败');
          notify({ type: 'success', title: '仓库预设已创建', message: `${data.name} 已创建。` });
          fetchRepos();
        }}
      />

      {/* 编辑 Modal */}
      <RepoFormModal
        open={editingRepo !== null}
        title="编辑仓库预设"
        initialData={
          editingRepo
            ? {
                name: editingRepo.name,
                repoUrl: editingRepo.repoUrl,
                defaultBaseBranch: editingRepo.defaultBaseBranch,
                defaultWorkDir: editingRepo.defaultWorkDir || '',
              }
            : EMPTY_FORM
        }
        onClose={() => setEditingRepo(null)}
        onSubmit={async (data) => {
          if (!editingRepo) return;
          const res = await updateRepo(editingRepo.id, {
            name: data.name.trim(),
            repoUrl: data.repoUrl.trim(),
            defaultBaseBranch: data.defaultBaseBranch.trim(),
            defaultWorkDir: data.defaultWorkDir.trim() || null,
          });
          if (!res.success) throw new Error(res.errorMessage || '更新失败');
          notify({ type: 'success', title: '仓库预设已更新', message: `${data.name} 已更新。` });
          fetchRepos();
        }}
      />
    </div>
  );
}

// ---- 仓库表单 Modal ----

function RepoFormModal({
  open,
  title,
  initialData,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initialData: RepoFormData;
  onClose: () => void;
  onSubmit: (data: RepoFormData) => Promise<void>;
}) {
  const [form, setForm] = useState<RepoFormData>(initialData);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 打开时重置表单
  useEffect(() => {
    if (open) {
      setForm(initialData);
      setSubmitError(null);
      setSaving(false);
    }
  }, [open, initialData]);

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    setSaving(true);
    setSubmitError(null);
    try {
      await onSubmit(form);
      onClose();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" size="sm" loading={saving} disabled={!form.name.trim() || !form.repoUrl.trim()} onClick={handleSubmit}>
            保存
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="名称"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="my-repo"
          />
          <Input
            label="基线分支"
            value={form.defaultBaseBranch}
            onChange={(e) => setForm({ ...form, defaultBaseBranch: e.target.value })}
            placeholder="main"
          />
          <Input
            label="Git 仓库地址"
            required
            value={form.repoUrl}
            onChange={(e) => setForm({ ...form, repoUrl: e.target.value })}
            placeholder="git@github.com:org/repo.git"
          />
          <Input
            label="默认工作目录"
            value={form.defaultWorkDir}
            onChange={(e) => setForm({ ...form, defaultWorkDir: e.target.value })}
            placeholder="packages/app"
          />
        </div>

        {submitError ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {submitError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
