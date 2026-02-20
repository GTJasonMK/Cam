'use client';

// ============================================================
// 首次设置向导：创建管理员账户
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AUTH_MESSAGES } from '@/lib/i18n/messages';
import { Shield } from 'lucide-react';

export function SetupWizard({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmError, setConfirmError] = useState('');

  const handleSetup = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName, password }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.error?.message || AUTH_MESSAGES.loginFailedWithStatus(res.status));
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = username.trim().length >= 3
    && displayName.trim().length > 0
    && password.length >= 8
    && password === confirmPassword;

  return (
    <form onSubmit={handleSetup} className="space-y-5">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Shield size={22} className="text-primary" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">初始化 CAM</h1>
        <p className="mt-1 text-sm text-muted-foreground">{AUTH_MESSAGES.setupHint}</p>
      </div>
      <Input
        label="用户名"
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
        autoFocus
        autoComplete="username"
        placeholder="admin"
      />
      <Input
        label="显示名称"
        type="text"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        required
        autoComplete="name"
        placeholder="管理员"
      />
      <Input
        label="密码"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="new-password"
        placeholder="至少 8 个字符"
      />
      <Input
        label="确认密码"
        type="password"
        value={confirmPassword}
        onChange={(e) => {
          setConfirmPassword(e.target.value);
          if (confirmError) setConfirmError('');
        }}
        onBlur={() => {
          if (confirmPassword && password !== confirmPassword) {
            setConfirmError('两次输入的密码不一致');
          }
        }}
        error={confirmError}
        required
        autoComplete="new-password"
        placeholder="再次输入密码"
      />
      {error ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <Button type="submit" loading={loading} disabled={!canSubmit} className="w-full">
        创建管理员并登录
      </Button>
    </form>
  );
}
