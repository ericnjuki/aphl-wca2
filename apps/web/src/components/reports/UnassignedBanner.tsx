import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ReportLevel } from '@/types/reports';

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || '/';

interface Props {
  level: ReportLevel;
  count: number;
}

const MESSAGES: Record<ReportLevel, { title: string; body: string; cta: string; to: string } | null> = {
  national: {
    title: 'respondents are not attributed to a region',
    body:  "Those users don't have a facility assigned, so their responses don't appear in any regional bucket below. Assign them to a facility to include their data in reports.",
    cta:   'Open Users',
    to:    `${baseUrl}users`,
  },
  region: {
    title: 'respondents have no facility in this region',
    body:  "These respondents report at the region level but haven't been placed in a facility. They don't roll up into the facility breakdown.",
    cta:   'Open Users',
    to:    `${baseUrl}users`,
  },
  facility: {
    title: 'respondents have no department in this facility',
    body:  "These respondents belong to the facility but haven't been placed in a department, so the department chart below won't include them.",
    cta:   'Open Users',
    to:    `${baseUrl}users`,
  },
  department: null,
  individual: null,
};

export function UnassignedBanner({ level, count }: Props) {
  if (count <= 0) return null;
  const spec = MESSAGES[level];
  if (!spec) return null;

  return (
    <Alert className="border-amber-500/40 bg-amber-500/5">
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <AlertTitle>{count} {spec.title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>{spec.body}</span>
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link to={spec.to}>{spec.cta}</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
