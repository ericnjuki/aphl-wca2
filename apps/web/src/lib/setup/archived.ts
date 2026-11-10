// Setup tables show active rows by default; "Show archived" adds the rest.
// The active-only list keeps the plain query key, which the pickers share.

export function listPath(path: string, includeArchived: boolean): string {
  return includeArchived ? `${path}?include_archived=1` : path;
}

export function listKey(base: string[], includeArchived: boolean): string[] {
  return includeArchived ? [...base, "with-archived"] : base;
}

export function isArchived(row: { archived_at?: string | null }): boolean {
  return Boolean(row.archived_at);
}

// Archived rows are read-only: the workbook import is the way back.
export const ARCHIVED_HINT = "Restore it by including it in the country setup workbook";
