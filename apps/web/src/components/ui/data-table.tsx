// ============================================================
// 通用数据表格组件
// 支持列定义、行选择、加载骨架、空状态、行点击
// ============================================================

'use client';

import { type ReactNode, useCallback } from 'react';

// ---- 类型定义 ----

export interface Column<T> {
  /** 列唯一标识 */
  key: string;
  /** 表头内容 */
  header: string | ReactNode;
  /** 单元格渲染函数 */
  cell: (row: T) => ReactNode;
  /** 列自定义样式（宽度等） */
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  /** 获取行唯一标识 */
  rowKey: (row: T) => string;
  /** 加载状态 */
  loading?: boolean;
  /** 空数据提示文字 */
  emptyMessage?: string;
  /** 空数据补充提示 */
  emptyHint?: string;
  /** 是否启用行选择 */
  selectable?: boolean;
  /** 已选中的行 key 集合 */
  selectedKeys?: Set<string>;
  /** 选择变更回调 */
  onSelectionChange?: (keys: Set<string>) => void;
  /** 行点击回调 */
  onRowClick?: (row: T) => void;
  /** 表头是否固定 */
  stickyHeader?: boolean;
}

// ---- 骨架行 ----

function SkeletonRows({ columns, rows = 5 }: { columns: number; rows?: number }) {
  // 预定义不同宽度，让骨架看起来更自然
  const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-1/3'];
  return (
    <>
      {Array.from({ length: rows }, (_, rowIdx) => (
        <tr key={rowIdx} className="border-t border-border">
          {Array.from({ length: columns }, (_, colIdx) => (
            <td key={colIdx} className="px-4 py-3">
              <div className={`h-4 rounded bg-muted animate-pulse ${widths[(rowIdx + colIdx) % widths.length]}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ---- 主组件 ----

export function DataTable<T>({
  columns,
  data,
  rowKey,
  loading = false,
  emptyMessage = '暂无数据',
  emptyHint,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  onRowClick,
  stickyHeader = false,
}: DataTableProps<T>) {
  // 全选 / 取消全选
  const allKeys = data.map(rowKey);
  const allSelected = allKeys.length > 0 && selectedKeys != null && allKeys.every((k) => selectedKeys.has(k));
  const someSelected = selectedKeys != null && selectedKeys.size > 0 && !allSelected;

  const handleSelectAll = useCallback(() => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(allKeys));
    }
  }, [allSelected, allKeys, onSelectionChange]);

  const handleSelectRow = useCallback(
    (key: string) => {
      if (!onSelectionChange || !selectedKeys) return;
      const next = new Set(selectedKeys);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      onSelectionChange(next);
    },
    [selectedKeys, onSelectionChange]
  );

  // 总列数（含 checkbox 列）
  const totalColumns = selectable ? columns.length + 1 : columns.length;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          {/* 表头 */}
          <thead>
            <tr
              className={`bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground ${
                stickyHeader ? 'sticky top-0 z-10' : ''
              }`}
            >
              {selectable ? (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={handleSelectAll}
                    className="h-3.5 w-3.5 rounded border-border accent-primary"
                  />
                </th>
              ) : null}
              {columns.map((col) => (
                <th key={col.key} className={`px-4 py-3 ${col.className || ''}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>

          {/* 表体 */}
          <tbody>
            {loading ? (
              <SkeletonRows columns={totalColumns} />
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={totalColumns} className="py-16 text-center">
                  <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                  {emptyHint ? (
                    <p className="mt-1 text-xs text-muted-foreground/70">{emptyHint}</p>
                  ) : null}
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const key = rowKey(row);
                const selected = selectedKeys?.has(key) ?? false;
                return (
                  <tr
                    key={key}
                    className={`border-t border-border transition-colors ${
                      selected ? 'bg-primary/5' : 'hover:bg-muted/30'
                    } ${onRowClick ? 'cursor-pointer' : ''}`}
                    onClick={
                      onRowClick
                        ? (e) => {
                            // 点击 checkbox 或按钮时不触发行点击
                            const target = e.target as HTMLElement;
                            if (
                              target.tagName === 'INPUT' ||
                              target.tagName === 'BUTTON' ||
                              target.closest('button') ||
                              target.closest('a')
                            ) {
                              return;
                            }
                            onRowClick(row);
                          }
                        : undefined
                    }
                  >
                    {selectable ? (
                      <td className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => handleSelectRow(key)}
                          className="h-3.5 w-3.5 rounded border-border accent-primary"
                        />
                      </td>
                    ) : null}
                    {columns.map((col) => (
                      <td key={col.key} className={`px-4 py-3 ${col.className || ''}`}>
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
