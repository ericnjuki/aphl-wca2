import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatAvgLevel } from '@/lib/reports/maturity';
import type { MaturityCounts } from '@/types/reports';
import { ChevronRight } from 'lucide-react';

export interface BreakdownRow extends MaturityCounts {
  key: string;
  label: string;
  meta?: string | null;
}

interface Props {
  rows: BreakdownRow[];
  onRowClick?: (key: string) => void;
  labelHeader?: string;
  metaHeader?: string;
  emptyText?: string;
}

export function MaturityBreakdownTable({
  rows,
  onRowClick,
  labelHeader = 'Name',
  metaHeader,
  emptyText = 'No data',
}: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-sm border border-dashed p-8 text-center text-xs text-muted-foreground">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="rounded-sm border overflow-hidden">
      <Table>
        <TableHeader className="bg-muted/30">
          <TableRow>
            <TableHead className="text-xs uppercase tracking-wide">{labelHeader}</TableHead>
            {metaHeader && <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide">{metaHeader}</TableHead>}
            <TableHead className="w-24 text-right hidden md:table-cell text-xs uppercase tracking-wide">Respondents</TableHead>
            <TableHead className="w-16 text-right hidden md:table-cell text-xs uppercase tracking-wide">Avg</TableHead>
            <TableHead className="w-14 text-right text-xs uppercase tracking-wide">Beg</TableHead>
            <TableHead className="w-14 text-right text-xs uppercase tracking-wide">Com</TableHead>
            <TableHead className="w-14 text-right text-xs uppercase tracking-wide">Pro</TableHead>
            <TableHead className="w-14 text-right text-xs uppercase tracking-wide">Exp</TableHead>
            <TableHead className="w-14 text-right hidden sm:table-cell text-xs uppercase tracking-wide">N/A</TableHead>
            {onRowClick && <TableHead className="w-8" aria-label="drill down" />}
          </TableRow>
        </TableHeader>
        <TableBody className="[&_tr:last-child]:border-b">
          {rows.map((r) => (
            <TableRow
              key={r.key}
              onClick={() => onRowClick?.(r.key)}
              className={
                onRowClick
                  ? 'cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]'
                  : 'transition-colors'
              }
            >
              <TableCell className="font-medium">{r.label}</TableCell>
              {metaHeader && <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{r.meta ?? '—'}</TableCell>}
              <TableCell className="text-right hidden md:table-cell font-mono text-xs">{r.respondents}</TableCell>
              <TableCell className="text-right hidden md:table-cell font-mono text-xs">{formatAvgLevel(r.avg_level)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{r.count_beginner}</TableCell>
              <TableCell className="text-right font-mono text-xs">{r.count_competent}</TableCell>
              <TableCell className="text-right font-mono text-xs">{r.count_proficient}</TableCell>
              <TableCell className="text-right font-mono text-xs">{r.count_expert}</TableCell>
              <TableCell className="text-right hidden sm:table-cell font-mono text-xs">{r.count_na}</TableCell>
              {onRowClick && (
                <TableCell className="text-muted-foreground">
                  <ChevronRight className="h-4 w-4" />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
