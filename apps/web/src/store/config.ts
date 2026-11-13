import { create } from 'zustand';
import { api } from '@/lib/api';

// Per-deployment display names for the two org levels above facilities
// (e.g. County / Sub-county). Identifiers in URLs, code and the API (region,
// district) never change; only human-facing text does. Loaded once at startup
// from the public GET /config; the defaults show until then.

interface LevelLabel { singular: string; plural: string }

export interface OrgLabels {
  level1: LevelLabel;
  level2: LevelLabel;
}

export const DEFAULT_LABELS: OrgLabels = {
  level1: { singular: 'Region', plural: 'Regions' },
  level2: { singular: 'District', plural: 'Districts' },
};

interface ConfigState {
  labels: OrgLabels;
  loadConfig: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
  labels: DEFAULT_LABELS,
  loadConfig: async () => {
    const res = await api.get<{ labels: OrgLabels }>('/config');
    if (res.error === null && res.data.labels) set({ labels: res.data.labels });
  },
}));

function forms(l: LevelLabel) {
  return {
    one: l.singular,                 // "County"
    many: l.plural,                  // "Counties"
    lower: l.singular.toLowerCase(), // "county"
    lowerMany: l.plural.toLowerCase(),
  };
}

export type LabelForms = ReturnType<typeof forms>;

/** Region / district display names in their usual forms. */
export function useOrgLabels(): { region: LabelForms; district: LabelForms } {
  const labels = useConfigStore((s) => s.labels);
  return { region: forms(labels.level1), district: forms(labels.level2) };
}
