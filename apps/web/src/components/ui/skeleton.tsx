// ============================================================
// 骨架屏加载组件
// 提供基础骨架块和表格骨架两种形态
// ============================================================

interface SkeletonProps {
  className?: string;
}

/** 基础骨架块 - 灰色脉冲动画方块 */
export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}

interface TableSkeletonProps {
  /** 列数 */
  columns: number;
  /** 行数，默认 5 */
  rows?: number;
}

/** 表格骨架 - 模拟表格加载状态 */
export function TableSkeleton({ columns, rows = 5 }: TableSkeletonProps) {
  const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-1/3'];

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        {/* 表头骨架 */}
        <thead>
          <tr className="bg-muted/50">
            {Array.from({ length: columns }, (_, i) => (
              <th key={i} className="px-4 py-3">
                <div className="h-3 w-16 animate-pulse rounded bg-muted" />
              </th>
            ))}
          </tr>
        </thead>
        {/* 数据行骨架 */}
        <tbody>
          {Array.from({ length: rows }, (_, rowIdx) => (
            <tr key={rowIdx} className="border-t border-border">
              {Array.from({ length: columns }, (_, colIdx) => (
                <td key={colIdx} className="px-4 py-3">
                  <div
                    className={`h-4 animate-pulse rounded bg-muted ${widths[(rowIdx + colIdx) % widths.length]}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
