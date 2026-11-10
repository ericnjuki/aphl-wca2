import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { useFacilityReport } from '@/hooks/reports/useReportQueries';
import { MaturityLegend } from '../MaturityLegend';
import { MaturityStackedBar } from '../MaturityStackedBar';
import { MaturityBreakdownTable } from '../MaturityBreakdownTable';
import { ChartSkeleton } from '../ChartSkeleton';
import { ReportKpiCards } from '../ReportKpiCards';
import { PrivacyHiddenNotice } from '../PrivacyHiddenNotice';
import { UnassignedBanner } from '../UnassignedBanner';
import { archivedLabel } from '@/lib/reports/archived';

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || '/';

interface Props { facilityId: number }

export function FacilityReport({ facilityId }: Props) {
  const navigate = useNavigate();
  // Partner users can't open department reports (they list named people).
  const isMonitor = useAuthStore((s) => s.user?.role === 'monitor');
  const openDepartment = isMonitor
    ? undefined
    : (key: string) => navigate(`${baseUrl}reports/departments/${key}?facility_id=${facilityId}`);
  const { data, isPending, isError, error } = useFacilityReport(facilityId);

  if (isPending) return <ChartSkeleton />;
  if (isError) return <div className="p-6 text-sm text-destructive">Error: {(error as Error).message}</div>;

  const covered = data.items.filter((r) => r.respondents > 0 || !!r.suppressed).length;

  return (
    <div className="flex flex-col gap-4 p-4">
      {data.meta.privacy_hidden && <PrivacyHiddenNotice entity="facility" />}
      <UnassignedBanner level="facility" count={data.meta.unassigned_respondents} />
      <ReportKpiCards
        totalRespondents={data.meta.total_respondents}
        avgLevel={data.meta.avg_level}
        bucketsCovered={covered}
        bucketsLabel="departments"
        hidden={data.meta.privacy_hidden}
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
              label: archivedLabel(r.department_name, r.archived),
              ...r,
            }))}
            onBarClick={openDepartment}
            emptyText="No departments linked to this facility"
          />
        </div>
      </div>
      <MaturityBreakdownTable
        rows={data.items.map((r) => ({ key: String(r.department_id), label: archivedLabel(r.department_name, r.archived), ...r }))}
        onRowClick={openDepartment}
        labelHeader="Department"
      />
    </div>
  );
}
