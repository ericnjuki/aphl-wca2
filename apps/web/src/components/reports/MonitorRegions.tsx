import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || '/';

interface Props { regions: { id: number; name: string }[] }

// Landing view for partner users assigned to several regions.
export function MonitorRegions({ regions }: Props) {
  if (regions.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No regions are assigned to your account yet. Ask an administrator to assign one.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">Your regions</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {regions.map((r) => (
          <Link
            key={r.id}
            to={`${baseUrl}reports/regions/${r.id}`}
            className="flex items-center gap-2 rounded-sm border bg-background px-4 py-3 text-sm transition-colors hover:bg-[rgba(70,130,180,0.08)]"
          >
            <MapPin className="h-4 w-4 text-muted-foreground" />
            {r.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
