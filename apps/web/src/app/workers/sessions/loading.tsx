// 托管会话池骨架屏

export default function WorkerSessionsLoading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-40 animate-pulse rounded bg-muted/40" />
      <div className="h-24 animate-pulse rounded-xl border border-border bg-card/60" />
      <div className="h-72 animate-pulse rounded-xl border border-border bg-card/60" />
      <div className="h-64 animate-pulse rounded-xl border border-border bg-card/60" />
    </div>
  );
}
