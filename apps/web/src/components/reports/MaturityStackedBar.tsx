import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from 'recharts';
import { MATURITY } from '@/lib/reports/maturity';
import type { MaturityCounts } from '@/types/reports';

export interface StackedBarDatum extends MaturityCounts {
  key: string;       // stable identifier for click handling
  label: string;     // bar label (region/facility/department/user name)
}

interface Props {
  data: StackedBarDatum[];
  onBarClick?: (key: string) => void;
  height?: number;
  emptyText?: string;
}

// Horizontal stacked bar: each bar is one region/facility/etc., stacked by
// maturity count. Clicking a bar fires onBarClick(key) for drill-down.
export function MaturityStackedBar({
  data,
  onBarClick,
  height = 360,
  emptyText = 'No data',
}: Props) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-sm border border-dashed text-xs text-muted-foreground"
        style={{ height }}
      >
        {emptyText}
      </div>
    );
  }

  const chartData = data.map((d) => ({
    key: d.key,
    label: d.label,
    beginner: d.count_beginner,
    competent: d.count_competent,
    proficient: d.count_proficient,
    expert: d.count_expert,
    na: d.count_na,
    respondents: d.respondents,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(height, 60 + data.length * 28)}>
      <BarChart
        layout="vertical"
        data={chartData}
        margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
        onClick={(e) => {
          const payload = e?.activePayload?.[0]?.payload as
            | { key: string }
            | undefined;
          if (payload && onBarClick) onBarClick(payload.key);
        }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-muted-foreground/20" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
        <YAxis
          type="category"
          dataKey="label"
          width={180}
          tick={{ fontSize: 12 }}
        />
        <Tooltip
          cursor={{ fill: 'transparent' }}
          contentStyle={{ fontSize: 12 }}
          formatter={(value: number, name: string) => {
            const labelMap: Record<string, string> = {
              beginner: 'Beginner',
              competent: 'Competent',
              proficient: 'Proficient',
              expert: 'Expert',
              na: 'N/A',
            };
            return [value, labelMap[name] ?? name];
          }}
        />
        <Bar dataKey="beginner"   stackId="m" fill={MATURITY[1].color} />
        <Bar dataKey="competent"  stackId="m" fill={MATURITY[2].color} />
        <Bar dataKey="proficient" stackId="m" fill={MATURITY[3].color} />
        <Bar dataKey="expert"     stackId="m" fill={MATURITY[4].color}>
          <LabelList
            dataKey="respondents"
            position="right"
            formatter={(v: number) => (v ? `${v}` : '')}
            style={{ fontSize: 11, fill: 'currentColor' }}
          />
        </Bar>
        <Bar dataKey="na"         stackId="m" fill={MATURITY[0].color} />
      </BarChart>
    </ResponsiveContainer>
  );
}
