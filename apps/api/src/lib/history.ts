import { query } from '../db/database';
import { createError } from '../middleware/errorHandler';
import { responseHistory, userHistory } from './workbook/setup-snapshot';

// ── Delete guard ──────────────────────────────────────────────────────────────
// Foreign keys are off, so a hard delete of an entity with history would orphan
// it. Same definition of "history" as the setup workbook planner: a response
// row (regions … departments) or any user, enabled or not (org roles, titles).

export type HistoryTable = 'regions' | 'districts' | 'facilities' | 'departments' | 'org_roles' | 'user_titles';

const HISTORY: Record<HistoryTable, { sql: string; assigned: boolean }> = {
  regions:     { sql: responseHistory('region_id'),     assigned: false },
  districts:   { sql: responseHistory('district_id'),   assigned: false },
  facilities:  { sql: responseHistory('facility_id'),   assigned: false },
  departments: { sql: responseHistory('department_id'), assigned: false },
  org_roles:   { sql: userHistory('org_role_id'),       assigned: true },
  user_titles: { sql: userHistory('title_id'),          assigned: true },
};

/** 409 message when the row has history, otherwise null. */
export function historyBlock(table: HistoryTable, id: number): string | null {
  const [row] = query<{ name: string; has_history: number }>(
    `SELECT t.name, (${HISTORY[table].sql}) AS has_history FROM ${table} t WHERE t.id = ?`, [id],
  );
  if (!row || Number(row.has_history) === 0) return null;
  return HISTORY[table].assigned
    ? `${row.name} is still assigned to users — remove it from the country setup workbook to archive it instead`
    : `${row.name} has past assessment data — remove it from the country setup workbook to archive it instead`;
}

export function assertNoHistory(table: HistoryTable, id: number): void {
  const blocked = historyBlock(table, id);
  if (blocked) throw createError(blocked, 409);
}
