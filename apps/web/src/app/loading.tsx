// 仪表盘骨架屏 — 路由切换时立即显示

import { PageHeaderSkeleton, Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <div className="space-y-14">
      {/* PageHeader 骨架 */}
      <PageHeaderSkeleton />

      {/* KPI 卡片骨架 */}
      <div className="grid grid-cols-1 gap-9 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="min-h-[9.25rem] rounded-2xl border border-white/8 p-7 shadow-[var(--shadow-card)]">
            <div className="flex items-start justify-between gap-4">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-14 w-14 rounded-xl" />
            </div>
            <Skeleton className="mt-6 h-10 w-20" />
          </div>
        ))}
      </div>

      {/* 两列布局骨架 */}
      <div className="grid gap-9 xl:grid-cols-3">
        <div className="space-y-9 xl:col-span-2">
          {/* Worker 表格骨架 */}
          <div className="rounded-2xl border border-white/8 p-8 shadow-[var(--shadow-card)]">
            <Skeleton className="mb-7 h-4 w-20" />
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          </div>
          {/* Agent 统计骨架 */}
          <div className="rounded-2xl border border-white/8 p-8 shadow-[var(--shadow-card)]">
            <Skeleton className="mb-7 h-4 w-24" />
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
        {/* 最近事件骨架 */}
        <div className="rounded-2xl border border-white/8 shadow-[var(--shadow-card)]">
          <div className="border-b border-border/30 px-7 py-5">
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="space-y-5 p-7">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-start gap-4">
                <Skeleton className="mt-2 h-1.5 w-1.5 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3.5 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
