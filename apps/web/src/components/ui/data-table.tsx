// ============================================================
// 通用数据表格组件（TanStack Table + shadcn/ui Table 原语）
// 支持列定义、行选择、加载骨架、空状态、行点击、行展开
// ============================================================

'use client';

import {
  type ReactNode,
  type ComponentType,
  useCallback,
  useMemo,
  Fragment,
} from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

// ---- 公开类型（向后兼容的简化列定义） ----

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
  /** 空数据图标 */
  emptyIcon?: ComponentType<{ size?: number; className?: string }>;
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
  /** 行展开渲染（返回 null 表示该行不可展开） */
  renderExpandedRow?: (row: T) => ReactNode | null;
  /** 当前展开的行 key 集合 */
  expandedKeys?: Set<string>;
  /** 展开变更回调 */
  onExpandChange?: (keys: Set<string>) => void;
  /** 是否无外边框（嵌入 Card 内时使用） */
  borderless?: boolean;
}

// ---- 骨架行 ----

function SkeletonRows({ columns, rows = 5 }: { columns: number; rows?: number }) {
  const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-1/3'];
  return (
    <>
      {Array.from({ length: rows }, (_, rowIdx) => (
        <TableRow key={rowIdx} className="border-t border-white/6">
          {Array.from({ length: columns }, (_, colIdx) => (
            <TableCell key={colIdx}>
              <Skeleton className={cn('h-[1.1rem]', widths[(rowIdx + colIdx) % widths.length])} />
            </TableCell>
          ))}
        </TableRow>
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
  emptyIcon: EmptyIcon,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  onRowClick,
  stickyHeader = false,
  renderExpandedRow,
  expandedKeys,
  onExpandChange,
  borderless = false,
}: DataTableProps<T>) {
  // 将简化 Column<T> 转换为 TanStack ColumnDef
  const tanstackColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    const defs: ColumnDef<T, unknown>[] = [];

    // 选择列
    if (selectable) {
      defs.push({
        id: '__select',
        header: () => {
          const allKeys = data.map(rowKey);
          const allSelected =
            allKeys.length > 0 &&
            selectedKeys != null &&
            allKeys.every((k) => selectedKeys.has(k));
          const someSelected =
            selectedKeys != null && selectedKeys.size > 0 && !allSelected;
          return (
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              onChange={() => {
                if (!onSelectionChange) return;
                onSelectionChange(allSelected ? new Set() : new Set(allKeys));
              }}
              className="h-5 w-5 rounded border-border accent-primary sm:h-4 sm:w-4"
            />
          );
        },
        cell: ({ row }) => {
          const key = rowKey(row.original);
          const checked = selectedKeys?.has(key) ?? false;
          return (
            <input
              type="checkbox"
              checked={checked}
              onChange={() => {
                if (!onSelectionChange || !selectedKeys) return;
                const next = new Set(selectedKeys);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                onSelectionChange(next);
              }}
              className="h-5 w-5 rounded border-border accent-primary sm:h-4 sm:w-4"
            />
          );
        },
        size: 40,
        meta: { className: 'w-10' },
      });
    }

    // 数据列
    for (const col of columns) {
      defs.push({
        id: col.key,
        header: () => col.header,
        cell: ({ row }) => col.cell(row.original),
        meta: { className: col.className },
      });
    }

    return defs;
  }, [columns, selectable, data, rowKey, selectedKeys, onSelectionChange]);

  const table = useReactTable({
    data,
    columns: tanstackColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => rowKey(row),
  });

  const totalColumns = selectable ? columns.length + 1 : columns.length;

  const handleToggleExpand = useCallback(
    (key: string) => {
      if (!onExpandChange || !expandedKeys) return;
      const next = new Set(expandedKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onExpandChange(next);
    },
    [expandedKeys, onExpandChange],
  );

  const handleRowClick = useCallback(
    (row: T, key: string, e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'BUTTON' ||
        target.closest('button') ||
        target.closest('a')
      ) {
        return;
      }
      if (renderExpandedRow && onExpandChange) {
        const expandContent = renderExpandedRow(row);
        if (expandContent !== null) {
          handleToggleExpand(key);
          return;
        }
      }
      onRowClick?.(row);
    },
    [renderExpandedRow, onExpandChange, handleToggleExpand, onRowClick],
  );

  const isClickable = Boolean(onRowClick || (renderExpandedRow && onExpandChange));

  return (
    <div
      className={cn(
        'overflow-hidden',
        !borderless && 'rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.02)_100%)] shadow-[var(--shadow-card)]',
      )}
    >
      <Table>
        {/* 表头 */}
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              className={cn(
                'bg-white/[0.04] hover:bg-white/[0.04]',
                stickyHeader && 'sticky top-0 z-10',
              )}
            >
              {headerGroup.headers.map((header) => {
                const meta = header.column.columnDef.meta as
                  | { className?: string }
                  | undefined;
                return (
                  <TableHead key={header.id} className={meta?.className}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>

        {/* 表体 */}
        <TableBody>
          {loading ? (
            <SkeletonRows columns={totalColumns} />
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={totalColumns} className="py-20 text-center">
                {EmptyIcon && (
                  <div className="mb-4 flex justify-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/8 bg-muted/60 shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]">
                      <EmptyIcon size={28} className="text-muted-foreground/50" />
                    </div>
                  </div>
                )}
                <p className="text-[0.95rem] font-medium text-muted-foreground">{emptyMessage}</p>
                {emptyHint ? (
                  <p className="mt-1.5 text-sm text-muted-foreground/70">{emptyHint}</p>
                ) : null}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => {
              const key = row.id;
              const selected = selectedKeys?.has(key) ?? false;
              const expanded = expandedKeys?.has(key) ?? false;
              const expandContent = renderExpandedRow
                ? renderExpandedRow(row.original)
                : null;
              return (
                <Fragment key={key}>
                  <TableRow
                    data-state={selected ? 'selected' : undefined}
                    className={cn(
                      'border-t border-white/6',
                      selected ? 'bg-primary/12' : '',
                      isClickable && 'cursor-pointer',
                    )}
                    onClick={
                      isClickable
                        ? (e) => handleRowClick(row.original, key, e)
                        : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as
                        | { className?: string }
                        | undefined;
                      return (
                        <TableCell key={cell.id} className={meta?.className}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  {expanded && expandContent !== null && (
                    <TableRow className="border-t border-white/10 bg-white/[0.04] hover:bg-white/[0.04]">
                      <TableCell colSpan={totalColumns} className="px-6 py-5">
                        {expandContent}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
