// shadcn/ui Skeleton + 表格/页头骨架

import * as React from 'react';
import { cn } from '@/lib/utils';

/* ---- 基础骨架块 ---- */

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('relative overflow-hidden rounded bg-muted/60', className)}
      {...props}
    >
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
    </div>
  );
}

/* ---- 表格骨架 ---- */

interface TableSkeletonProps {
  columns: number;
  rows?: number;
}

function TableSkeleton({ columns, rows = 5 }: TableSkeletonProps) {
  const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-1/3'];
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/40">
            {Array.from({ length: columns }, (_, i) => (
              <th key={i} className="px-5 py-4">
                <Skeleton className="h-4 w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, rowIdx) => (
            <tr key={rowIdx} className="border-t border-border">
              {Array.from({ length: columns }, (_, colIdx) => (
                <td key={colIdx} className="px-5 py-4">
                  <Skeleton className={cn('h-4', widths[(rowIdx + colIdx) % widths.length])} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- 页面标题骨架 ---- */

function PageHeaderSkeleton() {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-2">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-6 w-64" />
      </div>
      <Skeleton className="h-11 w-32 rounded-lg" />
    </div>
  );
}

export { Skeleton, TableSkeleton, PageHeaderSkeleton };
