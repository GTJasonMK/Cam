import { PageHeaderSkeleton, Skeleton, TableSkeleton } from '@/components/ui/skeleton';

export default function WorkerTerminalLoading() {
  return (
    <div className="space-y-12">
      <PageHeaderSkeleton />

      <div className="space-y-4 rounded-xl border border-border bg-card/70 px-5 py-4">
        <Skeleton className="h-5 w-40" />
        <div className="flex flex-wrap items-center gap-5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-4 w-28" />
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
        <TableSkeleton columns={6} rows={5} />
      </div>
    </div>
  );
}
