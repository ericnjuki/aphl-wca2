import { MATURITY } from '@/lib/reports/maturity';
import type { MaturityLevel, SubcompetencyRow } from '@/types/reports';

// One submission's answers per competency/subcompetency. Shared by the
// individual report and the review detail (plans/2026-11-12-role-model.md).

export type SubcompetencyDetailRow = Pick<
  SubcompetencyRow,
  'competency_value' | 'competency_text' | 'subcompetency_value' | 'subcompetency_text' | 'response_level' | 'response_text'
>;

function levelBadge(level: MaturityLevel) {
  const spec = MATURITY[level];
  return (
    <span
      className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] font-medium text-white"
      style={{ backgroundColor: spec.color }}
    >
      {spec.key}
    </span>
  );
}

export function SubcompetencyDetailTable({ rows, className }: { rows: SubcompetencyDetailRow[]; className?: string }) {
  return (
    <div className={`overflow-auto ${className ?? 'max-h-[460px]'}`}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/30 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Competency</th>
            <th className="px-3 py-2 text-left font-medium">Subcompetency</th>
            <th className="px-3 py-2 text-left font-medium">Level</th>
            <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Response</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={i} className="border-t">
              <td className="px-3 py-1.5 text-muted-foreground">{s.competency_text ?? s.competency_value}</td>
              <td className="px-3 py-1.5">{s.subcompetency_text ?? s.subcompetency_value}</td>
              <td className="px-3 py-1.5">{levelBadge(s.response_level)}</td>
              <td className="px-3 py-1.5 text-muted-foreground hidden md:table-cell">{s.response_text ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
