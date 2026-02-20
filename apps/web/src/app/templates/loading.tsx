// 任务模板骨架屏 — 路由切换时立即显示

import { PageHeaderSkeleton, Skeleton, TableSkeleton } from '@/components/ui/skeleton';

export default function TemplatesLoading() {
  return (
    <div className="space-y-12">
      {/* PageHeader 骨架 */}
      <PageHeaderSkeleton />

      {/* 搜索栏骨架 */}
      <Skeleton className="h-9 w-64 rounded-lg" />

      {/* 表格骨架 */}
      <TableSkeleton columns={5} rows={5} />
    </div>
  );
}
