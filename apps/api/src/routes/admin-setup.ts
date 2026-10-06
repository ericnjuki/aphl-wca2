// Country setup workbook — mounted by admin.ts under /admin/setup (auth and
// password-change guards are applied there). Spec §3.

import { Router, Request, Response, NextFunction } from 'express';
import { requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { xlsxBody, workbookBody, sendWorkbook } from '../lib/workbook/http';
import { readSetupWorkbook } from '../lib/workbook/setup-format';
import { loadSetupSnapshot } from '../lib/workbook/setup-snapshot';
import { planSetupImport } from '../lib/workbook/setup-planner';
import { applySetupOps } from '../lib/workbook/setup-apply';
import { writeSetupWorkbook } from '../lib/workbook/setup-export';

const router = Router();

// ── Export ────────────────────────────────────────────────────────────────────

router.get('/export', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    sendWorkbook(res, await writeSetupWorkbook(loadSetupSnapshot()), 'country-setup.xlsx');
  } catch (err) { next(err); }
});

// ── Import ────────────────────────────────────────────────────────────────────

router.post('/import/preview', requireAdmin, xlsxBody, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = await readSetupWorkbook(workbookBody(req));
    const { plan } = planSetupImport(parsed, loadSetupSnapshot(), req.session.userId!);
    res.json({ plan });
  } catch (err) { next(err); }
});

router.post('/import/apply', requireAdmin, xlsxBody, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fingerprint = typeof req.query.fingerprint === 'string' ? req.query.fingerprint : '';
    if (!fingerprint) return next(createError('fingerprint is required — preview the workbook first', 400));
    const parsed = await readSetupWorkbook(workbookBody(req));
    const { plan, ops } = planSetupImport(parsed, loadSetupSnapshot(), req.session.userId!);
    if (plan.fingerprint !== fingerprint) {
      return next(createError('The data changed since the preview — preview the workbook again', 409));
    }
    if (!plan.canApply) return next(createError('The workbook has errors — fix them and preview again', 422));
    const credentials = await applySetupOps(ops);
    res.json({ plan, credentials });
  } catch (err) { next(err); }
});

export default router;
