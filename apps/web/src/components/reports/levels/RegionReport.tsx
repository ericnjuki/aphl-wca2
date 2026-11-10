import { Link, useNavigate } from 'react-router-dom';
import { useRegionReport } from '@/hooks/reports/useReportQueries';
import { MaturityLegend } from '../MaturityLegend';
import { MaturityStackedBar } from '../MaturityStackedBar';
import { MaturityBreakdownTable } from '../MaturityBreakdownTable';
import { ChartSkeleton } from '../ChartSkeleton';
import { ReportKpiCards } from '../ReportKpiCards';
import { UnassignedBanner } from '../UnassignedBanner';
import { archivedLabel } from '@/lib/reports/archived';

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || '/';

interface Props { regionId: number }

export function RegionReport({ regionId }: Props) {
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useRegionReport(regionId);

  if (isPending) return <ChartSkeleton />;
  if (isError) return <div className="p-6 text-sm text-destructive">Error: {(error as Error).message}</div>;

  const covered = data.items.filter((r) => r.respondents > 0 || !!r.suppressed).length;

  return (
    <div className="flex flex-col gap-4 p-4">
      <UnassignedBanner level="region" count={data.meta.unassigned_respondents} />
      <ReportKpiCards
        totalRespondents={data.meta.total_respondents}
        avgLevel={data.meta.avg_level}
        bucketsCovered={covered}
        bucketsLabel="districts"
      />
      <div className="rounded-sm border bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Districts in {data.region.name}</h2>
          <MaturityLegend />
        </div>
        <div id="report-bar-chart" className="p-3">
          <MaturityStackedBar
            data={data.items.map((r) => ({ key: String(r.district_id), label: archivedLabel(r.district_name, r.archived), ...r }))}
            onBarClick={(key) => navigate(`${baseUrl}reports/districts/${key}`)}
            emptyText="No districts in this region"
          />
        </div>
      </div>
      <MaturityBreakdownTable
        rows={data.items.map((r) => ({ key: String(r.district_id), label: archivedLabel(r.district_name, r.archived), ...r }))}
        onRowClick={(key) => navigate(`${baseUrl}reports/districts/${key}`)}
        labelHeader="District"
      />
      {data.undistricted_facilities.length > 0 && (
        <div className="rounded-sm border bg-background">
          <div className="border-b px-3 py-2">
            <h2 className="text-sm font-semibold">Facilities without a district</h2>
            <p className="text-xs text-muted-foreground">
              Not yet counted in the district breakdown above. Assign a district in Setup › Facilities.
            </p>
          </div>
          <ul className="flex flex-col divide-y">
            {data.undistricted_facilities.map((f) => (
              <li key={f.id}>
                <Link
                  to={`${baseUrl}reports/facilities/${f.id}`}
                  className="block px-3 py-2 text-sm hover:bg-[rgba(70,130,180,0.08)]"
                >
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
