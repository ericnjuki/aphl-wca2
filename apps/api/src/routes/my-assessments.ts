// Current user's own assessments — history + detail.
// GET /api/v1/my-assessments              → list (in-progress + completed + abandoned)
// GET /api/v1/my-assessments/:id          → detail (domain + per-competency + subcompetencies)

import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db/database';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

const router = Router();
router.use(requireAuth, requirePasswordChanged);

interface ListRow extends Record<string, unknown> {
  id: number;
  domain_code: string;
  domain_name: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  score: number | null;
  avg_level: number | null;
  review_status: 'pending' | 'approved' | 'rejected';
  started_at: string;
  completed_at: string | null;
  updated_at: string;
}

router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.session.userId!;
    const rows = query<ListRow>(
      `SELECT ua.id, ua.domain_code, ua.domain_name, ua.status, ua.score,
              ua.review_status, ua.started_at, ua.completed_at, ua.updated_at,
              (SELECT AVG(CASE WHEN r.response_level > 0 THEN r.response_level END)
                 FROM user_assessment_responses r
                WHERE r.user_assessment_id = ua.id) AS avg_level
       FROM user_assessments ua
       WHERE ua.user_id = ?
       ORDER BY
         CASE ua.status WHEN 'in_progress' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
         ua.updated_at DESC`,
      [userId],
    );
    res.json({ assessments: rows });
  } catch (err) { next(err); }
});

router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const userId = req.session.userId!;
    const [row] = query<ListRow>(
      `SELECT ua.id, ua.domain_code, ua.domain_name, ua.status, ua.score,
              ua.review_status, ua.started_at, ua.completed_at, ua.updated_at,
              (SELECT AVG(CASE WHEN r.response_level > 0 THEN r.response_level END)
                 FROM user_assessment_responses r
                WHERE r.user_assessment_id = ua.id) AS avg_level
       FROM user_assessments ua
       WHERE ua.id = ? AND ua.user_id = ?`,
      [id, userId],
    );
    if (!row) return next(createError('Assessment not found', 404));

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

    res.json({ assessment: row, subcompetencies });
  } catch (err) { next(err); }
});

export default router;
