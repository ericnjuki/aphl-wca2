import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useReportsFiltersStore } from '@/store/reports-filters';
import type {
  NationalReportResponse,
  RegionReportResponse,
  FacilityReportResponse,
  DepartmentReportResponse,
  IndividualReportResponse,
} from '@/types/reports';

function qs(filters: {
  domainCode: string | null;
  competencyValue: string | null;
  approvedOnly: boolean;
}): string {
  const params = new URLSearchParams();
  if (filters.domainCode)      params.set('domain_code', filters.domainCode);
  if (filters.competencyValue) params.set('competency_value', filters.competencyValue);
  if (!filters.approvedOnly)   params.set('approved_only', '0');
  const s = params.toString();
  return s ? `?${s}` : '';
}

// Zustand v5: selectors must return a stable reference. Returning a fresh
// object `{...}` on every call triggers React's "getSnapshot should be cached"
// error, which surfaces as "Maximum update depth exceeded".
// Select each primitive separately so every call yields a stable value.
function useFilters() {
  const domainCode      = useReportsFiltersStore((s) => s.domainCode);
  const competencyValue = useReportsFiltersStore((s) => s.competencyValue);
  const approvedOnly    = useReportsFiltersStore((s) => s.approvedOnly);
  return { domainCode, competencyValue, approvedOnly };
}

const FIVE_MINUTES = 5 * 60 * 1000;

export function useNationalReport(enabled: boolean = true) {
  const filters = useFilters();
  return useQuery({
    queryKey: ['reports', 'national', filters],
    enabled,
    queryFn: async () => {
      const res = await api.get<NationalReportResponse>(`/reports/national${qs(filters)}`);
      if (res.error !== null) throw new Error(res.error);
      return res.data;
    },
    staleTime: FIVE_MINUTES,
  });
}

export function useRegionReport(regionId: number | null) {
  const filters = useFilters();
  return useQuery({
    queryKey: ['reports', 'region', regionId, filters],
    enabled: regionId != null,
    queryFn: async () => {
      const res = await api.get<RegionReportResponse>(`/reports/regions/${regionId}${qs(filters)}`);
      if (res.error !== null) throw new Error(res.error);
      return res.data;
    },
    staleTime: FIVE_MINUTES,
  });
}

export function useFacilityReport(facilityId: number | null) {
  const filters = useFilters();
  return useQuery({
    queryKey: ['reports', 'facility', facilityId, filters],
    enabled: facilityId != null,
    queryFn: async () => {
      const res = await api.get<FacilityReportResponse>(`/reports/facilities/${facilityId}${qs(filters)}`);
      if (res.error !== null) throw new Error(res.error);
      return res.data;
    },
    staleTime: FIVE_MINUTES,
  });
}

export function useDepartmentReport(departmentId: number | null) {
  const filters = useFilters();
  return useQuery({
    queryKey: ['reports', 'department', departmentId, filters],
    enabled: departmentId != null,
    queryFn: async () => {
      const res = await api.get<DepartmentReportResponse>(`/reports/departments/${departmentId}${qs(filters)}`);
      if (res.error !== null) throw new Error(res.error);
      return res.data;
    },
    staleTime: FIVE_MINUTES,
  });
}

export function useIndividualReport(userId: number | null) {
  const filters = useFilters();
  return useQuery({
    queryKey: ['reports', 'user', userId, filters],
    enabled: userId != null,
    queryFn: async () => {
      const res = await api.get<IndividualReportResponse>(`/reports/users/${userId}${qs(filters)}`);
      if (res.error !== null) throw new Error(res.error);
      return res.data;
    },
    staleTime: FIVE_MINUTES,
  });
}
