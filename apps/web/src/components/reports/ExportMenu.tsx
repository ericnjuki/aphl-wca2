import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Download, FileText, Sheet as SheetIcon, FileType } from 'lucide-react';
import { toast } from 'sonner';
import { exportExcel, exportCsv } from '@/lib/reports/export-excel';
import { exportPdf } from '@/lib/reports/export-pdf';
import type {
  NationalReportResponse, RegionReportResponse, FacilityReportResponse,
  DepartmentReportResponse, IndividualReportResponse, ReportLevel,
} from '@/types/reports';

type AnyReport =
  | NationalReportResponse | RegionReportResponse | FacilityReportResponse
  | DepartmentReportResponse | IndividualReportResponse | null | undefined;

interface Props {
  level: ReportLevel;
  payload: AnyReport;
}

export function ExportMenu({ level, payload }: Props) {
  const disabled = !payload;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={disabled}>
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={async () => {
            if (!payload) return;
            const id = toast.loading('Generating PDF…');
            try {
              // level is used by exportPdf internally via payload.level, but we
              // also use it here to target a level-specific chart selector.
              const selector = level === 'individual'
                ? '#report-radar-chart'
                : '#report-bar-chart';
              await exportPdf(payload, { chartSelector: selector });
              toast.success('PDF ready', { id });
            } catch (e) {
              toast.error(`Export failed: ${(e as Error).message}`, { id });
            }
          }}
        >
          <FileText className="mr-2 h-4 w-4" />
          PDF (branded)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            if (!payload) return;
            try { exportExcel(payload); toast.success('Excel file saved'); }
            catch (e) { toast.error(`Export failed: ${(e as Error).message}`); }
          }}
        >
          <SheetIcon className="mr-2 h-4 w-4" />
          Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            if (!payload) return;
            try { exportCsv(payload); toast.success('CSV saved'); }
            catch (e) { toast.error(`Export failed: ${(e as Error).message}`); }
          }}
        >
          <FileType className="mr-2 h-4 w-4" />
          CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
