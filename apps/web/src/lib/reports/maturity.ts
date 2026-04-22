// Maturity level constants — shared across every report view.
// Colours match the old WCA project's legend so returning users don't
// have to relearn the mapping.

import type { MaturityLevel, MaturityCounts } from '@/types/reports';

export const MATURITY_LEVELS: MaturityLevel[] = [1, 2, 3, 4];

export const MATURITY = {
  0: { key: 'na',         labelKey: 'reports.maturity.na',         color: '#9CA3AF' },
  1: { key: 'beginner',   labelKey: 'reports.maturity.beginner',   color: '#DF203E' },
  2: { key: 'competent',  labelKey: 'reports.maturity.competent',  color: '#A75BF7' },
  3: { key: 'proficient', labelKey: 'reports.maturity.proficient', color: '#7CB335' },
  4: { key: 'expert',     labelKey: 'reports.maturity.expert',     color: '#59B4FD' },
} as const satisfies Record<MaturityLevel, { key: string; labelKey: string; color: string }>;

export function levelLabel(level: MaturityLevel): string {
  return MATURITY[level].key;
}

export function formatAvgLevel(avg: number | null): string {
  if (avg == null) return '—';
  return avg.toFixed(1);
}

export function countsByLevel(c: MaturityCounts): Record<MaturityLevel, number> {
  return {
    0: c.count_na,
    1: c.count_beginner,
    2: c.count_competent,
    3: c.count_proficient,
    4: c.count_expert,
  };
}
