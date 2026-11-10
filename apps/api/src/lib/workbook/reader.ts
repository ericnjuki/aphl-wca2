// Reads worksheets into typed rows. Generic over a tab spec: header names are
// matched case-insensitively, unknown columns are ignored, blank rows skipped,
// and row numbers are spreadsheet row numbers (header = row 1).

import * as ExcelJS from 'exceljs';
import { cellText } from './xlsx';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ColumnSpec { name: string; required: boolean }
export interface TabSpec { name: string; columns: ColumnSpec[] }
export interface RowError { row: number; column: string | null; message: string }
export interface SheetRow { row: number; values: Record<string, string> }
export interface ParsedTab {
  /** false when a required column is missing — no rows are read then. */
  headerOk: boolean;
  rows: SheetRow[];
  errors: RowError[];
  /** Spreadsheet rows that already carry an error (e.g. an empty required cell). */
  badRows: Set<number>;
}

export const req = (name: string): ColumnSpec => ({ name, required: true });
export const opt = (name: string): ColumnSpec => ({ name, required: false });

const norm = (s: string) => s.trim().toLowerCase();

// ── Reading ───────────────────────────────────────────────────────────────────

export function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  return wb.worksheets.find((ws) => norm(ws.name) === norm(name));
}

export function readTab(ws: ExcelJS.Worksheet, spec: TabSpec): ParsedTab {
  const errors: RowError[] = [];
  const badRows = new Set<number>();

  const colIndex = new Map<string, number>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const header = norm(cellText(cell.value));
    if (header && !colIndex.has(header)) colIndex.set(header, col);
  });

  const missing = spec.columns.filter((c) => c.required && !colIndex.has(c.name));
  if (missing.length) {
    for (const c of missing) errors.push({ row: 1, column: c.name, message: `Missing required column "${c.name}"` });
    return { headerOk: false, rows: [], errors, badRows };
  }

  const rows: SheetRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: Record<string, string> = {};
    for (const c of spec.columns) {
      const idx = colIndex.get(c.name);
      values[c.name] = idx === undefined ? '' : cellText(row.getCell(idx).value);
    }
    if (Object.values(values).every((v) => v === '')) return; // blank row
    for (const c of spec.columns) {
      if (c.required && values[c.name] === '') {
        errors.push({ row: rowNumber, column: c.name, message: `${c.name} is required` });
        badRows.add(rowNumber);
      }
    }
    rows.push({ row: rowNumber, values });
  });
  return { headerOk: true, rows, errors, badRows };
}

/** Every spec'd tab, or null when the workbook has no such tab. */
export function readTabs(wb: ExcelJS.Workbook, specs: TabSpec[]): Record<string, ParsedTab | null> {
  const out: Record<string, ParsedTab | null> = {};
  for (const spec of specs) {
    const ws = findSheet(wb, spec.name);
    out[spec.name] = ws ? readTab(ws, spec) : null;
  }
  return out;
}

/** `;`-separated list → trimmed, non-empty entries. */
export function splitList(value: string): string[] {
  return value.split(';').map((v) => v.trim()).filter(Boolean);
}
