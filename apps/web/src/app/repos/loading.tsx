// 仓库管理骨架屏 — 路由切换时立即显示

import { PageHeaderSkeleton, TableSkeleton } from '@/components/ui/skeleton';

export default function ReposLoading() {
  return (
    <div className="space-y-12">
      {/* PageHeader 骨架 */}
      <PageHeaderSkeleton />

      {/* 表格骨架 */}
      <TableSkeleton columns={5} rows={5} />
    </div>
  );
}
