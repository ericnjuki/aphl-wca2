import { useNavigate } from 'react-router-dom';
import { useDistrictReport } from '@/hooks/reports/useReportQueries';
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

interface Props { districtId: number }

export function DistrictReport({ districtId }: Props) {
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useDistrictReport(districtId);

  if (isPending) return <ChartSkeleton />;
  if (isError) return <div className="p-6 text-sm text-destructive">Error: {(error as Error).message}</div>;

  const covered = data.items.filter((r) => r.respondents > 0 || !!r.suppressed).length;

  return (
    <div className="flex flex-col gap-4 p-4">
      {data.meta.privacy_hidden && <PrivacyHiddenNotice entity="district" />}
      <UnassignedBanner level="district" count={data.meta.unassigned_respondents} />
      <ReportKpiCards
        totalRespondents={data.meta.total_respondents}
        avgLevel={data.meta.avg_level}
        bucketsCovered={covered}
        bucketsLabel="facilities"
        hidden={data.meta.privacy_hidden}
      />
      <div className="rounded-sm border bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Facilities in {data.district.name}</h2>
          <MaturityLegend />
        </div>
        <div id="report-bar-chart" className="p-3">
          <MaturityStackedBar
            data={data.items.map((r) => ({ key: String(r.facility_id), label: archivedLabel(r.facility_name, r.archived), ...r }))}
            onBarClick={(key) => navigate(`${baseUrl}reports/facilities/${key}`)}
            emptyText="No facilities in this district"
          />
        </div>
      </div>
      <MaturityBreakdownTable
        rows={data.items.map((r) => ({ key: String(r.facility_id), label: archivedLabel(r.facility_name, r.archived), ...r }))}
        onRowClick={(key) => navigate(`${baseUrl}reports/facilities/${key}`)}
        labelHeader="Facility"
      />
    </div>
  );
}
