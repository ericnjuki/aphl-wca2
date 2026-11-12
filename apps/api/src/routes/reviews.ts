// Review queue for completed submissions (plans/2026-11-12-role-model.md).
// Mounted under /admin/reviews.
//
// Who sees what (by the submitter's CURRENT facility):
//   admin          every submission
//   subcounty      submissions from facilities in its sub-county
//   facility_admin submissions from its own facility
// Nobody may approve or reject their own submission (403). A submission
// outside the caller's scope is reported as not found (404) so ids don't leak.

import { Router, Request, Response, NextFunction } from 'express';
import { SqlValue } from 'sql.js';
import { query, execute } from '../db/database';
import { requireRole } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { getScope } from '../lib/report-scope';
import { REVIEWER_ROLES } from '../lib/roles';

const router = Router();
router.use(requireRole(...REVIEWER_ROLES));

interface ReviewListRow extends Record<string, unknown> {
  id: number;
  user_id: number;
  full_name: string;
  facility_name: string | null;
  department_name: string | null;
  domain_code: string;
  domain_name: string;
  avg_level: number | null;
  completed_at: string | null;
  review_status: 'pending' | 'approved' | 'rejected';
}

const FROM = `
  FROM user_assessments ua
  INNER JOIN users u ON u.id = ua.user_id
  LEFT JOIN facilities  f ON f.id = u.facility_id
  LEFT JOIN departments d ON d.id = u.department_id`;

const AVG_LEVEL = `(SELECT AVG(CASE WHEN r.response_level > 0 THEN r.response_level END)
                      FROM user_assessment_responses r
                     WHERE r.user_assessment_id = ua.id) AS avg_level`;

/** SQL predicate (over FROM's aliases) limiting submissions to the caller's scope. */
function scopeWhere(userId: number): { sql: string; params: SqlValue[] } {
  const scope = getScope(userId);
  switch (scope.role) {
    case 'admin':
      return { sql: '1 = 1', params: [] };
    case 'subcounty':
      return scope.districtIds.length
        ? { sql: `f.district_id IN (${scope.districtIds.map(() => '?').join(',')})`, params: scope.districtIds }
        : { sql: '0 = 1', params: [] };
    case 'facility_admin':
      return scope.facilityId != null
        ? { sql: 'u.facility_id = ?', params: [scope.facilityId] }
        : { sql: '0 = 1', params: [] };
    default:
      return { sql: '0 = 1', params: [] };
  }
}

/** The completed submission if the caller may see it, else undefined. */
function findInScope(userId: number, id: number): { id: number; user_id: number } | undefined {
  const s = scopeWhere(userId);
  return query<{ id: number; user_id: number }>(
    `SELECT ua.id, ua.user_id ${FROM} WHERE ua.id = ? AND ua.status = 'completed' AND (${s.sql})`,
    [id, ...s.params],
  )[0];
}

router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = (req.query.status as string | undefined) ?? 'pending';
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
      return next(createError('Invalid status filter', 400));
    }
    const limit  = Math.min(Number(req.query.limit ?? 100), 500);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    const s = scopeWhere(req.session.userId!);
    const whereParts: string[] = ["ua.status = 'completed'", `(${s.sql})`];
    const params: SqlValue[] = [...s.params];
    if (status !== 'all') { whereParts.push('ua.review_status = ?'); params.push(status); }

    const rows = query<ReviewListRow>(
      `SELECT ua.id, ua.user_id,
              (u.first_name || ' ' || u.last_name) AS full_name,
              f.name AS facility_name, d.name AS department_name,
              ua.domain_code, ua.domain_name, ua.completed_at, ua.review_status,
              ${AVG_LEVEL}
       ${FROM}
       WHERE ${whereParts.join(' AND ')}
       ORDER BY ua.completed_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({ reviews: rows });
  } catch (err) { next(err); }
});

// Detail: the submission plus every answer (same shape as /my-assessments/:id,
// with the submitter and review fields added).
router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!findInScope(req.session.userId!, id)) return next(createError('Submission not found', 404));

    const [assessment] = query(
      `SELECT ua.id, ua.user_id, ua.domain_code, ua.domain_name, ua.status, ua.score,
              ua.review_status, ua.review_notes, ua.reviewed_at, ua.started_at, ua.completed_at, ua.updated_at,
              (u.first_name || ' ' || u.last_name) AS full_name,
              f.name AS facility_name, d.name AS department_name,
              ${AVG_LEVEL}
       ${FROM}
       WHERE ua.id = ?`,
      [id],
    );
    const subcompetencies = query(
      `SELECT uar.domain_code, uar.competency_value, uar.subcompetency_value,
              uar.response_level, uar.response_text,
              ai.subcompetency_text, ai.competency_text
       FROM user_assessment_responses uar
       LEFT JOIN assessment_items ai
              ON ai.domain_id = uar.domain_id
             AND ai.competency_value = uar.competency_value
             AND ai.subcompetency_value = uar.subcompetency_value
       WHERE uar.user_assessment_id = ?
       ORDER BY ai.competency_text, ai.subcompetency_value`,
      [id],
    );
    res.json({ assessment, subcompetencies });
  } catch (err) { next(err); }
});

function decide(status: 'approved' | 'rejected') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const userId = req.session.userId!;
      const { notes } = req.body as { notes?: string | null };
      if (status === 'rejected' && (!notes || !notes.trim())) {
        return next(createError('Rejection notes are required', 400));
      }
      const existing = findInScope(userId, id);
      if (!existing) return next(createError('Submission not found', 404));
      if (existing.user_id === userId) return next(createError('You cannot review your own submission', 403));
      execute(
        `UPDATE user_assessments
         SET review_status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_notes = ?
         WHERE id = ?`,
        [status, userId, notes?.trim() || null, id],
      );
      res.json({ ok: true });
    } catch (err) { next(err); }
  };
}

router.post('/:id/approve', decide('approved'));
router.post('/:id/reject', decide('rejected'));

export default router;
