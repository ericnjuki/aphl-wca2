import { useIndividualReport } from '@/hooks/reports/useReportQueries';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MATURITY } from '@/lib/reports/maturity';
import type { MaturityLevel } from '@/types/reports';
import { MaturityLegend } from '../MaturityLegend';
import { MaturityBreakdownTable } from '../MaturityBreakdownTable';
import { ChartSkeleton } from '../ChartSkeleton';
import { CompetencyRadarChart } from '../charts/CompetencyRadarChart';

interface Props { userId: number }

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

export function IndividualReport({ userId }: Props) {
  const { data, isPending, isError, error } = useIndividualReport(userId);

  if (isPending) return <ChartSkeleton />;
  if (isError) return <div className="p-6 text-sm text-destructive">Error: {(error as Error).message}</div>;

  const fullName = `${data.user.first_name} ${data.user.last_name}`;

  // Strengths = competencies with avg ≥ 3 (proficient+).
  // Gaps     = competencies with avg ≤ 2 (beginner/competent) where answered.
  const strengths = data.items
    .filter((i) => (i.avg_level ?? 0) >= 3)
    .sort((a, b) => (b.avg_level ?? 0) - (a.avg_level ?? 0))
    .slice(0, 3);
  const gaps = data.items
    .filter((i) => i.avg_level != null && i.avg_level <= 2)
    .sort((a, b) => (a.avg_level ?? 0) - (b.avg_level ?? 0))
    .slice(0, 3);

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card className="rounded-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div>
            <div className="text-lg font-semibold">{fullName}</div>
            <div className="text-xs text-muted-foreground">
              {[data.user.title_name, data.user.department_name, data.user.facility_name].filter(Boolean).join(' · ')}
            </div>
            <div className="text-xs text-muted-foreground">{data.user.email}</div>
          </div>
          <MaturityLegend />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card className="rounded-sm">
          <CardContent className="py-3">
            <div className="text-sm font-semibold">Competency radar</div>
            <div id="report-radar-chart" className="mt-2">
              <CompetencyRadarChart
                data={data.items.map((i) => ({
                  competency: i.competency_text ?? i.competency_value,
                  avg: i.avg_level,
                }))}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">
          <Card className="rounded-sm">
            <CardContent className="py-3">
              <div className="text-sm font-semibold">Strengths</div>
              {strengths.length === 0 ? (
                <div className="mt-2 text-xs text-muted-foreground">No proficient/expert areas yet.</div>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {strengths.map((s) => (
                    <li key={s.competency_value} className="flex items-center justify-between gap-2">
                      <span className="truncate">{s.competency_text ?? s.competency_value}</span>
                      <Badge variant="secondary">{(s.avg_level ?? 0).toFixed(1)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card className="rounded-sm">
            <CardContent className="py-3">
              <div className="text-sm font-semibold">Growth areas</div>
              {gaps.length === 0 ? (
                <div className="mt-2 text-xs text-muted-foreground">No gaps in answered areas.</div>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {gaps.map((g) => (
                    <li key={g.competency_value} className="flex items-center justify-between gap-2">
                      <span className="truncate">{g.competency_text ?? g.competency_value}</span>
                      <Badge variant="destructive">{(g.avg_level ?? 0).toFixed(1)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="rounded-sm border bg-background">
        <div className="border-b px-3 py-2 text-sm font-semibold">By competency</div>
        <MaturityBreakdownTable
          rows={data.items.map((i) => ({
            key: i.competency_value,
            label: i.competency_text ?? i.competency_value,
            ...i,
          }))}
          labelHeader="Competency"
        />
      </div>

      <div className="rounded-sm border bg-background">
        <div className="border-b px-3 py-2 text-sm font-semibold">Detail by subcompetency</div>
        <div className="max-h-[460px] overflow-auto">
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
              {data.subcompetencies.map((s, i) => (
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
      </div>
    </div>
  );
}
