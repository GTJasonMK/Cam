'use client';

// ============================================================
// 登录屏：根据 setup-status 自动选择
// - 无用户：SetupWizard（可选 legacy token / OAuth）
// - 有用户：用户名密码 / OAuth
// - 无认证：直接进入
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { LoginForm } from './login-form';
import { PasswordLoginForm } from './password-login-form';
import { SetupWizard } from './setup-wizard';
import { OAuthButtons } from './oauth-buttons';

type SetupStatus = {
  hasUsers: boolean;
  hasLegacyToken: boolean;
  oauthProviders: Array<{ id: string; displayName: string }>;
  authMode?: 'user_system' | 'legacy_token' | 'setup_required' | 'none';
};

type TabKey = 'setup' | 'legacy';

function computeAuthMode(status: SetupStatus): SetupStatus['authMode'] {
  if (status.hasUsers) return 'user_system';
  if (status.hasLegacyToken) return 'legacy_token';
  return 'setup_required';
}

export function LoginScreen({ nextPath, initialError }: { nextPath: string; initialError: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(initialError);
  const [tab, setTab] = useState<TabKey>('setup');

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/setup-status');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setStatus(null);
        setError(json?.error?.message || `HTTP ${res.status}`);
        return;
      }
      setStatus(json.data as SetupStatus);
    } catch (err) {
      setStatus(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const authMode = useMemo(() => {
    if (!status) return null;
    return status.authMode || computeAuthMode(status);
  }, [status]);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm text-muted-foreground">正在加载登录状态...</span>
      </div>
    );
  }

  if (!status || !authMode) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-semibold">无法获取系统登录状态</p>
        {error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <Button variant="secondary" onClick={() => fetchStatus()}>
          重试
        </Button>
      </div>
    );
  }

  // 显式匿名模式（仅 CAM_ALLOW_ANONYMOUS_ACCESS 开启）
  if (authMode === 'none') {
    return (
      <div className="space-y-4">
        <div className="text-center">
          <h1 className="text-lg font-semibold tracking-tight">无需登录</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            当前实例未启用认证（未设置用户、也未配置 CAM_AUTH_TOKEN）。
          </p>
        </div>
        <Button
          className="w-full"
          onClick={() => {
            router.replace(nextPath);
            router.refresh();
          }}
        >
          进入系统
        </Button>
      </div>
    );
  }

  // 已有用户：用户名密码 + OAuth
  if (authMode === 'user_system') {
    return (
      <div className="space-y-5">
        <PasswordLoginForm nextPath={nextPath} initialError={error} />
        <OAuthButtons providers={status.oauthProviders || []} />
      </div>
    );
  }

  // setup_required / legacy_token：初始化管理员为主，legacy token 可选
  const showTabs = status.hasLegacyToken && !status.hasUsers;

  return (
    <div className="space-y-5">
      {showTabs ? (
        <div role="tablist" aria-label="登录方式" className="grid grid-cols-2 rounded-xl border border-border bg-muted/20 p-1">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'setup'}
            onClick={() => setTab('setup')}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              tab === 'setup' ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            初始化管理员
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'legacy'}
            onClick={() => setTab('legacy')}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              tab === 'legacy' ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            令牌登录
          </button>
        </div>
      ) : null}

      {tab === 'legacy' && status.hasLegacyToken ? (
        <LoginForm nextPath={nextPath} initialError={error} />
      ) : (
        <SetupWizard nextPath={nextPath} />
      )}

      <OAuthButtons providers={status.oauthProviders || []} />
    </div>
  );
}
