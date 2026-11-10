// Assessment catalogue workbook — mounted by assessments.ts under
// /assessments/catalogue (auth + password-change guards are applied there).

import { Router, Request, Response, NextFunction } from 'express';
import { requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { xlsxBody, workbookBody, sendWorkbook } from '../lib/workbook/http';
import {
  readCatalogueWorkbook, loadCatalogueSnapshot, planCatalogueImport, applyCatalogueOps, writeCatalogueWorkbook,
} from '../lib/workbook/catalogue';

const router = Router();

router.get('/export', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    sendWorkbook(res, await writeCatalogueWorkbook(loadCatalogueSnapshot()), 'assessment-catalogue.xlsx');
  } catch (err) { next(err); }
});

router.post('/import/preview', requireAdmin, xlsxBody, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = await readCatalogueWorkbook(workbookBody(req));
    const { plan } = planCatalogueImport(parsed, loadCatalogueSnapshot());
    res.json({ plan });
  } catch (err) { next(err); }
});

router.post('/import/apply', requireAdmin, xlsxBody, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fingerprint = typeof req.query.fingerprint === 'string' ? req.query.fingerprint : '';
    if (!fingerprint) return next(createError('fingerprint is required — preview the workbook first', 400));
    const parsed = await readCatalogueWorkbook(workbookBody(req));
    // Nothing below awaits: the re-check and the write happen in one synchronous run.
    const { plan, ops } = planCatalogueImport(parsed, loadCatalogueSnapshot());
    if (plan.fingerprint !== fingerprint) {
      return next(createError('The catalogue changed since the preview — preview the workbook again', 409));
    }
    if (!plan.canApply) return next(createError('The workbook has errors — fix them and preview again', 422));
    applyCatalogueOps(ops);
    res.json({ plan, credentials: [] });
  } catch (err) { next(err); }
});

export default router;
