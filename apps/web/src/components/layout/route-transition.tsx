// 路由切换过渡组件
// 监听全局导航状态，在内容区域显示加载动画

'use client';

import { usePathname } from 'next/navigation';
import { useNavigationStore } from '@/stores';
import { Skeleton } from '@/components/ui/skeleton';

export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const pendingPath = useNavigationStore((s) => s.pendingPath);
  const isNavigating = pendingPath !== null && pendingPath !== pathname;

  if (!isNavigating) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-12 animate-fade-in">
      {/* 通用页面骨架 */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-10 w-48" />
          <Skeleton className="mt-2.5 h-6 w-64" />
        </div>
        <Skeleton className="h-11 w-32 rounded-lg" />
      </div>

      <div className="space-y-3.5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
