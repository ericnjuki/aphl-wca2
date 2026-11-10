// Request/response plumbing for routes that take or return a raw .xlsx body.

import express, { Request, Response } from 'express';
import { createError } from '../../middleware/errorHandler';
import { XLSX_MIME, MAX_WORKBOOK_BYTES } from './xlsx';

/** Route-level body parser: the raw workbook as a Buffer (413 above 10 MB). */
export const xlsxBody = express.raw({ type: XLSX_MIME, limit: MAX_WORKBOOK_BYTES });

export function workbookBody(req: Request): Buffer {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw createError(`Upload an .xlsx workbook (Content-Type: ${XLSX_MIME})`, 415);
  }
  return req.body;
}

export function sendWorkbook(res: Response, buffer: Buffer, filename: string): void {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}
