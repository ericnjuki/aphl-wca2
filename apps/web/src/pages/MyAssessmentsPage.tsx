import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ClipboardList, PlayCircle, Search } from 'lucide-react';

import { ContentLayout } from '@/components/admin-panel/content-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { TableFillerRow } from '@/components/ui/table-filler';
import {
  Empty, EmptyDescription, EmptyHeader, EmptyTitle,
} from '@/components/ui/empty';
import { api } from '@/lib/api';
import { formatAvgLevel } from '@/lib/reports/maturity';
import { useAuthStore } from '@/store/auth';

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || '/';

interface MyAssessment {
  id: number;
  domain_code: string;
  domain_name: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  score: number | null;
  avg_level: number | null;
  review_status: 'pending' | 'approved' | 'rejected';
  started_at: string;
  completed_at: string | null;
}

function statusBadge(status: MyAssessment['status']) {
  const cls =
    status === 'completed'   ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
    : status === 'in_progress' ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
    : 'border-muted-foreground/30 bg-muted/40 text-muted-foreground';
  return (
    <Badge variant="outline" className={`whitespace-nowrap text-[10px] uppercase ${cls}`}>
      {status.replace('_', ' ')}
    </Badge>
  );
}

function reviewBadge(s: MyAssessment['review_status']) {
  switch (s) {
    case 'approved':
      return (
        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-[10px] uppercase">
          Approved
        </Badge>
      );
    case 'rejected':
      return (
        <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive text-[10px] uppercase">
          Rejected
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[10px] uppercase">
          Pending
        </Badge>
      );
  }
}

function MyAssessmentsPage() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['my-assessments'],
    queryFn: async () => {
      const res = await api.get<{ assessments: MyAssessment[] }>('/my-assessments');
      if (res.error !== null) throw new Error(res.error);
      return res.data.assessments;
    },
    staleTime: 5_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const q = searchInput.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) =>
      a.domain_name.toLowerCase().includes(q) ||
      a.domain_code.toLowerCase().includes(q) ||
      a.status.toLowerCase().includes(q) ||
      a.review_status.toLowerCase().includes(q),
    );
  }, [data, searchInput]);
  const paged = useMemo(
    () => filtered.slice(page * pageSize, (page + 1) * pageSize),
    [filtered, page, pageSize],
  );
  useEffect(() => { setPage(0); }, [searchInput, data?.length]);

  const navBar = (
    <div className="flex min-h-13 max-h-13 w-full items-center gap-2 pr-2 py-2">
      <h1 className="font-bold text-sm">My assessments</h1>
      <div className="relative ml-3 w-64">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search domain or status…"
          className="h-8 pl-7 text-sm"
        />
      </div>
    </div>
  );

  return (
    <ContentLayout nav={navBar}>
      <div className="flex flex-col w-full min-h-[calc(100vh-26px-56px)] max-h-[calc(100vh-26px-56px)]">
        {isPending ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-10 rounded-sm" />
            <Skeleton className="h-10 rounded-sm" />
            <Skeleton className="h-10 rounded-sm" />
          </div>
        ) : isError ? (
          <div className="p-4 text-sm text-destructive">Error: {(error as Error).message}</div>
        ) : filtered.length === 0 && !searchInput ? (
          <div className="p-4">
            <Empty>
              <EmptyHeader>
                <ClipboardList className="h-8 w-8 text-muted-foreground" />
                <EmptyTitle>No assessments yet</EmptyTitle>
                <EmptyDescription>
                  Head to Survey to start your first competency assessment.
                </EmptyDescription>
              </EmptyHeader>
              <Button asChild className="mt-4">
                <Link to={baseUrl}>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Start a survey
                </Link>
              </Button>
            </Empty>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="text-xs uppercase tracking-wide">Domain</TableHead>
                    <TableHead className="w-28 text-xs uppercase tracking-wide">Status</TableHead>
                    <TableHead className="w-28 text-xs uppercase tracking-wide">Review</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide">Date</TableHead>
                    <TableHead className="w-16 text-right text-xs uppercase tracking-wide">Avg</TableHead>
                    <TableHead className="w-32 text-right text-xs uppercase tracking-wide" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No assessments match your search.
                      </TableCell>
                    </TableRow>
                  ) : paged.map((a) => {
                    const isCompleted = a.status === 'completed';
                    const isInProgress = a.status === 'in_progress';
                    return (
                      <TableRow
                        key={a.id}
                        className="transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                      >
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{a.domain_name}</span>
                            <span className="text-xs font-mono text-muted-foreground">{a.domain_code}</span>
                          </div>
                        </TableCell>
                        <TableCell>{statusBadge(a.status)}</TableCell>
                        <TableCell>{isCompleted ? reviewBadge(a.review_status) : <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {isCompleted && a.completed_at
                            ? `Completed ${new Date(a.completed_at).toLocaleDateString()}`
                            : `Started ${new Date(a.started_at).toLocaleDateString()}`}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {isCompleted ? formatAvgLevel(a.avg_level) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          {isInProgress ? (
                            <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                              <Link to={`${baseUrl}?domain=${encodeURIComponent(a.domain_code)}&resume=1`}>
                                Resume
                              </Link>
                            </Button>
                          ) : isCompleted && userId != null ? (
                            <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                              <Link to={`${baseUrl}reports/users/${userId}?assessment=${a.id}`}>
                                View detail
                              </Link>
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableFillerRow colSpan={6} show={paged.length > 0} />
                </TableBody>
              </Table>
            </div>
            <TablePagination
              page={page}
              pageSize={pageSize}
              total={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              leftSlot={
                <span className="text-muted-foreground">
                  {filtered.length} assessment{filtered.length === 1 ? '' : 's'}
                  {searchInput && data ? ` · filtered from ${data.length}` : ''}
                </span>
              }
            />
          </>
        )}
      </div>
    </ContentLayout>
  );
}

export default MyAssessmentsPage;
