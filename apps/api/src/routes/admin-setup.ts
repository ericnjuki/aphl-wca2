// Country setup workbook — mounted by admin.ts under /admin/setup (auth and
// password-change guards are applied there). Spec §3.

import { Router, Request, Response, NextFunction } from 'express';
import { requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { xlsxBody, workbookBody, sendWorkbook } from '../lib/workbook/http';
import { readSetupWorkbook, ParsedSetup } from '../lib/workbook/setup-format';
import { loadSetupSnapshot } from '../lib/workbook/setup-snapshot';
import { planSetupImport } from '../lib/workbook/setup-planner';
import { prepareSecrets, applyPrepared } from '../lib/workbook/setup-apply';
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

/** Plans against the current data; 409 when it no longer matches the preview, 422 when it has errors. */
function checkedPlan(parsed: ParsedSetup, actorId: number, fingerprint: string) {
  const result = planSetupImport(parsed, loadSetupSnapshot(), actorId);
  if (result.plan.fingerprint !== fingerprint) {
    throw createError('The data changed since the preview — preview the workbook again', 409);
  }
  if (!result.plan.canApply) throw createError('The workbook has errors — fix them and preview again', 422);
  return result;
}

router.post('/import/apply', requireAdmin, xlsxBody, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fingerprint = typeof req.query.fingerprint === 'string' ? req.query.fingerprint : '';
    if (!fingerprint) return next(createError('fingerprint is required — preview the workbook first', 400));
    const parsed = await readSetupWorkbook(workbookBody(req));
    const actorId = req.session.userId!;
    const secrets = await prepareSecrets(checkedPlan(parsed, actorId, fingerprint).ops); // slow: bcrypt
    // Re-check and write with no await in between, so nothing can change the data after the check.
    const { plan, ops } = checkedPlan(parsed, actorId, fingerprint);
    const credentials = applyPrepared(ops, secrets);
    res.json({ plan, credentials });
  } catch (err) { next(err); }
});

export default router;
