// The import plan returned by every workbook preview (country setup and
// catalogue). Spec §3 "Plan shape"; `counts.disabled` is added for Users.

import crypto from 'crypto';
import type { RowError } from './reader';

export type { RowError } from './reader';

export type ChangeKind = 'add' | 'update' | 'restore' | 'archive' | 'delete' | 'disable';

export interface FieldChange { field: string; from: unknown; to: unknown }

export interface Change {
  row: number | null;          // spreadsheet row; null for rows the workbook no longer has
  key: string;
  kind: ChangeKind;
  fields?: FieldChange[];
}

export interface TabCounts {
  added: number; updated: number; restored: number; archived: number;
  deleted: number; disabled: number; unchanged: number;
}

export interface TabPlan {
  tab: string;
  present: boolean;            // false → tab absent, no changes
  counts: TabCounts;
  changes: Change[];
  errors: RowError[];          // row 0 = not tied to one spreadsheet row
  warnings: string[];
}

export interface ImportPlan {
  fingerprint: string;         // sha256 of the canonical change list
  tabs: TabPlan[];
  canApply: boolean;           // false when any error exists
  confirmations: { archived: number; deleted: number; disabledUsers: number };
}

const COUNT_KEY: Record<ChangeKind, keyof TabCounts> = {
  add: 'added', update: 'updated', restore: 'restored', archive: 'archived', delete: 'deleted', disable: 'disabled',
};

export function newTab(tab: string, present: boolean): TabPlan {
  return {
    tab,
    present,
    counts: { added: 0, updated: 0, restored: 0, archived: 0, deleted: 0, disabled: 0, unchanged: 0 },
    changes: [],
    errors: [],
    warnings: [],
  };
}

/** Fields whose values differ ('' stands for empty on both sides). */
export function diffFields(
  from: Record<string, string>,
  to: Record<string, string>,
  fields: readonly string[],
): FieldChange[] {
  return fields
    .filter((f) => (from[f] ?? '') !== (to[f] ?? ''))
    .map((f) => ({ field: f, from: from[f] ?? '', to: to[f] ?? '' }));
}

export function fingerprintOf(tabs: TabPlan[]): string {
  const canonical = tabs.map((t) => ({ tab: t.tab, present: t.present, changes: t.changes }));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Counts from the change lists, errors sorted by row, fingerprint and totals. */
export function finalisePlan(tabs: TabPlan[]): ImportPlan {
  for (const t of tabs) {
    const unchanged = t.counts.unchanged;
    t.counts = { ...newTab(t.tab, t.present).counts, unchanged };
    for (const c of t.changes) t.counts[COUNT_KEY[c.kind]]++;
    t.errors.sort((a, b) => a.row - b.row);
  }
  const all = tabs.flatMap((t) => t.changes);
  return {
    fingerprint: fingerprintOf(tabs),
    tabs,
    canApply: tabs.every((t) => t.errors.length === 0),
    confirmations: {
      archived: all.filter((c) => c.kind === 'archive').length,
      deleted: all.filter((c) => c.kind === 'delete').length,
      disabledUsers: all.filter((c) => c.kind === 'disable').length,
    },
  };
}
