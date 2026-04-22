// Build an Excel or CSV workbook from a report response.
// Scope is intentionally narrow — 3 sheets max: Summary, Breakdown, Meta.

import * as XLSX from 'xlsx';
import type {
  NationalReportResponse,
  RegionReportResponse,
  FacilityReportResponse,
  DepartmentReportResponse,
  IndividualReportResponse,
} from '@/types/reports';

type AnyReport =
  | NationalReportResponse
  | RegionReportResponse
  | FacilityReportResponse
  | DepartmentReportResponse
  | IndividualReportResponse;

function titleFor(r: AnyReport): string {
  switch (r.level) {
    case 'national':   return 'National report';
    case 'region':     return `${r.region.name} region`;
    case 'facility':   return r.facility.name;
    case 'department': return r.department.name;
    case 'individual': return `${r.user.first_name} ${r.user.last_name}`;
  }
}

function breakdownRows(r: AnyReport): Record<string, unknown>[] {
  switch (r.level) {
    case 'national':
      return r.items.map((i) => ({
        Region: i.region_name,
        Respondents: i.respondents,
        'Avg level': i.avg_level ?? '',
        Beginner: i.count_beginner, Competent: i.count_competent,
        Proficient: i.count_proficient, Expert: i.count_expert,
        'N/A': i.count_na,
      }));
    case 'region':
      return r.items.map((i) => ({
        Facility: i.facility_name,
        Respondents: i.respondents,
        'Avg level': i.avg_level ?? '',
        Beginner: i.count_beginner, Competent: i.count_competent,
        Proficient: i.count_proficient, Expert: i.count_expert,
        'N/A': i.count_na,
      }));
    case 'facility':
      return r.items.map((i) => ({
        Department: i.department_name,
        Respondents: i.respondents,
        'Avg level': i.avg_level ?? '',
        Beginner: i.count_beginner, Competent: i.count_competent,
        Proficient: i.count_proficient, Expert: i.count_expert,
        'N/A': i.count_na,
      }));
    case 'department':
      return r.items.map((i) => ({
        Person: i.full_name, Title: i.title_name ?? '',
        Respondents: i.respondents,
        'Avg level': i.avg_level ?? '',
        Beginner: i.count_beginner, Competent: i.count_competent,
        Proficient: i.count_proficient, Expert: i.count_expert,
        'N/A': i.count_na,
      }));
    case 'individual':
      return r.items.map((i) => ({
        Competency: i.competency_text ?? i.competency_value,
        Responses: i.total_responses,
        'Avg level': i.avg_level ?? '',
        Beginner: i.count_beginner, Competent: i.count_competent,
        Proficient: i.count_proficient, Expert: i.count_expert,
        'N/A': i.count_na,
      }));
  }
}

function summaryRows(r: AnyReport): Record<string, unknown>[] {
  return [
    { Field: 'Title', Value: titleFor(r) },
    { Field: 'Level', Value: r.level },
    { Field: 'Total respondents', Value: r.meta.total_respondents },
    { Field: 'Domain filter',     Value: r.meta.filters.domain_code ?? 'All' },
    { Field: 'Competency filter', Value: r.meta.filters.competency_value ?? 'All' },
    { Field: 'Approved only',     Value: r.meta.filters.approved_only ? 'Yes' : 'No (includes pending/rejected)' },
    { Field: 'Generated at',      Value: r.meta.generated_at },
  ];
}

export function buildWorkbook(r: AnyReport): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows(r)), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(breakdownRows(r)), 'Breakdown');
  if (r.level === 'individual') {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        r.subcompetencies.map((s) => ({
          Domain: s.domain_code,
          Competency: s.competency_text ?? s.competency_value,
          Subcompetency: s.subcompetency_text ?? s.subcompetency_value,
          Level: s.response_level,
          Response: s.response_text ?? '',
        })),
      ),
      'Detail',
    );
  }
  return wb;
}

function filename(r: AnyReport, ext: 'xlsx' | 'csv'): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = titleFor(r).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `report-${r.level}-${slug}-${date}.${ext}`;
}

export function exportExcel(r: AnyReport): void {
  const wb = buildWorkbook(r);
  XLSX.writeFile(wb, filename(r, 'xlsx'));
}

export function exportCsv(r: AnyReport): void {
  const wb = buildWorkbook(r);
  // CSV is single-sheet — write only the Breakdown sheet.
  const sheet = wb.Sheets['Breakdown'];
  const csv = XLSX.utils.sheet_to_csv(sheet);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename(r, 'csv');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
