import { useNavigate } from 'react-router-dom';
import { useDepartmentReport } from '@/hooks/reports/useReportQueries';
import { MaturityLegend } from '../MaturityLegend';
import { MaturityStackedBar } from '../MaturityStackedBar';
import { MaturityBreakdownTable } from '../MaturityBreakdownTable';
import { ChartSkeleton } from '../ChartSkeleton';
import { ReportKpiCards } from '../ReportKpiCards';

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || '/';

interface Props { departmentId: number; facilityId: number | null }

export function DepartmentReport({ departmentId, facilityId }: Props) {
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useDepartmentReport(departmentId, facilityId);

  if (isPending) return <ChartSkeleton />;
  if (isError) return <div className="p-6 text-sm text-destructive">Error: {(error as Error).message}</div>;

  const covered = data.items.length;

  return (
    <div className="flex flex-col gap-4 p-4">
      <ReportKpiCards
        totalRespondents={data.meta.total_respondents}
        avgLevel={data.meta.avg_level}
        bucketsCovered={covered}
        bucketsLabel="respondents"
      />
      <div className="rounded-sm border bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Personnel in {data.department.name}</h2>
          <MaturityLegend />
        </div>
        <div id="report-bar-chart" className="p-3">
          <MaturityStackedBar
            data={data.items.map((r) => ({
              key: String(r.user_id),
              label: r.full_name,
              ...r,
            }))}
            onBarClick={(key) => navigate(`${baseUrl}reports/users/${key}`)}
            emptyText="No respondents in this department yet"
            height={data.items.length * 32 + 60}
          />
        </div>
      </div>
      <MaturityBreakdownTable
        rows={data.items.map((r) => ({
          key: String(r.user_id),
          label: r.full_name,
          meta: r.title_name,
          ...r,
        }))}
        onRowClick={(key) => navigate(`${baseUrl}reports/users/${key}`)}
        labelHeader="Person"
        metaHeader="Title"
      />
    </div>
  );
}
