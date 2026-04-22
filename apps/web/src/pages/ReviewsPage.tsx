import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, ListChecks, Search } from 'lucide-react';
import { toast } from 'sonner';

import { ContentLayout } from '@/components/admin-panel/content-layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { TableFillerRow } from '@/components/ui/table-filler';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Empty, EmptyDescription, EmptyHeader, EmptyTitle,
} from '@/components/ui/empty';
import { api } from '@/lib/api';
import { formatAvgLevel } from '@/lib/reports/maturity';

interface ReviewRow {
  id: number;                 // user_assessment id
  user_id: number;
  full_name: string;
  facility_name: string | null;
  department_name: string | null;
  domain_code: string;
  domain_name: string;
  avg_level: number | null;
  completed_at: string | null;
  review_status: 'pending' | 'approved' | 'rejected';
}

function ReviewsPage() {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['admin', 'reviews', 'pending'],
    queryFn: async () => {
      const res = await api.get<{ reviews: ReviewRow[] }>('/admin/reviews?status=pending');
      if (res.error !== null) throw new Error(res.error);
      return res.data.reviews;
    },
    staleTime: 60_000,
  });

  const [decision, setDecision] = useState<
    | { kind: 'approve' | 'reject'; row: ReviewRow }
    | null
  >(null);
  const [notes, setNotes] = useState('');

  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const filtered = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter((r) =>
      r.full_name.toLowerCase().includes(q) ||
      r.domain_name.toLowerCase().includes(q) ||
      r.domain_code.toLowerCase().includes(q) ||
      (r.facility_name ?? '').toLowerCase().includes(q) ||
      (r.department_name ?? '').toLowerCase().includes(q),
    );
  }, [data, searchInput]);
  const paged = useMemo(
    () => filtered.slice(page * pageSize, (page + 1) * pageSize),
    [filtered, page, pageSize],
  );
  useEffect(() => { setPage(0); }, [searchInput, data?.length]);

  const act = useMutation({
    mutationFn: async (input: { id: number; kind: 'approve' | 'reject'; notes?: string }) => {
      const res = await api.post<{ ok: true }>(
        `/admin/reviews/${input.id}/${input.kind}`,
        { notes: input.notes ?? null },
      );
      if (res.error !== null) throw new Error(res.error);
      return res.data;
    },
    onSuccess: (_d, v) => {
      toast.success(v.kind === 'approve' ? 'Submission approved' : 'Submission rejected');
      qc.invalidateQueries({ queryKey: ['admin', 'reviews'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      // The reviewed user's "My assessments" shows review_status, so their
      // page should update too — admins review their own submissions here
      // in the demo setup.
      qc.invalidateQueries({ queryKey: ['my-assessments'] });
      setDecision(null); setNotes('');
    },
    onError: (e) => toast.error(`Action failed: ${(e as Error).message}`),
  });

  const navBar = (
    <div className="flex min-h-13 max-h-13 w-full items-center gap-2 pr-2 py-2">
      <h1 className="font-bold text-sm">Reviews</h1>
      <div className="relative ml-3 w-64">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search person, domain, facility…"
          className="h-8 pl-7 text-sm"
        />
      </div>
    </div>
  );

  return (
    <ContentLayout nav={navBar}>
      <div className="flex flex-col min-h-[calc(100vh-26px-56px)] max-h-[calc(100vh-26px-56px)] w-full">
        {isPending ? (
          <div className="flex flex-col gap-3 p-4">
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
                <ListChecks className="h-8 w-8 text-muted-foreground" />
                <EmptyTitle>No submissions pending review</EmptyTitle>
                <EmptyDescription>New completed assessments land here for approval.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="text-xs uppercase tracking-wide">Person</TableHead>
                    <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide">Facility · Dept</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide">Domain</TableHead>
                    <TableHead className="w-20 text-right text-xs uppercase tracking-wide">Avg</TableHead>
                    <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide">Completed</TableHead>
                    <TableHead className="w-48 text-right text-xs uppercase tracking-wide" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No submissions match your search.
                      </TableCell>
                    </TableRow>
                  ) : paged.map((r) => (
                    <TableRow
                      key={r.id}
                      className="transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                    >
                      <TableCell className="font-medium">{r.full_name}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-xs">
                        {[r.facility_name, r.department_name].filter(Boolean).join(' · ') || '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{r.domain_name}</span>
                          <span className="text-xs font-mono text-muted-foreground">{r.domain_code}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="font-mono">{formatAvgLevel(r.avg_level)}</Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-xs">
                        {r.completed_at ? new Date(r.completed_at).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-xs"
                            onClick={() => { setDecision({ kind: 'approve', row: r }); setNotes(''); }}
                          >
                            <CheckCircle2 className="h-3 w-3" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-xs"
                            onClick={() => { setDecision({ kind: 'reject',  row: r }); setNotes(''); }}
                          >
                            <XCircle className="h-3 w-3" /> Reject
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
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
                  {filtered.length} pending{searchInput && data ? ` · filtered from ${data.length}` : ''}
                </span>
              }
            />
          </>
        )}
      </div>

      <Dialog open={decision != null} onOpenChange={(o) => { if (!o) { setDecision(null); setNotes(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision?.kind === 'approve' ? 'Approve submission' : 'Reject submission'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-sm">
            <div className="text-muted-foreground">
              {decision?.row.full_name} · {decision?.row.domain_name}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="review-notes" className="text-xs">
                Notes{decision?.kind === 'reject' && <span className="text-destructive"> *</span>}
              </Label>
              <Textarea
                id="review-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={decision?.kind === 'reject' ? 'Reason for rejection (required)' : 'Optional notes'}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDecision(null); setNotes(''); }}>Cancel</Button>
            <Button
              onClick={() => {
                if (!decision) return;
                if (decision.kind === 'reject' && !notes.trim()) {
                  toast.error('Notes are required when rejecting.');
                  return;
                }
                act.mutate({ id: decision.row.id, kind: decision.kind, notes: notes.trim() || undefined });
              }}
              disabled={act.isPending}
            >
              {decision?.kind === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ContentLayout>
  );
}

export default ReviewsPage;
