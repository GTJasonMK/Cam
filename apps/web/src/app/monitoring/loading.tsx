import { Skeleton } from '@/components/ui/skeleton';

export default function MonitoringLoading() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-16 w-72" />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, idx) => (
          <Skeleton key={idx} className="h-44 w-full rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, idx) => (
          <Skeleton key={idx} className="h-72 w-full rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Skeleton className="h-96 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    </div>
  );
}
