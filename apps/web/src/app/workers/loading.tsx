// 工作节点骨架屏 — 路由切换时立即显示

import { PageHeaderSkeleton, Skeleton, TableSkeleton } from '@/components/ui/skeleton';

export default function WorkersLoading() {
  return (
    <div className="space-y-12">
      {/* PageHeader 骨架 */}
      <PageHeaderSkeleton />

      {/* 统计摘要骨架 */}
      <div className="flex items-center gap-6">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>

      {/* 表格骨架 */}
      <TableSkeleton columns={6} rows={6} />
    </div>
  );
}
