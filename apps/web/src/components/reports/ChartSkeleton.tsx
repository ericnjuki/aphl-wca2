import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  bars?: number;
  height?: number;
}

export function ChartSkeleton({ bars = 6, height = 360 }: Props) {
  const rows = Array.from({ length: bars });
  return (
    <div className="flex flex-col gap-2 p-4" style={{ minHeight: height }}>
      {rows.map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-5 w-40 rounded-sm" />
          <Skeleton className="h-5 rounded-sm" style={{ width: `${20 + Math.random() * 70}%` }} />
        </div>
      ))}
    </div>
  );
}
