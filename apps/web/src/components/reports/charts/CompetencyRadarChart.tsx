import {
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip,
} from 'recharts';

interface Point {
  competency: string;
  avg: number | null;
}

interface Props {
  data: Point[];
  height?: number;
}

// Single-series radar across the user's competencies — averages scale 0..4.
// Missing averages display as 0.
//
// Colour notes:
// - Original code used `hsl(var(--primary))`, a Tailwind-v3 convention. This
//   project is on Tailwind v4 where the var is `--color-primary` and holds
//   a full hex already (no hsl() wrapper), so the original expression parsed
//   to an invalid colour and Recharts fell back to black — barely visible
//   against the dark background.
// - We use the theme's chart-2 token, which is tuned for visibility in both
//   light (#2684ff) and dark (#5b9bd5) themes, and bump the fill opacity.
export function CompetencyRadarChart({ data, height = 360 }: Props) {
  const points = data.map((d) => ({
    competency: d.competency.length > 22 ? d.competency.slice(0, 22) + '…' : d.competency,
    avg: d.avg ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={points}>
        <PolarGrid className="stroke-border" />
        <PolarAngleAxis
          dataKey="competency"
          tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
        />
        <PolarRadiusAxis
          domain={[0, 4]}
          tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
        />
        <Radar
          dataKey="avg"
          stroke="var(--color-chart-2)"
          fill="var(--color-chart-2)"
          fillOpacity={0.5}
          strokeWidth={2}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            backgroundColor: 'var(--color-popover)',
            color: 'var(--color-popover-foreground)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
          }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
