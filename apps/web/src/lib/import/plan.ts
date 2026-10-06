// Shapes and pure helpers for the workbook import preview (country setup and
// assessment catalogue). Keep in sync with apps/api/src/lib/workbook/plan.ts.

export type ChangeKind = "add" | "update" | "restore" | "archive" | "delete" | "disable";

export interface FieldChange { field: string; from: unknown; to: unknown }
export interface PlanChange { row: number | null; key: string; kind: ChangeKind; fields?: FieldChange[] }
export interface PlanError { row: number; column: string | null; message: string }
export interface TabCounts {
  added: number; updated: number; restored: number; archived: number; deleted: number; disabled: number; unchanged: number;
}
export interface TabPlan {
  tab: string;
  present: boolean;
  counts: TabCounts;
  changes: PlanChange[];
  errors: PlanError[];
  warnings: string[];
}
export interface ImportPlan {
  fingerprint: string;
  tabs: TabPlan[];
  canApply: boolean;
  confirmations: { archived: number; deleted: number; disabledUsers: number };
}
export interface ImportCredential { name: string; email: string; username: string; temp_password: string }
export interface ApplyResult { plan: ImportPlan; credentials: ImportCredential[] }

export const KIND_LABEL: Record<ChangeKind, string> = {
  add: "Add", update: "Update", restore: "Restore", archive: "Archive", delete: "Delete", disable: "Disable",
};

/** Text the API puts in every "more than half removed" warning. */
export const MAJORITY_MARKER = "usually means the wrong file";

export type Tone = "add" | "update" | "restore" | "remove";

const BADGES: { key: keyof TabCounts; label: string; tone: Tone }[] = [
  { key: "added", label: "added", tone: "add" },
  { key: "updated", label: "updated", tone: "update" },
  { key: "restored", label: "restored", tone: "restore" },
  { key: "archived", label: "archived", tone: "remove" },
  { key: "deleted", label: "deleted", tone: "remove" },
  { key: "disabled", label: "disabled", tone: "remove" },
];

export interface PlanSection {
  tab: string;
  present: boolean;
  badges: { label: string; count: number; tone: Tone }[];
  unchanged: number;
  changes: PlanChange[];
  errors: PlanError[];
  warnings: string[];
  defaultOpen: boolean;
}

const byRow = (a: PlanError, b: PlanError) => a.row - b.row;

/** One section per tab; tabs with errors first, each error list sorted by row. */
export function planSections(plan: ImportPlan): PlanSection[] {
  const sections = plan.tabs.map((t) => ({
    tab: t.tab,
    present: t.present,
    badges: BADGES.filter((b) => t.counts[b.key] > 0).map((b) => ({ label: b.label, count: t.counts[b.key], tone: b.tone })),
    unchanged: t.counts.unchanged,
    changes: t.changes,
    errors: [...t.errors].sort(byRow),
    warnings: t.warnings,
    defaultOpen: t.errors.length > 0 || t.warnings.length > 0,
  }));
  return [...sections.filter((s) => s.errors.length > 0), ...sections.filter((s) => s.errors.length === 0)];
}

export interface SheetError extends PlanError { tab: string }

/** Every error with its sheet name — pinned at the top of the preview. */
export function allErrors(plan: ImportPlan): SheetError[] {
  return plan.tabs.flatMap((t) => [...t.errors].sort(byRow).map((e) => ({ ...e, tab: t.tab })));
}

export function needsConfirmation(c: ImportPlan["confirmations"]): boolean {
  return c.archived + c.deleted + c.disabledUsers > 0;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function confirmationSentence(c: ImportPlan["confirmations"]): string {
  return `I understand this will archive ${plural(c.archived, "item", "items")}, delete ${c.deleted}, `
    + `and disable ${plural(c.disabledUsers, "user", "users")}`;
}

export function hasMajorityWarning(plan: ImportPlan): boolean {
  return plan.tabs.some((t) => t.warnings.some((w) => w.includes(MAJORITY_MARKER)));
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  return String(v);
}

/** Row 0 / null means "not a spreadsheet row" (e.g. something the workbook no longer lists). */
export function rowLabel(row: number | null): string {
  return row ? `row ${row}` : "—";
}

export function credentialRows(creds: ImportCredential[]): Record<string, string>[] {
  return creds.map((c) => ({ Name: c.name, Email: c.email, Username: c.username, "Temporary password": c.temp_password }));
}

export function applySummary(plan: ImportPlan): string {
  const total = (key: keyof TabCounts) => plan.tabs.reduce((n, t) => n + t.counts[key], 0);
  const parts = BADGES.map((b) => [b.label, total(b.key)] as const).filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`);
  return parts.length ? `Applied: ${parts.join(", ")}.` : "No changes were needed.";
}
