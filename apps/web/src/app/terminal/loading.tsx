import { Skeleton } from '@/components/ui/skeleton';

export default function TerminalLoading() {
  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-3">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-5 w-72" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
        </div>
        <Skeleton className="h-px w-full" />
      </div>

      <div className="rounded-xl border border-border bg-card/70 px-5 py-4">
        <Skeleton className="h-5 w-[520px] max-w-full" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-border p-4">
            <Skeleton className="h-5 w-28" />
            <div className="mt-3 flex gap-2">
              <Skeleton className="h-7 w-16 rounded-md" />
              <Skeleton className="h-7 w-16 rounded-md" />
              <Skeleton className="h-7 w-16 rounded-md" />
            </div>
            <Skeleton className="mt-3 h-9 w-full rounded-lg" />
            <div className="mt-4 space-y-2">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          </div>
          <div className="rounded-2xl border border-border p-4">
            <Skeleton className="h-5 w-28" />
            <div className="mt-3 space-y-2">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border overflow-hidden">
          <div className="border-b border-border p-4">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-2 h-4 w-64" />
          </div>
          <div className="border-b border-border p-2">
            <Skeleton className="h-8 w-40 rounded-md" />
          </div>
          <div className="h-[540px] bg-[var(--background-elevated)] p-4">
            <div className="space-y-2">
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
