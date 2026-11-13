import { NotAssignedNotice } from '@/components/reports/NotAssignedNotice';
import { canOpenLevel, reportsLanding } from '@/lib/reports/landing';
import { useOrgLabels } from '@/store/config';
import type { ReportLevel } from '@/types/reports';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';

import { ContentLayout } from '@/components/admin-panel/content-layout';
import { useAuthStore } from '@/store/auth';
import { ReportFilterBar } from '@/components/reports/ReportFilterBar';
import { NationalReport } from '@/components/reports/levels/NationalReport';
import { RegionReport } from '@/components/reports/levels/RegionReport';
import { DistrictReport } from '@/components/reports/levels/DistrictReport';
import { FacilityReport } from '@/components/reports/levels/FacilityReport';
import { DepartmentReport } from '@/components/reports/levels/DepartmentReport';
import { IndividualReport } from '@/components/reports/levels/IndividualReport';
import { ExportMenu } from '@/components/reports/ExportMenu';
import {
  useNationalReport,
  useRegionReport,
  useDistrictReport,
  useFacilityReport,
  useDepartmentReport,
  useIndividualReport,
} from '@/hooks/reports/useReportQueries';

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || '/';

function ReportsPage() {
  const params = useParams();
  const regionId     = params.regionId     ? Number(params.regionId)     : null;
  const districtId   = params.districtId   ? Number(params.districtId)   : null;
  const facilityId   = params.facilityId   ? Number(params.facilityId)   : null;
  const departmentId = params.departmentId ? Number(params.departmentId) : null;
  const userId       = params.userId       ? Number(params.userId)       : null;
  // Department reports are narrowed to the facility they were opened from.
  const [searchParams] = useSearchParams();
  const departmentFacilityId = searchParams.get('facility_id') ? Number(searchParams.get('facility_id')) : null;

  const level: ReportLevel =
    userId != null       ? 'individual'
    : departmentId != null ? 'department'
    : facilityId != null   ? 'facility'
    : districtId != null   ? 'district'
    : regionId != null     ? 'region'
    : 'national';

  // Only admins and national users may view the national report (enforced by
  // report-scope on the API). Everyone else is redirected to their own unit, or
  // shown a notice if they have none yet.
  const user = useAuthStore((s) => s.user);
  const { region: regionLabel, district: districtLabel } = useOrgLabels();
  const { redirect: redirectTarget, unassigned } = reportsLanding(user, level, baseUrl);

  // Fetch only the active level's data — other hooks stay disabled via null ids.
  const national   = useNationalReport(redirectTarget == null && !unassigned);
  const region     = useRegionReport(regionId);
  const district   = useDistrictReport(districtId);
  const facility   = useFacilityReport(facilityId);
  const department = useDepartmentReport(departmentId, departmentFacilityId);
  const individual = useIndividualReport(userId);

  if (redirectTarget) return <Navigate to={redirectTarget} replace />;

  // Breadcrumb bits derived from the active query. Levels the role may not open
  // (they would 403) render as plain text, not links.
  const crumbs: { label: string; to?: string }[] = [];
  const crumbTo = (crumbLevel: ReportLevel, to: string) => (canOpenLevel(user?.role, crumbLevel) ? to : undefined);
  if (level === 'region' && region.data) {
    crumbs.push({ label: region.data.region.name });
  }
  if (level === 'district' && district.data) {
    const d = district.data.district;
    crumbs.push({ label: d.region_name ?? regionLabel.one, to: crumbTo('region', `${baseUrl}reports/regions/${d.region_id}`) });
    crumbs.push({ label: d.name });
  }
  if (level === 'facility' && facility.data) {
    const fac = facility.data.facility;
    if (fac.region_id) {
      crumbs.push({ label: fac.region_name ?? regionLabel.one, to: crumbTo('region', `${baseUrl}reports/regions/${fac.region_id}`) });
    }
    if (fac.district_id) {
      crumbs.push({ label: fac.district_name ?? districtLabel.one, to: crumbTo('district', `${baseUrl}reports/districts/${fac.district_id}`) });
    }
    crumbs.push({ label: fac.name });
  }
  if (level === 'department' && department.data) {
    const fac = department.data.facility;
    if (fac) crumbs.push({ label: fac.name, to: crumbTo('facility', `${baseUrl}reports/facilities/${fac.id}`) });
    crumbs.push({ label: department.data.department.name });
  }
  if (level === 'individual' && individual.data) {
    crumbs.push({
      label: `${individual.data.user.first_name} ${individual.data.user.last_name}`,
    });
  }

  const exportPayload =
    level === 'national'   ? national.data :
    level === 'region'     ? region.data :
    level === 'district'   ? district.data :
    level === 'facility'   ? facility.data :
    level === 'department' ? department.data :
    level === 'individual' ? individual.data : null;

  return (
    <ContentLayout nav={<h1 className="font-bold">Reports</h1>}>
      <div className="flex flex-col min-h-[calc(100vh-26px-56px)] max-h-[calc(100vh-26px-56px)] w-full overflow-auto">
        <ReportFilterBar
          level={level}
          crumbs={crumbs}
          rightSlot={unassigned ? undefined : <ExportMenu level={level} payload={exportPayload} />}
        />
        <div className="flex-1">
          {level === 'national'   && !unassigned && <NationalReport />}
          {level === 'national'   && unassigned  && <NotAssignedNotice />}
          {level === 'region'     && regionId     != null && <RegionReport     regionId={regionId}     />}
          {level === 'district'   && districtId   != null && <DistrictReport   districtId={districtId}   />}
          {level === 'facility'   && facilityId   != null && <FacilityReport   facilityId={facilityId} />}
          {level === 'department' && departmentId != null && <DepartmentReport departmentId={departmentId} facilityId={departmentFacilityId} />}
          {level === 'individual' && userId       != null && <IndividualReport userId={userId} />}
        </div>
      </div>
    </ContentLayout>
  );
}

export default ReportsPage;
