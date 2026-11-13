import { NoAccessNotice } from '@/components/NoAccessNotice';
import { isForbidden } from '@/lib/api';

// Error state for a report level: a 403 (outside the user's scope) is a notice, not an error.
export function ReportError({ error }: { error: unknown }) {
  if (isForbidden(error)) return <NoAccessNotice what="this report" />;
  return <div className="p-6 text-sm text-destructive">Error: {(error as Error).message}</div>;
}
