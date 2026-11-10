// Writes tabs in the shape the reader expects: frozen header row, shaded
// required headers, text-formatted cells (so codes like 1.10 survive Excel),
// optional dropdown validation and greyed read-only columns.

import fs from 'fs';
import path from 'path';
import * as ExcelJS from 'exceljs';
import { TabSpec } from './reader';
import { README_TAB } from './setup-format';

const REQUIRED_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } };
const READONLY_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } };
const READONLY_FONT: Partial<ExcelJS.Font> = { italic: true, color: { argb: 'FF808080' } };
const VALIDATION_ROWS = 1000;

export interface WriteTabOptions {
  /** Columns appended after the spec's, greyed and ignored on import. */
  readOnly?: string[];
  /** Column → allowed values, offered as an in-cell dropdown. */
  lists?: Record<string, readonly string[]>;
}

export function writeTab(wb: ExcelJS.Workbook, spec: TabSpec, rows: string[][], opts: WriteTabOptions = {}): ExcelJS.Worksheet {
  const readOnly = opts.readOnly ?? [];
  const headers = [...spec.columns.map((c) => c.name), ...readOnly];
  const ws = wb.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(14, h.length + 4), style: { numFmt: '@' } }));
  for (const r of rows) ws.addRow(r);

  const header = ws.getRow(1);
  header.font = { bold: true };
  spec.columns.forEach((c, i) => {
    if (c.required) header.getCell(i + 1).fill = REQUIRED_FILL;
  });

  for (const name of readOnly) {
    const col = headers.indexOf(name) + 1;
    header.getCell(col).font = { bold: true, ...READONLY_FONT };
    header.getCell(col).note = 'Written on export, ignored on import';
    for (let r = 2; r <= rows.length + 1; r++) {
      const cell = ws.getCell(r, col);
      cell.fill = READONLY_FILL;
      cell.font = READONLY_FONT;
    }
  }

  for (const [name, values] of Object.entries(opts.lists ?? {})) {
    const col = headers.indexOf(name) + 1;
    if (col === 0) continue;
    for (let r = 2; r <= Math.max(VALIDATION_ROWS, rows.length + 1); r++) {
      ws.getCell(r, col).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${values.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Invalid value',
        error: `Choose one of: ${values.join(', ')}`,
      };
    }
  }
  return ws;
}

/** The "Read me" tab: a title, then label / text rows. Ignored on import. */
export function writeReadme(wb: ExcelJS.Workbook, title: string, lines: [string, string][]): void {
  const ws = wb.addWorksheet(README_TAB);
  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 100;
  ws.addRow([title]).font = { bold: true, size: 14 };
  ws.addRow([]);
  for (const [label, text] of lines) {
    const row = ws.addRow([label, text]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }
}

/** apps/api/package.json version (same relative path from src/ and dist/). */
export function appVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
