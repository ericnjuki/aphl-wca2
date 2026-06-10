import { Router, Request, Response, NextFunction } from 'express';
import { query, execute } from '../db/database';
import { requireAuth, requirePasswordChanged, requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

interface DomainRow extends Record<string, unknown> {
  id: number;
  code: string;
  name: string;
  version: number;
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

const router = Router();

router.use(requireAuth, requirePasswordChanged);

// CSV parser supporting RFC-4180 double-quoted fields: quoted fields may
// contain commas, newlines, and escaped quotes (""). Unquoted fields are
// trimmed; quoted fields preserve their interior whitespace.
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let fieldWasQuoted = false;

  const pushField = () => {
    record.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };
  const pushRecord = () => {
    pushField();
    // Skip wholly-empty lines.
    if (record.length > 1 || record[0] !== "") records.push(record);
    record = [];
  };

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (ch === '"') {
      // Stray quote mid-unquoted-field: treat as a literal char (non-conforming input).
      field += ch;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRecord();
    } else {
      field += ch;
    }
  }
  // Trailing field/record (no final newline).
  if (field !== "" || record.length > 0) pushRecord();

  if (records.length < 2) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  return { headers, rows: records.slice(1) };
}

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
    const { code, name, version = 1 } = req.body as {
      code?: string; name?: string; version?: number;
    };
    if (!code || !name) return next(createError('code and name are required', 400));
    try {
      execute(
        'INSERT INTO assessment_domains (code, name, version) VALUES (?, ?, ?)',
        [code.toUpperCase(), name, version],
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

router.post('/domains/import', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { csv } = req.body as { csv?: string };
    if (!csv) return next(createError('csv is required', 400));
    const { headers, rows } = parseCsv(csv);
    const codeIdx = headers.indexOf('assessment_code');
    const nameIdx = headers.indexOf('assessment_name');
    if (codeIdx === -1 || nameIdx === -1)
      return next(createError('CSV must have assessment_code and assessment_name columns', 400));
    let imported = 0, skipped = 0;
    for (const row of rows) {
      const code = row[codeIdx]?.toUpperCase();
      const name = row[nameIdx];
      if (!code || !name) { skipped++; continue; }
      try {
        execute('INSERT INTO assessment_domains (code, name) VALUES (?, ?)', [code, name]);
        imported++;
      } catch {
        skipped++;
      }
    }
    res.json({ imported, skipped });
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
    } = req.body as { code?: string; name?: string; version?: number };
    try {
      execute(
        `UPDATE assessment_domains SET code = ?, name = ?, version = ?, updated_at = datetime('now') WHERE id = ?`,
        [code.toUpperCase(), name, version, id],
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

router.post('/domains/:id/items/import', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const domainId = Number(req.params.id);
    const [domain] = query<DomainRow>(
      'SELECT id FROM assessment_domains WHERE id = ?',
      [domainId],
    );
    if (!domain) return next(createError('Domain not found', 404));
    const { csv } = req.body as { csv?: string };
    if (!csv) return next(createError('csv is required', 400));
    const { headers, rows } = parseCsv(csv);
    const required = ['competency_value', 'competency_text', 'subcompetency_value', 'subcompetency_text'];
    const idx = (h: string) => headers.indexOf(h);
    if (required.some((h) => idx(h) === -1))
      return next(createError(`CSV must have columns: ${required.join(', ')}`, 400));
    let imported = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const get = (h: string) => row[idx(h)] ?? '';
      execute(
        `INSERT INTO assessment_items
           (domain_id, competency_value, competency_text, subcompetency_value, subcompetency_text,
            beginner, competent, proficient, expert, na, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [domainId, get('competency_value'), get('competency_text'),
         get('subcompetency_value'), get('subcompetency_text'),
         get('beginner'), get('competent'), get('proficient'), get('expert'), get('na'), i],
      );
      imported++;
    }
    res.json({ imported });
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

export default router;
