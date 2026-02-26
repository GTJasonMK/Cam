// ============================================================
// 个人设置页面
// - 修改密码
// - OAuth 关联状态
// - API Token 管理
// - Session 管理
// ============================================================

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFeedback } from '@/components/providers/feedback-provider';
import { readApiEnvelope, resolveApiErrorMessage } from '@/lib/http/client-response';
import { formatDateTimeZhCn, formatDateZhCn } from '@/lib/time/format';
import { useAuthStore } from '@/stores';
import { Key, Shield, MonitorSmartphone, Copy } from 'lucide-react';

// ---- 类型 ----

interface ApiTokenItem {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface SessionItem {
  id: string;
  ipAddress: string;
  userAgent: string;
  expiresAt: string;
  createdAt: string;
  isCurrent: boolean;
}

// ---- 修改密码区块 ----

function ChangePasswordSection() {
  const { notify } = useFeedback();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleChangePassword = useCallback(async () => {
    if (newPassword !== confirmPassword) {
      notify({ title: '密码不匹配', message: '两次输入的新密码不一致', type: 'error' });
      return;
    }
    if (newPassword.length < 8) {
      notify({ title: '密码太短', message: '新密码至少 8 个字符', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await readApiEnvelope<unknown>(res);
      if (!res.ok || !json?.success) {
        notify({ title: '修改失败', message: resolveApiErrorMessage(res, json, '请求失败'), type: 'error' });
        return;
      }
      notify({ title: '密码已修改', message: '所有旧会话已失效，当前会话已自动续期', type: 'success' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      notify({ title: '修改失败', message: (err as Error).message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [currentPassword, newPassword, confirmPassword, notify]);

  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-4">
        <Key size={16} className="text-primary" />
        <h2 className="text-sm font-semibold">修改密码</h2>
      </div>
      <div className="space-y-3 max-w-md">
        <Input
          label="当前密码"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
        />
        <Input
          label="新密码"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="至少 8 个字符"
          autoComplete="new-password"
        />
        <Input
          label="确认新密码"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />
        <Button
          size="sm"
          loading={saving}
          onClick={handleChangePassword}
          disabled={saving || !currentPassword || !newPassword || !confirmPassword}
        >
          修改密码
        </Button>
      </div>
    </Card>
  );
}

// ---- API Token 管理区块 ----

function ApiTokenSection() {
  const { notify, confirm } = useFeedback();
  const [tokens, setTokens] = useState<ApiTokenItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTokenName, setNewTokenName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const tokenNameInputRef = useRef<HTMLInputElement>(null);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/tokens');
      const json = await readApiEnvelope<ApiTokenItem[]>(res);
      if (res.ok && json?.success && Array.isArray(json.data)) {
        setTokens(json.data);
      }
    } catch {
      // 忽略
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleCreate = useCallback(async () => {
    if (!newTokenName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/auth/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName.trim() }),
      });
      const json = await readApiEnvelope<{ token: string }>(res);
      if (res.ok && json?.success && json.data?.token) {
        setCreatedToken(json.data.token);
        setNewTokenName('');
        notify({ title: 'Token 已创建', message: '请立即复制，此 Token 只显示一次', type: 'success' });
        fetchTokens();
      } else {
        notify({ title: '创建失败', message: resolveApiErrorMessage(res, json, '请求失败'), type: 'error' });
      }
    } catch (err) {
      notify({ title: '创建失败', message: (err as Error).message, type: 'error' });
    } finally {
      setCreating(false);
    }
  }, [newTokenName, notify, fetchTokens]);

  const handleDelete = useCallback(async (token: ApiTokenItem) => {
    const ok = await confirm({
      title: `删除 Token「${token.name}」？`,
      description: '删除后使用此 Token 的集成将无法访问。',
      confirmText: '删除',
      confirmVariant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/auth/tokens/${token.id}`, { method: 'DELETE' });
      const json = await readApiEnvelope<unknown>(res);
      if (res.ok && json?.success) {
        notify({ title: 'Token 已删除', message: `${token.name} 已删除`, type: 'success' });
        fetchTokens();
      } else {
        notify({ title: '删除失败', message: resolveApiErrorMessage(res, json, '请求失败'), type: 'error' });
      }
    } catch (err) {
      notify({ title: '删除失败', message: (err as Error).message, type: 'error' });
    }
  }, [confirm, notify, fetchTokens]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify({ title: '已复制', message: 'Token 已复制到剪贴板', type: 'success' });
    } catch {
      notify({ title: '复制失败', message: '请手动复制', type: 'error' });
    }
  }, [notify]);

  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-4">
        <Shield size={16} className="text-primary" />
        <h2 className="text-sm font-semibold">API Token</h2>
      </div>

      {/* 新创建的 Token 展示（一次性） */}
      {createdToken ? (
        <div className="mb-4 rounded-lg border border-success/30 bg-success/5 p-3">
          <p className="text-xs font-medium text-success mb-2">Token 已创建（仅此一次可见）</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-2 py-1 text-xs font-mono break-all">
              {createdToken}
            </code>
            <Button size="sm" variant="secondary" onClick={() => copyToClipboard(createdToken)}>
              <Copy size={14} />
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => {
              setCreatedToken(null);
              tokenNameInputRef.current?.focus();
            }}
          >
            知道了
          </Button>
        </div>
      ) : null}

      {/* 创建 Token */}
      <div className="flex items-end gap-2 mb-4 max-w-md">
        <div className="flex-1">
          <Input
            ref={tokenNameInputRef}
            label="Token 名称"
            value={newTokenName}
            onChange={(e) => setNewTokenName(e.target.value)}
            placeholder="例如：CI/CD 集成"
          />
        </div>
        <Button
          size="sm"
          loading={creating}
          onClick={handleCreate}
          disabled={creating || !newTokenName.trim()}
        >
          创建
        </Button>
      </div>

      {/* Token 列表 */}
      {loading ? (
        <p className="text-xs text-muted-foreground">加载中...</p>
      ) : tokens.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无 API Token</p>
      ) : (
        <div className="space-y-2">
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <p className="text-xs font-medium text-foreground">{t.name}</p>
                <p className="text-2xs text-muted-foreground">
                  {t.tokenPrefix}
                  {t.lastUsedAt ? ` · 最后使用 ${formatDateTimeZhCn(t.lastUsedAt)}` : ' · 从未使用'}
                  {t.expiresAt ? ` · 过期 ${formatDateZhCn(t.expiresAt)}` : ''}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => handleDelete(t)}
              >
                删除
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---- Session 管理区块 ----

function SessionSection() {
  const { notify, confirm } = useFeedback();
  const [sessionList, setSessionList] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/sessions');
      const json = await readApiEnvelope<SessionItem[]>(res);
      if (res.ok && json?.success && Array.isArray(json.data)) {
        setSessionList(json.data);
      }
    } catch {
      // 忽略
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleRevokeOthers = useCallback(async () => {
    const ok = await confirm({
      title: '登出其他设备？',
      description: '将清除除当前浏览器之外的所有登录会话。',
      confirmText: '确认登出',
      confirmVariant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/auth/sessions', { method: 'DELETE' });
      const json = await readApiEnvelope<{ removed: number }>(res);
      if (res.ok && json?.success) {
        notify({ title: '已清除', message: `已登出 ${json.data?.removed ?? 0} 个其他会话`, type: 'success' });
        fetchSessions();
      } else {
        notify({ title: '操作失败', message: resolveApiErrorMessage(res, json, '请求失败'), type: 'error' });
      }
    } catch (err) {
      notify({ title: '操作失败', message: (err as Error).message, type: 'error' });
    }
  }, [confirm, notify, fetchSessions]);

  // 简化 UA 显示
  const shortenUA = (ua: string) => {
    if (ua === '-') return '-';
    // 提取浏览器名
    const match = ua.match(/(Chrome|Firefox|Safari|Edge|Opera|OPR|Brave)\/[\d.]+/);
    return match ? match[0] : ua.slice(0, 50) + (ua.length > 50 ? '...' : '');
  };

  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MonitorSmartphone size={16} className="text-primary" />
          <h2 className="text-sm font-semibold">活跃会话</h2>
        </div>
        {sessionList.length > 1 ? (
          <Button size="sm" variant="destructive" onClick={handleRevokeOthers}>
            登出其他设备
          </Button>
        ) : null}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">加载中...</p>
      ) : sessionList.length === 0 ? (
        <p className="text-xs text-muted-foreground">无活跃会话</p>
      ) : (
        <div className="space-y-2">
          {sessionList.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <p className="text-xs text-foreground">
                  {shortenUA(s.userAgent)}
                  {s.isCurrent ? (
                    <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary">
                      当前
                    </span>
                  ) : null}
                </p>
                <p className="text-2xs text-muted-foreground">
                  IP: {s.ipAddress} · 登录于 {formatDateTimeZhCn(s.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---- 主页面 ----

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const loading = useAuthStore((s) => s.loading);
  const isVirtualUser = Boolean(user?.id?.startsWith('__'));
  const hasPassword = Boolean(user?.hasPassword);

  return (
    <div className="space-y-12">
      <PageHeader title="个人设置" subtitle="管理账户、密码和 API Token" />

      {!user ? (
        <Card padding="lg" className="py-10 text-center text-sm text-muted-foreground">
          {loading && !initialized ? '加载中...' : '未登录'}
        </Card>
      ) : null}

      {user && isVirtualUser ? (
        <Card padding="md">
          <p className="text-sm font-semibold text-foreground mb-1">当前为虚拟账户模式</p>
          <p className="text-xs text-muted-foreground">
            {user.id === '__legacy__'
              ? <>你正在使用 CAM_AUTH_TOKEN 的 legacy 模式访问，暂无个人账户/会话/API Token 管理。可在<Link href="/login" className="underline text-primary hover:text-primary/80">登录页</Link>选择{'"'}初始化管理员{'"'}启用用户系统。</>
              : <>当前实例未启用认证，你以虚拟管理员身份访问。可在<Link href="/login" className="underline text-primary hover:text-primary/80">登录页</Link>初始化管理员账户（推荐）以启用用户系统。</>}
          </p>
        </Card>
      ) : null}

      {/* 用户基本信息 */}
      {user && !isVirtualUser ? (
        <Card padding="md">
          <div className="flex items-center gap-3">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt="" className="h-10 w-10 rounded-full" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <span className="text-sm font-medium text-primary">
                  {(user.displayName || user.username || '?')[0].toUpperCase()}
                </span>
              </div>
            )}
            <div>
              <p className="text-sm font-semibold text-foreground">{user.displayName}</p>
              <p className="text-xs text-muted-foreground">@{user.username} · {user.role}</p>
            </div>
          </div>
        </Card>
      ) : null}

      {/* 修改密码 */}
      {user && !isVirtualUser ? (
        hasPassword ? (
          <ChangePasswordSection />
        ) : (
          <Card padding="md">
            <p className="text-sm font-semibold text-foreground mb-1">密码</p>
            <p className="text-xs text-muted-foreground">
              当前账户未设置密码（OAuth-only），无法使用“修改密码”。如需使用密码登录，请联系管理员重置/创建具备密码的账户。
            </p>
          </Card>
        )
      ) : null}

      {/* API Token */}
      {user && !isVirtualUser ? <ApiTokenSection /> : null}

      {/* Session 管理 */}
      {user && !isVirtualUser ? <SessionSection /> : null}
    </div>
  );
}
