import { Router, Request, Response, NextFunction } from 'express';
import { query, execute, transaction } from '../db/database';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import {
  extractResponses,
  AssessmentItem as SurveyItem,
  DomainRef,
} from '../lib/survey-responses';

interface SessionRow extends Record<string, unknown> {
  id: number;
  user_id: number;
  domain_code: string;
  domain_name: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  survey_data: string | null;
  ui_state: string | null;
  score: number | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
}

const router = Router();

// All survey routes require an authenticated, password-changed user.
router.use(requireAuth, requirePasswordChanged);

// ── POST /survey/sessions ─────────────────────────────────────────────────────
// Create a new in_progress session for a domain.
router.post('/sessions', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { domain_code, domain_name } = req.body as {
      domain_code?: string;
      domain_name?: string;
    };

    if (!domain_code || !domain_name) {
      return next(createError('domain_code and domain_name are required', 400));
    }

    execute(
      `INSERT INTO user_assessments (user_id, domain_code, domain_name, status)
       VALUES (?, ?, ?, 'in_progress')`,
      [req.session.userId!, domain_code, domain_name],
    );

    // Fetch back by natural key — more reliable than last_insert_rowid() in sql.js.
    const [session] = query<SessionRow>(
      `SELECT * FROM user_assessments
       WHERE user_id = ? AND domain_code = ? AND status = 'in_progress'
       ORDER BY started_at DESC LIMIT 1`,
      [req.session.userId!, domain_code],
    );

    res.status(201).json({ session });
  } catch (err: unknown) {
    // Unique constraint violation → already has an in_progress session.
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return next(createError(`An in-progress session already exists for domain "${req.body.domain_code}". Resume or abandon it first.`, 409));
    }
    next(err);
  }
});

// ── GET /survey/sessions ──────────────────────────────────────────────────────
// List in_progress sessions for the current user, optionally filtered by domain.
router.get('/sessions', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { domain_code } = req.query as { domain_code?: string };

    const sessions = domain_code
      ? query<SessionRow>(
          `SELECT * FROM user_assessments
           WHERE user_id = ? AND domain_code = ? AND status = 'in_progress'
           ORDER BY updated_at DESC`,
          [req.session.userId!, domain_code],
        )
      : query<SessionRow>(
          `SELECT * FROM user_assessments
           WHERE user_id = ? AND status = 'in_progress'
           ORDER BY updated_at DESC`,
          [req.session.userId!],
        );

    res.json({ sessions });
  } catch (err) {
    next(err);
  }
});

// ── PUT /survey/sessions/:id ──────────────────────────────────────────────────
// Save draft progress (survey_data + ui_state).
router.put('/sessions/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = Number(req.params.id);
    const { survey_data, ui_state } = req.body as {
      survey_data?: string;
      ui_state?: string;
    };

    if (!survey_data) {
      return next(createError('survey_data is required', 400));
    }

    // Verify session belongs to this user and is still in_progress.
    const [existing] = query<SessionRow>(
      `SELECT id FROM user_assessments WHERE id = ? AND user_id = ? AND status = 'in_progress'`,
      [sessionId, req.session.userId!],
    );

    if (!existing) {
      return next(createError('Session not found or already completed', 404));
    }

    execute(
      `UPDATE user_assessments
       SET survey_data = ?, ui_state = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [survey_data, ui_state ?? null, sessionId],
    );

    res.json({ message: 'Saved' });
  } catch (err) {
    next(err);
  }
});

// ── POST /survey/sessions/:id/complete ───────────────────────────────────────
// Mark a session as completed, store the final data, AND write granular
// per-subcompetency rows into user_assessment_responses so reports can
// aggregate without parsing the JSON blob at query time.
router.post('/sessions/:id/complete', (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = Number(req.params.id);
    const userId = req.session.userId!;
    const body = req.body as { survey_data?: string | object; score?: number };

    if (!body.survey_data) {
      return next(createError('survey_data is required', 400));
    }

    // SurveyJS hands back an object; accept both shapes and normalise to a string.
    const surveyDataStr =
      typeof body.survey_data === 'string'
        ? body.survey_data
        : JSON.stringify(body.survey_data);

    const [existing] = query<SessionRow>(
      `SELECT id, domain_code FROM user_assessments
       WHERE id = ? AND user_id = ? AND status = 'in_progress'`,
      [sessionId, userId],
    );
    if (!existing) {
      return next(createError('Session not found or already completed', 404));
    }

    // Resolve domain + its items + the user's current org context.
    const [domain] = query<DomainRef & Record<string, unknown>>(
      'SELECT id, code, version FROM assessment_domains WHERE code = ? COLLATE NOCASE',
      [existing.domain_code],
    );
    const items = domain
      ? query<SurveyItem & Record<string, unknown>>(
          `SELECT id, domain_id, competency_value, subcompetency_value,
                  beginner, competent, proficient, expert, na
           FROM assessment_items WHERE domain_id = ?`,
          [domain.id],
        )
      : [];

    const [orgCtx] = query<{
      facility_id: number | null;
      department_id: number | null;
      region_id: number | null;
    }>(
      `SELECT u.facility_id, u.department_id, f.region_id
       FROM users u LEFT JOIN facilities f ON f.id = u.facility_id
       WHERE u.id = ?`,
      [userId],
    );

    const responses = domain ? extractResponses(surveyDataStr, domain, items) : [];

    transaction(() => {
      execute(
        `UPDATE user_assessments
         SET status = 'completed',
             survey_data = ?,
             score = ?,
             ui_state = NULL,
             completed_at = datetime('now'),
             updated_at   = datetime('now')
         WHERE id = ?`,
        [surveyDataStr, body.score ?? null, sessionId],
      );

      // Re-insert responses (in case of a retry). Safe under ON DELETE CASCADE
      // but we're deliberately leaving previous rows alone if the session id
      // has changed — the unique-in-progress constraint prevents overlap.
      execute(
        'DELETE FROM user_assessment_responses WHERE user_assessment_id = ?',
        [sessionId],
      );

      for (const r of responses) {
        execute(
          `INSERT INTO user_assessment_responses
             (user_assessment_id, user_id, domain_id, domain_code,
              competency_value, subcompetency_value,
              response_level, response_text,
              facility_id, department_id, region_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            sessionId, userId, r.domain_id, existing.domain_code,
            r.competency_value, r.subcompetency_value,
            r.response_level, r.response_text,
            orgCtx?.facility_id ?? null,
            orgCtx?.department_id ?? null,
            orgCtx?.region_id ?? null,
          ],
        );
      }
    });

    const [session] = query<SessionRow>(
      'SELECT * FROM user_assessments WHERE id = ?',
      [sessionId],
    );

    res.json({ session, responses_written: responses.length });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /survey/sessions/:id ───────────────────────────────────────────────
// Abandon a session (start-over). Marks it abandoned so history is preserved.
router.delete('/sessions/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = Number(req.params.id);

    const [existing] = query<SessionRow>(
      `SELECT id FROM user_assessments WHERE id = ? AND user_id = ? AND status = 'in_progress'`,
      [sessionId, req.session.userId!],
    );

    if (!existing) {
      return next(createError('Session not found or already completed', 404));
    }

    execute(
      `UPDATE user_assessments
       SET status = 'abandoned', updated_at = datetime('now')
       WHERE id = ?`,
      [sessionId],
    );

    res.json({ message: 'Session abandoned' });
  } catch (err) {
    next(err);
  }
});

export default router;
