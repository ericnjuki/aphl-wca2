import { useNavigate } from 'react-router-dom';
import { useNationalReport } from '@/hooks/reports/useReportQueries';
import { MaturityLegend } from '../MaturityLegend';
import { MaturityStackedBar } from '../MaturityStackedBar';
import { MaturityBreakdownTable } from '../MaturityBreakdownTable';
import { ChartSkeleton } from '../ChartSkeleton';
import { ReportKpiCards } from '../ReportKpiCards';
import { UnassignedBanner } from '../UnassignedBanner';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { FileText } from 'lucide-react';

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || '/';

export function NationalReport() {
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useNationalReport();

  if (isPending) return <ChartSkeleton />;
  if (isError) return <div className="p-6 text-sm text-destructive">Error: {(error as Error).message}</div>;

  const coveredRegions = data.items.filter((r) => r.respondents > 0).length;
  const avgLevel = data.meta.total_respondents > 0
    ? data.items.reduce((s, r) => s + (r.avg_level ?? 0) * r.respondents, 0) /
      Math.max(data.items.reduce((s, r) => s + r.respondents, 0), 1)
    : null;

  if (data.meta.total_respondents === 0) {
    return (
      <div className="p-4 space-y-4">
        <Empty>
          <EmptyHeader>
            <FileText className="h-8 w-8 text-muted-foreground" />
            <EmptyTitle>No assessments completed yet</EmptyTitle>
            <EmptyDescription>
              Reports populate once users complete domain assessments. Invite your team to start.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <UnassignedBanner level="national" count={data.meta.unassigned_respondents} />
      <ReportKpiCards
        totalRespondents={data.meta.total_respondents}
        avgLevel={avgLevel}
        bucketsCovered={coveredRegions}
        bucketsLabel="regions"
      />
      <div className="rounded-sm border bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Regions</h2>
          <MaturityLegend />
        </div>
        <div id="report-bar-chart" className="p-3">
          <MaturityStackedBar
            data={data.items.map((r) => ({
              key: String(r.region_id),
              label: r.region_name,
              ...r,
            }))}
            onBarClick={(key) => navigate(`${baseUrl}reports/regions/${key}`)}
            emptyText="No regions configured"
          />
        </div>
      </div>
      <MaturityBreakdownTable
        rows={data.items.map((r) => ({ key: String(r.region_id), label: r.region_name, ...r }))}
        onRowClick={(key) => navigate(`${baseUrl}reports/regions/${key}`)}
        labelHeader="Region"
      />
    </div>
  );
}
