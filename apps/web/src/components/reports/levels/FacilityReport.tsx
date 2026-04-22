import { useNavigate } from 'react-router-dom';
import { useFacilityReport } from '@/hooks/reports/useReportQueries';
import { MaturityLegend } from '../MaturityLegend';
import { MaturityStackedBar } from '../MaturityStackedBar';
import { MaturityBreakdownTable } from '../MaturityBreakdownTable';
import { ChartSkeleton } from '../ChartSkeleton';
import { ReportKpiCards } from '../ReportKpiCards';
import { UnassignedBanner } from '../UnassignedBanner';

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || '/';

interface Props { facilityId: number }

export function FacilityReport({ facilityId }: Props) {
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useFacilityReport(facilityId);

  if (isPending) return <ChartSkeleton />;
  if (isError) return <div className="p-6 text-sm text-destructive">Error: {(error as Error).message}</div>;

  const covered = data.items.filter((r) => r.respondents > 0).length;
  const totalResp = data.items.reduce((s, r) => s + r.respondents, 0);
  const avgLevel = totalResp > 0
    ? data.items.reduce((s, r) => s + (r.avg_level ?? 0) * r.respondents, 0) / totalResp
    : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <UnassignedBanner level="facility" count={data.meta.unassigned_respondents} />
      <ReportKpiCards
        totalRespondents={data.meta.total_respondents}
        avgLevel={avgLevel}
        bucketsCovered={covered}
        bucketsLabel="departments"
      />
      <div className="rounded-sm border bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Departments at {data.facility.name}</h2>
          <MaturityLegend />
        </div>
        <div id="report-bar-chart" className="p-3">
          <MaturityStackedBar
            data={data.items.map((r) => ({
              key: String(r.department_id),
              label: r.department_name,
              ...r,
            }))}
            onBarClick={(key) => navigate(`${baseUrl}reports/departments/${key}`)}
            emptyText="No departments linked to this facility"
          />
        </div>
      </div>
      <MaturityBreakdownTable
        rows={data.items.map((r) => ({ key: String(r.department_id), label: r.department_name, ...r }))}
        onRowClick={(key) => navigate(`${baseUrl}reports/departments/${key}`)}
        labelHeader="Department"
      />
    </div>
  );
}
