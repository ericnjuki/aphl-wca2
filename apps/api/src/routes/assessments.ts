import { Router, Request, Response, NextFunction } from 'express';
import { query, execute } from '../db/database';
import { requireAuth, requirePasswordChanged, requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import catalogueRouter from './assessments-catalogue';

interface DomainRow extends Record<string, unknown> {
  id: number;
  code: string;
  name: string;
  version: number;
  purpose: string | null;
  introduction: string | null;
  created_at: string;
  updated_at: string;
}

interface ItemRow extends Record<string, unknown> {
  id: number;
  domain_id: number;
  competency_value: string;
  competency_text: string;
  subcompetency_value: string;
  subcompetency_text: string;
  beginner: string;
  competent: string;
  proficient: string;
  expert: string;
  na: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface FootnoteRow extends Record<string, unknown> {
  id: number;
  domain_id: number;
  symbol: string;
  definition: string;
  sort_order: number;
  created_at: string;
}

const router = Router();

router.use(requireAuth, requirePasswordChanged);

// ── Catalogue workbook ────────────────────────────────────────────────────────

router.use('/catalogue', catalogueRouter);

// ── Domains ───────────────────────────────────────────────────────────────────

router.get('/domains', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const domains = query<DomainRow>(
      'SELECT * FROM assessment_domains ORDER BY name ASC',
    );
    res.json({ domains });
  } catch (err) { next(err); }
});

router.get('/domains/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const [domain] = query<DomainRow>(
      'SELECT * FROM assessment_domains WHERE id = ?',
      [Number(req.params.id)],
    );
    if (!domain) return next(createError('Domain not found', 404));
    res.json({ domain });
  } catch (err) { next(err); }
});

router.post('/domains', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, name, version = 1, purpose = null, introduction = null } = req.body as {
      code?: string; name?: string; version?: number; purpose?: string | null; introduction?: string | null;
    };
    if (!code || !name) return next(createError('code and name are required', 400));
    try {
      execute(
        'INSERT INTO assessment_domains (code, name, version, purpose, introduction) VALUES (?, ?, ?, ?, ?)',
        [code.toUpperCase(), name, version, purpose, introduction],
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE'))
        return next(createError(`Domain code "${code.toUpperCase()}" already exists`, 409));
      throw err;
    }
    const [domain] = query<DomainRow>(
      'SELECT * FROM assessment_domains WHERE code = ? COLLATE NOCASE',
      [code],
    );
    res.status(201).json({ domain });
  } catch (err) { next(err); }
});

router.put('/domains/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<DomainRow>(
      'SELECT * FROM assessment_domains WHERE id = ?',
      [id],
    );
    if (!existing) return next(createError('Domain not found', 404));
    const {
      code = existing.code,
      name = existing.name,
      version = existing.version,
      purpose = existing.purpose,
      introduction = existing.introduction,
    } = req.body as { code?: string; name?: string; version?: number; purpose?: string | null; introduction?: string | null };
    try {
      execute(
        `UPDATE assessment_domains SET code = ?, name = ?, version = ?, purpose = ?, introduction = ?, updated_at = datetime('now') WHERE id = ?`,
        [code.toUpperCase(), name, version, purpose, introduction, id],
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE'))
        return next(createError(`Domain code "${code.toUpperCase()}" already exists`, 409));
      throw err;
    }
    const [domain] = query<DomainRow>(
      'SELECT * FROM assessment_domains WHERE id = ?',
      [id],
    );
    res.json({ domain });
  } catch (err) { next(err); }
});

router.delete('/domains/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<DomainRow>(
      'SELECT id FROM assessment_domains WHERE id = ?',
      [id],
    );
    if (!existing) return next(createError('Domain not found', 404));
    execute('DELETE FROM assessment_domains WHERE id = ?', [id]);
    res.json({ message: 'Domain deleted' });
  } catch (err) { next(err); }
});

// ── Items ─────────────────────────────────────────────────────────────────────

router.get('/domains/:id/items', (req: Request, res: Response, next: NextFunction) => {
  try {
    const domainId = Number(req.params.id);
    const [domain] = query<DomainRow>(
      'SELECT id FROM assessment_domains WHERE id = ?',
      [domainId],
    );
    if (!domain) return next(createError('Domain not found', 404));
    const items = query<ItemRow>(
      `SELECT * FROM assessment_items WHERE domain_id = ?
       ORDER BY sort_order ASC, subcompetency_value ASC`,
      [domainId],
    );
    res.json({ items });
  } catch (err) { next(err); }
});

router.post('/domains/:id/items', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const domainId = Number(req.params.id);
    const [domain] = query<DomainRow>(
      'SELECT id FROM assessment_domains WHERE id = ?',
      [domainId],
    );
    if (!domain) return next(createError('Domain not found', 404));
    const {
      competency_value, competency_text,
      subcompetency_value, subcompetency_text,
      beginner = '', competent = '', proficient = '', expert = '', na = '',
      sort_order = 0,
    } = req.body as Partial<ItemRow>;
    if (!competency_value || !competency_text || !subcompetency_value || !subcompetency_text)
      return next(createError('competency_value, competency_text, subcompetency_value, subcompetency_text are required', 400));
    execute(
      `INSERT INTO assessment_items
         (domain_id, competency_value, competency_text, subcompetency_value, subcompetency_text,
          beginner, competent, proficient, expert, na, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [domainId, competency_value, competency_text, subcompetency_value, subcompetency_text,
       beginner, competent, proficient, expert, na, sort_order],
    );
    const [item] = query<ItemRow>(
      `SELECT * FROM assessment_items
       WHERE domain_id = ? AND subcompetency_value = ?
       ORDER BY created_at DESC LIMIT 1`,
      [domainId, subcompetency_value],
    );
    res.status(201).json({ item });
  } catch (err) { next(err); }
});

router.put('/items/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<ItemRow>(
      'SELECT * FROM assessment_items WHERE id = ?',
      [id],
    );
    if (!existing) return next(createError('Item not found', 404));
    const {
      competency_value = existing.competency_value,
      competency_text = existing.competency_text,
      subcompetency_value = existing.subcompetency_value,
      subcompetency_text = existing.subcompetency_text,
      beginner = existing.beginner,
      competent = existing.competent,
      proficient = existing.proficient,
      expert = existing.expert,
      na = existing.na,
      sort_order = existing.sort_order,
    } = req.body as Partial<ItemRow>;
    execute(
      `UPDATE assessment_items
       SET competency_value=?, competency_text=?, subcompetency_value=?, subcompetency_text=?,
           beginner=?, competent=?, proficient=?, expert=?, na=?, sort_order=?,
           updated_at=datetime('now')
       WHERE id=?`,
      [competency_value, competency_text, subcompetency_value, subcompetency_text,
       beginner, competent, proficient, expert, na, sort_order, id],
    );
    const [item] = query<ItemRow>(
      'SELECT * FROM assessment_items WHERE id = ?',
      [id],
    );
    res.json({ item });
  } catch (err) { next(err); }
});

router.delete('/items/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<ItemRow>(
      'SELECT id FROM assessment_items WHERE id = ?',
      [id],
    );
    if (!existing) return next(createError('Item not found', 404));
    execute('DELETE FROM assessment_items WHERE id = ?', [id]);
    res.json({ message: 'Item deleted' });
  } catch (err) { next(err); }
});

// ── Footnotes ───────────────────────────────────────────────────────────────

router.get('/domains/:id/footnotes', (req: Request, res: Response, next: NextFunction) => {
  try {
    const domainId = Number(req.params.id);
    const [domain] = query<DomainRow>('SELECT id FROM assessment_domains WHERE id = ?', [domainId]);
    if (!domain) return next(createError('Domain not found', 404));
    const footnotes = query<FootnoteRow>(
      'SELECT * FROM assessment_footnotes WHERE domain_id = ? ORDER BY sort_order ASC, id ASC',
      [domainId],
    );
    res.json({ footnotes });
  } catch (err) { next(err); }
});

router.post('/domains/:id/footnotes', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const domainId = Number(req.params.id);
    const [domain] = query<DomainRow>('SELECT id FROM assessment_domains WHERE id = ?', [domainId]);
    if (!domain) return next(createError('Domain not found', 404));
    const { symbol, definition, sort_order = 0 } = req.body as Partial<FootnoteRow>;
    if (!symbol || !definition) return next(createError('symbol and definition are required', 400));
    execute(
      'INSERT INTO assessment_footnotes (domain_id, symbol, definition, sort_order) VALUES (?, ?, ?, ?)',
      [domainId, symbol, definition, sort_order],
    );
    const [footnote] = query<FootnoteRow>(
      'SELECT * FROM assessment_footnotes WHERE domain_id = ? ORDER BY id DESC LIMIT 1',
      [domainId],
    );
    res.status(201).json({ footnote });
  } catch (err) { next(err); }
});

router.put('/footnotes/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<FootnoteRow>('SELECT * FROM assessment_footnotes WHERE id = ?', [id]);
    if (!existing) return next(createError('Footnote not found', 404));
    const {
      symbol = existing.symbol,
      definition = existing.definition,
      sort_order = existing.sort_order,
    } = req.body as Partial<FootnoteRow>;
    execute(
      'UPDATE assessment_footnotes SET symbol = ?, definition = ?, sort_order = ? WHERE id = ?',
      [symbol, definition, sort_order, id],
    );
    const [footnote] = query<FootnoteRow>('SELECT * FROM assessment_footnotes WHERE id = ?', [id]);
    res.json({ footnote });
  } catch (err) { next(err); }
});

router.delete('/footnotes/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<FootnoteRow>('SELECT id FROM assessment_footnotes WHERE id = ?', [id]);
    if (!existing) return next(createError('Footnote not found', 404));
    execute('DELETE FROM assessment_footnotes WHERE id = ?', [id]);
    res.json({ message: 'Footnote deleted' });
  } catch (err) { next(err); }
});

export default router;
