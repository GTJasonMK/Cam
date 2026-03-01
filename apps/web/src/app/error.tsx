'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { isChunkLoadError, tryReloadOnceForChunkError } from '@/lib/client/chunk-load';

interface PageErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: PageErrorProps) {
  useEffect(() => {
    console.error('页面渲染异常', error);
    tryReloadOnceForChunkError(error);
  }, [error]);

  return (
    <div className="py-20">
      <Card className="mx-auto max-w-xl" padding="lg">
        <p className="section-title">页面异常</p>
        <h2 className="mt-2 text-xl font-semibold text-foreground">当前页面加载失败</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          已拦截本次异常，建议先重试；如果仍然失败，请查看事件页或日志定位问题。
          {isChunkLoadError(error) ? ' 检测到前端资源版本切换异常，建议刷新页面后重试。' : ''}
        </p>
        {error.digest ? (
          <p className="mt-3 text-xs text-muted-foreground">错误标识：{error.digest}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => reset()}>
            立即重试
          </Button>
          <Link
            href="/tasks"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-muted px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
          >
            返回任务列表
          </Link>
        </div>
      </Card>
    </div>
  );
}
