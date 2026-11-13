import { Link, useNavigate } from 'react-router-dom';
import { useCanOpenLevel } from '@/hooks/useCanOpenLevel';
import { useOrgLabels } from '@/store/config';
import { useRegionReport } from '@/hooks/reports/useReportQueries';
import { MaturityLegend } from '../MaturityLegend';
import { MaturityStackedBar } from '../MaturityStackedBar';
import { MaturityBreakdownTable } from '../MaturityBreakdownTable';
import { ChartSkeleton } from '../ChartSkeleton';
import { ReportError } from '../ReportError';
import { ReportKpiCards } from '../ReportKpiCards';
import { UnassignedBanner } from '../UnassignedBanner';
import { archivedLabel } from '@/lib/reports/archived';

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || '/';

interface Props { regionId: number }

export function RegionReport({ regionId }: Props) {
  const navigate = useNavigate();
  const canOpen = useCanOpenLevel();
  const { region, district } = useOrgLabels();
  const openDistrict = canOpen('district') ? (key: string) => navigate(`${baseUrl}reports/districts/${key}`) : undefined;
  const { data, isPending, isError, error } = useRegionReport(regionId);

  if (isPending) return <ChartSkeleton />;
  if (isError) return <ReportError error={error} />;

  const covered = data.items.filter((r) => r.respondents > 0 || !!r.suppressed).length;

  return (
    <div className="flex flex-col gap-4 p-4">
      <UnassignedBanner level="region" count={data.meta.unassigned_respondents} />
      <ReportKpiCards
        totalRespondents={data.meta.total_respondents}
        avgLevel={data.meta.avg_level}
        bucketsCovered={covered}
        bucketsLabel={district.lowerMany}
      />
      <div className="rounded-sm border bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">{district.many} in {data.region.name}</h2>
          <MaturityLegend />
        </div>
        <div id="report-bar-chart" className="p-3">
          <MaturityStackedBar
            data={data.items.map((r) => ({ key: String(r.district_id), label: archivedLabel(r.district_name, r.archived), ...r }))}
            onBarClick={openDistrict}
            emptyText={`No ${district.lowerMany} in this ${region.lower}`}
          />
        </div>
      </div>
      <MaturityBreakdownTable
        rows={data.items.map((r) => ({ key: String(r.district_id), label: archivedLabel(r.district_name, r.archived), ...r }))}
        onRowClick={openDistrict}
        labelHeader={district.one}
      />
      {data.undistricted_facilities.length > 0 && (
        <div className="rounded-sm border bg-background">
          <div className="border-b px-3 py-2">
            <h2 className="text-sm font-semibold">Facilities without a {district.lower}</h2>
            <p className="text-xs text-muted-foreground">
              Not yet counted in the {district.lower} breakdown above. Assign a {district.lower} in Setup › Facilities.
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
