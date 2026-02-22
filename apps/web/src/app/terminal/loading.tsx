import { Skeleton } from '@/components/ui/skeleton';

export default function TerminalLoading() {
  return (
    <div className="space-y-12">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-3">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-5 w-80" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-11 w-28 rounded-lg" />
            <Skeleton className="h-11 w-28 rounded-lg" />
            <Skeleton className="h-11 w-28 rounded-lg" />
          </div>
        </div>
        <Skeleton className="h-px w-full" />
      </div>

      <div className="rounded-xl border border-border bg-card/70 px-5 py-4">
        <Skeleton className="h-5 w-[560px] max-w-full" />
      </div>

      <div className="rounded-xl border border-border p-3">
        <div className="flex gap-2">
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-24 rounded-lg" />
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-wrap items-end gap-5">
          <Skeleton className="h-11 w-80 rounded-lg" />
          <Skeleton className="h-11 w-36 rounded-lg" />
        </div>
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      <div className="rounded-2xl border border-border p-5">
        <div className="space-y-3">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
