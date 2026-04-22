// Branded PDF export using jsPDF + jspdf-autotable. Chart snapshots are
// embedded via html-to-image if a DOM selector is provided.

import jsPDF from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import { toPng } from 'html-to-image';
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
    case 'region':     return `Region · ${r.region.name}`;
    case 'facility':   return `Facility · ${r.facility.name}`;
    case 'department': return `Department · ${r.department.name}`;
    case 'individual': return `Individual · ${r.user.first_name} ${r.user.last_name}`;
  }
}

function breakdownHeadRows(r: AnyReport): { head: string[][]; body: RowInput[] } {
  const levels = ['Beg', 'Com', 'Pro', 'Exp', 'N/A'];
  switch (r.level) {
    case 'national':
      return {
        head: [['Region', 'Respondents', 'Avg', ...levels]],
        body: r.items.map((i) => [
          i.region_name, i.respondents, (i.avg_level ?? 0).toFixed(1),
          i.count_beginner, i.count_competent, i.count_proficient, i.count_expert, i.count_na,
        ]),
      };
    case 'region':
      return {
        head: [['Facility', 'Respondents', 'Avg', ...levels]],
        body: r.items.map((i) => [
          i.facility_name, i.respondents, (i.avg_level ?? 0).toFixed(1),
          i.count_beginner, i.count_competent, i.count_proficient, i.count_expert, i.count_na,
        ]),
      };
    case 'facility':
      return {
        head: [['Department', 'Respondents', 'Avg', ...levels]],
        body: r.items.map((i) => [
          i.department_name, i.respondents, (i.avg_level ?? 0).toFixed(1),
          i.count_beginner, i.count_competent, i.count_proficient, i.count_expert, i.count_na,
        ]),
      };
    case 'department':
      return {
        head: [['Person', 'Title', 'Avg', ...levels]],
        body: r.items.map((i) => [
          i.full_name, i.title_name ?? '—', (i.avg_level ?? 0).toFixed(1),
          i.count_beginner, i.count_competent, i.count_proficient, i.count_expert, i.count_na,
        ]),
      };
    case 'individual':
      return {
        head: [['Competency', 'Responses', 'Avg', ...levels]],
        body: r.items.map((i) => [
          i.competency_text ?? i.competency_value, i.total_responses,
          (i.avg_level ?? 0).toFixed(1),
          i.count_beginner, i.count_competent, i.count_proficient, i.count_expert, i.count_na,
        ]),
      };
  }
}

async function snapshot(selector: string): Promise<string | null> {
  const el = document.querySelector(selector);
  if (!el) return null;
  try {
    return await toPng(el as HTMLElement, { cacheBust: true, pixelRatio: 2 });
  } catch (e) {
    console.warn('[export-pdf] snapshot failed:', e);
    return null;
  }
}

export async function exportPdf(
  r: AnyReport,
  opts: { chartSelector?: string; userEmail?: string } = {},
): Promise<void> {
  const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(titleFor(r), 40, 40);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120);
  const metaLines: string[] = [
    `Domain: ${r.meta.filters.domain_code ?? 'All'}`,
    `Competency: ${r.meta.filters.competency_value ?? 'All'}`,
    `Approved only: ${r.meta.filters.approved_only ? 'Yes' : 'No'}`,
    `Respondents: ${r.meta.total_respondents}`,
    `Generated: ${new Date(r.meta.generated_at).toLocaleString()}${opts.userEmail ? ` · by ${opts.userEmail}` : ''}`,
  ];
  doc.text(metaLines.join('    '), 40, 58, { maxWidth: pageW - 80 });
  doc.setTextColor(0);

  let cursorY = 80;

  // Chart snapshot
  if (opts.chartSelector) {
    const img = await snapshot(opts.chartSelector);
    if (img) {
      const imgW = pageW - 80;
      const imgH = 220;
      doc.addImage(img, 'PNG', 40, cursorY, imgW, imgH, undefined, 'FAST');
      cursorY += imgH + 12;
    }
  }

  // Breakdown table
  const { head, body } = breakdownHeadRows(r);
  autoTable(doc, {
    startY: cursorY,
    head,
    body,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [40, 40, 40] },
    margin: { left: 40, right: 40 },
  });

  // Page numbers
  const total = doc.getNumberOfPages();
  doc.setFontSize(8);
  doc.setTextColor(120);
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.text(`${i} / ${total}`, pageW - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
  }

  const date = new Date().toISOString().slice(0, 10);
  doc.save(`report-${r.level}-${date}.pdf`);
}
