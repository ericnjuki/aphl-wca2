import { useNavigate, Link, useMatches } from 'react-router-dom';
import { ChevronRight, RotateCcw, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';

import { DomainSelect } from '@/components/filters/DomainSelect';
import { CompetencySelect } from '@/components/filters/CompetencySelect';
import { useReportsFiltersStore } from '@/store/reports-filters';
import { useAuthStore } from '@/store/auth';
import type { ReportLevel } from '@/types/reports';

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || '/';

interface Crumb { label: string; to?: string }

interface Props {
  level: ReportLevel;
  crumbs?: Crumb[];
  rightSlot?: React.ReactNode;
}

export function ReportFilterBar({ level, crumbs = [], rightSlot }: Props) {
  const { domainCode, competencyValue, approvedOnly, setDomain, setCompetency, setApprovedOnly, reset } =
    useReportsFiltersStore();
  const navigate = useNavigate();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  // Suppress unused-var warning for useMatches import (kept for future breadcrumb auto-build)
  useMatches;

  return (
    <div className="flex flex-col gap-2 border-b bg-background px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to={`${baseUrl}reports`}>Reports</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {crumbs.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <BreadcrumbSeparator><ChevronRight className="h-3 w-3" /></BreadcrumbSeparator>
                <BreadcrumbItem>
                  {c.to ? (
                    <BreadcrumbLink asChild><Link to={c.to}>{c.label}</Link></BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{c.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </div>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex items-center gap-2">{rightSlot}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DomainSelect value={domainCode} onChange={setDomain} />
        <CompetencySelect domainCode={domainCode} value={competencyValue} onChange={setCompetency} />

        <div className="flex items-center gap-2 pl-2">
          <Switch
            id="approved-only"
            checked={approvedOnly}
            onCheckedChange={setApprovedOnly}
          />
          <Label htmlFor="approved-only" className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="h-3 w-3" />
            Approved only
          </Label>
        </div>

        <div className="flex-1" />

        {level !== 'national' && isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`${baseUrl}reports`)}
            className="h-8 text-xs"
          >
            Back to national
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset filters</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
