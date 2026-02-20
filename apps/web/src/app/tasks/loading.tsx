// 任务列表骨架屏 — 路由切换时立即显示

import { PageHeaderSkeleton, Skeleton, TableSkeleton } from '@/components/ui/skeleton';

export default function TasksLoading() {
  return (
    <div className="space-y-12">
      {/* PageHeader 骨架 */}
      <PageHeaderSkeleton />

      {/* Tabs 骨架 */}
      <div className="flex gap-1">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-lg" />
        ))}
      </div>

      {/* 工具栏骨架 */}
      <div className="flex items-end gap-3">
        <Skeleton className="h-9 w-64 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      {/* 表格骨架 */}
      <TableSkeleton columns={7} rows={8} />
    </div>
  );
}
