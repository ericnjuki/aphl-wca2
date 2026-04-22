import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface TablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  /**
   * Left-aligned slot. Put row-selection counts, total counts, or any
   * page-specific text here.
   */
  leftSlot?: ReactNode;
}

/**
 * Shared table pagination footer. Zero-indexed `page`.
 * Styling matches the reference UI from corlix — rounded-none first/prev/next/last
 * buttons that sit flush against each other, subtle top border, compact height.
 */
export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  leftSlot,
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 0;
  const canNext = page < totalPages - 1;

  if (total === 0 && !leftSlot) return null;

  return (
    <div className="flex items-center justify-between border-t border-border px-2 py-1.5 text-foreground">
      {leftSlot !== undefined && (
        <div className="cursor-default select-none text-sm">{leftSlot}</div>
      )}
      <div className="flex-1" />
      <div className="flex items-center space-x-6 lg:space-x-8">
        {onPageSizeChange && (
          <div className="flex items-center space-x-2">
            <p className="cursor-default text-sm font-medium">Rows per page</p>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                onPageSizeChange(Number(v));
                onPageChange(0);
              }}
            >
              <SelectTrigger className="h-8 w-20 rounded-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top" avoidCollisions={false} position="popper">
                {pageSizeOptions.map((s) => (
                  <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex w-25 cursor-default items-center justify-center text-sm font-medium">
          Page {page + 1} of {totalPages}
        </div>
        <div className="flex items-center">
          <Button
            variant="outline"
            className="hidden h-8 w-8 rounded-none p-0 lg:flex"
            onClick={() => onPageChange(0)}
            disabled={!canPrev}
          >
            <span className="sr-only">Go to first page</span>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 rounded-none p-0"
            onClick={() => onPageChange(page - 1)}
            disabled={!canPrev}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 rounded-none p-0"
            onClick={() => onPageChange(page + 1)}
            disabled={!canNext}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="hidden h-8 w-8 rounded-none p-0 lg:flex"
            onClick={() => onPageChange(totalPages - 1)}
            disabled={!canNext}
          >
            <span className="sr-only">Go to last page</span>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
