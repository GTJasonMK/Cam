// 事件日志骨架屏 — 路由切换时立即显示

import { PageHeaderSkeleton, Skeleton, TableSkeleton } from '@/components/ui/skeleton';

export default function EventsLoading() {
  return (
    <div className="space-y-12">
      {/* PageHeader 骨架 */}
      <PageHeaderSkeleton />

      {/* 筛选工具栏骨架 */}
      <div className="grid grid-cols-6 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 rounded-lg" />
        ))}
      </div>

      {/* 表格骨架 */}
      <TableSkeleton columns={4} rows={10} />

      {/* 分页骨架 */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
