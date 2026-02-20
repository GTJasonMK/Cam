import { Skeleton } from '@/components/ui/skeleton';

export default function TerminalLoading() {
  return (
    <div className="-mx-8 -my-14 flex h-screen flex-col sm:-mx-12 lg:-mx-16 lg:-my-16">
      {/* 工具栏骨架 */}
      <div className="flex items-center justify-between border-b border-white/8 bg-[#080a0e] px-3 py-2">
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-7 w-24 rounded-lg" />
      </div>

      {/* 标签栏骨架 */}
      <div className="flex gap-1 border-b border-white/8 bg-[#080a0e] px-1 py-1">
        <Skeleton className="h-8 w-28 rounded-t-lg" />
      </div>

      {/* 终端区域骨架 */}
      <div className="flex-1 bg-[#0a0c12] p-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    </div>
  );
}
