// 智能体定义骨架屏 — 路由切换时立即显示

import { PageHeaderSkeleton, Skeleton, TableSkeleton } from '@/components/ui/skeleton';

export default function AgentsLoading() {
  return (
    <div className="space-y-12">
      {/* PageHeader 骨架 */}
      <PageHeaderSkeleton />

      {/* Tabs 骨架 */}
      <div className="flex gap-1">
        <Skeleton className="h-8 w-16 rounded-lg" />
        <Skeleton className="h-8 w-16 rounded-lg" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>

      {/* 表格骨架 */}
      <TableSkeleton columns={5} rows={5} />
    </div>
  );
}
