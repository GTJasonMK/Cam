'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readApiEnvelope, resolveApiErrorMessage } from '@/lib/http/client-response';
import { AUTH_MESSAGES } from '@/lib/i18n/messages';
import { KeyRound, LogIn } from 'lucide-react';

export function PasswordLoginForm({
  nextPath,
  initialError,
}: {
  nextPath: string;
  initialError: string;
}) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const json = await readApiEnvelope<unknown>(res);
      if (!res.ok || !json?.success) {
        setError(resolveApiErrorMessage(res, json, AUTH_MESSAGES.loginFailedWithStatus(res.status)));
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

  const canSubmit = username.trim().length >= 1 && password.length >= 1;

  return (
    <form onSubmit={handleLogin} className="space-y-5">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <KeyRound size={22} className="text-primary" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">登录 CAM</h1>
        <p className="mt-1 text-sm text-muted-foreground">使用用户名与密码登录</p>
      </div>

      <Input
        label="用户名"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
        autoFocus
        autoComplete="username"
        placeholder="your-name"
      />

      <Input
        label="密码"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="current-password"
        placeholder="至少 8 个字符"
      />

      {error ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Button type="submit" loading={loading} disabled={!canSubmit} className="w-full">
        <LogIn size={16} />
        登录
      </Button>
    </form>
  );
}
