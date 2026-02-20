// 任务详情骨架屏 — 路由切换时立即显示

import { Skeleton } from '@/components/ui/skeleton';

export default function TaskDetailLoading() {
  return (
    <div className="space-y-12">
      {/* 返回按钮 + 标题栏骨架 */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <div className="flex-1">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-1.5 h-3.5 w-32" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-lg" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
      </div>

      {/* 信息栏骨架 */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>

      {/* Tabs 骨架 */}
      <div className="flex gap-1">
        <Skeleton className="h-8 w-16 rounded-lg" />
        <Skeleton className="h-8 w-20 rounded-lg" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>

      {/* 日志区域骨架 */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="space-y-2">
          <Skeleton className="h-4 w-[95%]" />
          <Skeleton className="h-4 w-[72%]" />
          <Skeleton className="h-4 w-[88%]" />
          <Skeleton className="h-4 w-[60%]" />
          <Skeleton className="h-4 w-[80%]" />
          <Skeleton className="h-4 w-[68%]" />
          <Skeleton className="h-4 w-[92%]" />
          <Skeleton className="h-4 w-[75%]" />
          <Skeleton className="h-4 w-[85%]" />
          <Skeleton className="h-4 w-[63%]" />
          <Skeleton className="h-4 w-[90%]" />
          <Skeleton className="h-4 w-[70%]" />
        </div>
      </div>
    </div>
  );
}
