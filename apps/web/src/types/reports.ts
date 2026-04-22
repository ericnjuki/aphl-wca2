// Response shapes for /api/v1/reports — keep in sync with api/src/routes/reports.ts.

export type ReportLevel = 'national' | 'region' | 'facility' | 'department' | 'individual';

export type MaturityLevel = 0 | 1 | 2 | 3 | 4;

export interface MaturityCounts {
  respondents: number;          // distinct users contributing to this bucket
  total_responses: number;      // total response rows
  avg_level: number | null;     // average of levels 1..4 (excludes N/A); null if no answers
  count_na: number;
  count_beginner: number;
  count_competent: number;
  count_proficient: number;
  count_expert: number;
}

export interface ReportMeta {
  total_respondents: number;
  // Respondents whose org context (region / facility / department depending
  // on level) is NULL, so their data doesn't land in any bucket below.
  // Surfaced in the UI so users know why buckets look empty.
  unassigned_respondents: number;
  generated_at: string;
  filters: {
    domain_code: string | null;
    competency_value: string | null;
    approved_only: boolean;
  };
}

// Each report level returns a bucket plus counts.

export interface NationalItem extends MaturityCounts {
  region_id: number;
  region_name: string;
}
export interface NationalReportResponse {
  level: 'national';
  items: NationalItem[];
  meta: ReportMeta;
}

export interface RegionItem extends MaturityCounts {
  facility_id: number;
  facility_name: string;
}
export interface RegionReportResponse {
  level: 'region';
  region: { id: number; name: string };
  items: RegionItem[];
  meta: ReportMeta;
}

export interface FacilityItem extends MaturityCounts {
  department_id: number;
  department_name: string;
}
export interface FacilityReportResponse {
  level: 'facility';
  facility: { id: number; name: string; region_id: number | null };
  items: FacilityItem[];
  meta: ReportMeta;
}

export interface DepartmentItem extends MaturityCounts {
  user_id: number;
  full_name: string;
  user_name: string;
  title_name: string | null;
}
export interface DepartmentReportResponse {
  level: 'department';
  department: { id: number; name: string };
  items: DepartmentItem[];
  meta: ReportMeta;
}

export interface CompetencyItem extends MaturityCounts {
  competency_value: string;
  competency_text: string | null;
}
export interface SubcompetencyRow {
  domain_code: string;
  competency_value: string;
  subcompetency_value: string;
  response_level: MaturityLevel;
  response_text: string | null;
  subcompetency_text: string | null;
  competency_text: string | null;
  created_at: string;
}
export interface IndividualReportResponse {
  level: 'individual';
  user: {
    id: number;
    first_name: string;
    last_name: string;
    user_name: string;
    email: string;
    facility_name: string | null;
    department_name: string | null;
    title_name: string | null;
  };
  items: CompetencyItem[];
  subcompetencies: SubcompetencyRow[];
  meta: ReportMeta;
}

export interface ReportFilters {
  domain_code?: string;
  competency_value?: string;
  approved_only?: boolean;
}
