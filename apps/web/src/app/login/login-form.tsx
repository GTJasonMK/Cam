'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readApiEnvelope, resolveApiErrorMessage } from '@/lib/http/client-response';
import { AUTH_MESSAGES } from '@/lib/i18n/messages';
import { Lock } from 'lucide-react';

export function LoginForm({ nextPath, initialError }: { nextPath: string; initialError: string }) {
  const router = useRouter();
  const [token, setToken] = useState('');
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
        body: JSON.stringify({ token }),
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

  return (
    <form onSubmit={handleLogin} className="space-y-5">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Lock size={22} className="text-primary" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">登录 CAM</h1>
        <p className="mt-1 text-sm text-muted-foreground">{AUTH_MESSAGES.tokenInputHint}</p>
      </div>
      <Input
        label="访问令牌"
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        required
        autoFocus
        placeholder="CAM_AUTH_TOKEN"
      />
      {error ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <Button type="submit" disabled={loading || token.trim().length === 0} className="w-full">
        {loading ? '登录中...' : '登录'}
      </Button>
    </form>
  );
}
