import { Card, CardContent } from '@/components/ui/card';
import { Users, Gauge, FileCheck2 } from 'lucide-react';
import { formatAvgLevel } from '@/lib/reports/maturity';

interface Props {
  totalRespondents: number;
  avgLevel: number | null;
  bucketsCovered: number;
  bucketsLabel: string;        // e.g. "regions", "facilities"
}

function avgLabel(avg: number | null): string {
  if (avg == null) return '—';
  if (avg < 1.5) return 'Beginner';
  if (avg < 2.5) return 'Competent';
  if (avg < 3.5) return 'Proficient';
  return 'Expert';
}

export function ReportKpiCards({
  totalRespondents,
  avgLevel,
  bucketsCovered,
  bucketsLabel,
}: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card className="rounded-sm">
        <CardContent className="flex items-center gap-3 py-3">
          <div className="rounded-sm bg-primary/10 p-2 text-primary">
            <Users className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Respondents</span>
            <span className="text-2xl font-semibold leading-tight">{totalRespondents.toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>
      <Card className="rounded-sm">
        <CardContent className="flex items-center gap-3 py-3">
          <div className="rounded-sm bg-primary/10 p-2 text-primary">
            <Gauge className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Avg maturity</span>
            <span className="text-2xl font-semibold leading-tight">
              {formatAvgLevel(avgLevel)}{' '}
              <span className="text-sm font-normal text-muted-foreground">{avgLabel(avgLevel)}</span>
            </span>
          </div>
        </CardContent>
      </Card>
      <Card className="rounded-sm">
        <CardContent className="flex items-center gap-3 py-3">
          <div className="rounded-sm bg-primary/10 p-2 text-primary">
            <FileCheck2 className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground capitalize">{bucketsLabel} covered</span>
            <span className="text-2xl font-semibold leading-tight">{bucketsCovered.toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
