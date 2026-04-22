import { TableCell, TableRow } from "@/components/ui/table";

/**
 * Put this as the last child of <TableBody>. It renders an invisible row
 * with h-full so the surrounding <table> (itself h-full via shadcn's
 * wrapper) fills the remaining vertical space of its flex parent —
 * the empty area below the last data row no longer looks like dead space.
 *
 * Skip rendering when the body has no data rows (empty state renders its
 * own full-height cell already).
 */
export function TableFillerRow({ colSpan, show = true }: { colSpan: number; show?: boolean }) {
  if (!show) return null;
  return (
    <TableRow
      aria-hidden
      className="h-full hover:bg-transparent border-0"
    >
      <TableCell colSpan={colSpan} className="border-0 p-0" />
    </TableRow>
  );
}
