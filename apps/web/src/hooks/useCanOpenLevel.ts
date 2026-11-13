import { useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import { canOpenLevel } from '@/lib/reports/landing';
import type { ReportLevel } from '@/types/reports';

/** Whether the signed-in user may open a report level; drill-down links stop where this is false. */
export function useCanOpenLevel(): (level: ReportLevel) => boolean {
  const role = useAuthStore((s) => s.user?.role);
  return useCallback((level: ReportLevel) => canOpenLevel(role, level), [role]);
}
