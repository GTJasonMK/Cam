// 行内资源进度条 — 用于表格中显示 CPU/内存等指标

interface InlineBarProps {
  value: number | null;
  max: number;
  unit: string;
}

export function InlineBar({ value, max, unit }: InlineBarProps) {
  if (value == null) {
    return <span className="text-sm text-muted-foreground/40">-</span>;
  }
  const pct = Math.min((value / max) * 100, 100);
  const color =
    pct > 80
      ? 'var(--color-destructive)'
      : pct > 50
        ? 'var(--color-warning)'
        : 'var(--color-primary)';

  return (
    <div className="flex items-center gap-3">
      <div className="h-2.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="font-mono text-sm text-muted-foreground">
        {value}{unit}
      </span>
    </div>
  );
}
