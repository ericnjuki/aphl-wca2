import { create } from 'zustand';

interface ReportsFiltersState {
  domainCode: string | null;
  competencyValue: string | null;
  approvedOnly: boolean;
  setDomain: (code: string | null) => void;
  setCompetency: (value: string | null) => void;
  setApprovedOnly: (v: boolean) => void;
  reset: () => void;
}

export const useReportsFiltersStore = create<ReportsFiltersState>((set) => ({
  domainCode: null,
  competencyValue: null,
  approvedOnly: true,
  setDomain: (code) => set({ domainCode: code, competencyValue: null }),
  setCompetency: (value) => set({ competencyValue: value }),
  setApprovedOnly: (v) => set({ approvedOnly: v }),
  reset: () => set({ domainCode: null, competencyValue: null, approvedOnly: true }),
}));
