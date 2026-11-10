// Low-level .xlsx helpers shared by the workbook import/export modules.
// Uploaded workbooks are parsed on the server with ExcelJS; nothing here
// knows about tabs or columns.

import * as ExcelJS from 'exceljs';
import { createError } from '../../middleware/errorHandler';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;

// ExcelJS declares its own Buffer type; accept whatever `load` takes.
type XlsxInput = Parameters<ExcelJS.Workbook['xlsx']['load']>[0];

/** Parse an uploaded workbook. Anything that is not a readable .xlsx is a 400. */
export async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as XlsxInput);
  } catch {
    throw createError('The file is not a valid .xlsx workbook', 400);
  }
  return wb;
}

export async function workbookToBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * A cell's value as trimmed text: rich text is flattened, hyperlinks give
 * their text, formulas their cached result, dates their ISO day; empty → ''.
 */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const obj = value as unknown as Record<string, unknown>;
  if (Array.isArray(obj.richText)) {
    return (obj.richText as { text?: string }[]).map((r) => r.text ?? '').join('').trim();
  }
  if (typeof obj.text === 'string') return obj.text.trim();
  if ('result' in obj) return cellText(obj.result as ExcelJS.CellValue);
  return '';
}
