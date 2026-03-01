'use client';

import { useEffect } from 'react';
import { isChunkLoadError, tryReloadOnceForChunkError } from '@/lib/client/chunk-load';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error('全局渲染异常', error);
    tryReloadOnceForChunkError(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background text-foreground">
        <div className="flex min-h-screen items-center justify-center px-6">
          <div className="w-full max-w-xl rounded-xl border border-border bg-card p-8 shadow-[0_1px_3px_rgba(0,0,0,0.3),0_1px_2px_rgba(0,0,0,0.2)]">
            <p className="section-title">系统异常</p>
            <h2 className="mt-2 text-xl font-semibold text-foreground">应用发生严重错误</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              当前会话无法继续处理请求，请先重试；如持续失败，请返回首页后重新进入。
              {isChunkLoadError(error) ? ' 检测到前端资源版本切换异常，建议刷新页面后重试。' : ''}
            </p>
            {error.digest ? (
              <p className="mt-3 text-xs text-muted-foreground">错误标识：{error.digest}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => reset()}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-gradient-to-b from-primary to-[#4f46e5] px-4 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all hover:brightness-110"
              >
                立即重试
              </button>
              <button
                type="button"
                onClick={() => { window.location.href = '/'; }}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-muted px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
              >
                返回首页
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
