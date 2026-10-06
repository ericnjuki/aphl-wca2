// Districts — the level between regions and facilities. Mounted by admin.ts
// under /admin/districts (auth + password-change guards are applied there).

import { Router, Request, Response, NextFunction } from 'express';
import { query, execute, transaction } from '../db/database';
import { requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { parseCsv } from '../lib/csv';
import { syncFacilitiesRegion } from '../lib/org';

interface DistrictRow extends Record<string, unknown> {
  id: number; code: string; name: string; region_id: number;
}

const router = Router();

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function regionExists(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const id = Number(raw);
  if (!Number.isInteger(id)) return null;
  const [row] = query<{ id: number }>('SELECT id FROM regions WHERE id = ?', [id]);
  return row ? row.id : null;
}

// Active districts unless ?include_archived=1; facility_count counts active facilities.
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const all = req.query.include_archived === '1' || req.query.include_archived === 'true';
    const districts = query(`
      SELECT d.*, r.name AS region_name, COUNT(f.id) AS facility_count
      FROM districts d
      LEFT JOIN regions r    ON r.id = d.region_id
      LEFT JOIN facilities f ON f.district_id = d.id AND f.archived_at IS NULL
      ${all ? '' : 'WHERE d.archived_at IS NULL'}
      GROUP BY d.id
      ORDER BY r.name ASC, d.name ASC
    `);
    res.json({ districts });
  } catch (err) { next(err); }
});

router.post('/', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, name, region_id } = req.body as { code?: string; name?: string; region_id?: unknown };
    if (!code || !name) return next(createError('code and name are required', 400));
    const regionId = regionExists(region_id);
    if (regionId === null) return next(createError('region_id is required and must reference an existing region', 400));
    try {
      execute('INSERT INTO districts (code, name, region_id) VALUES (?, ?, ?)', [code.toUpperCase(), name, regionId]);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('UNIQUE'))
        return next(createError(`District code "${code.toUpperCase()}" already exists`, 409));
      throw e;
    }
    const [district] = query<DistrictRow>('SELECT * FROM districts WHERE code = ? COLLATE NOCASE', [code]);
    res.status(201).json({ district });
  } catch (err) { next(err); }
});

router.put('/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<DistrictRow>('SELECT * FROM districts WHERE id = ?', [id]);
    if (!existing) return next(createError('District not found', 404));
    const body = req.body as { code?: string; name?: string; region_id?: unknown };
    const code = (body.code ?? existing.code).toUpperCase();
    const name = body.name ?? existing.name;
    if (!code || !name) return next(createError('code and name are required', 400));
    const regionId = regionExists(body.region_id ?? existing.region_id);
    if (regionId === null) return next(createError('region_id must reference an existing region', 400));
    try {
      transaction(() => {
        execute(
          `UPDATE districts SET code = ?, name = ?, region_id = ?, updated_at = datetime('now') WHERE id = ?`,
          [code, name, regionId, id],
        );
        if (regionId !== existing.region_id) syncFacilitiesRegion(id, regionId);
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('UNIQUE'))
        return next(createError(`District code "${code}" already exists`, 409));
      throw e;
    }
    const [district] = query<DistrictRow>('SELECT * FROM districts WHERE id = ?', [id]);
    res.json({ district });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<DistrictRow>('SELECT id FROM districts WHERE id = ?', [id]);
    if (!existing) return next(createError('District not found', 404));
    const [{ n }] = query<{ n: number }>('SELECT COUNT(*) AS n FROM facilities WHERE district_id = ?', [id]);
    if (n > 0)
      return next(createError(`${plural(n, 'facility is', 'facilities are')} still assigned to this district`, 409));
    execute('DELETE FROM districts WHERE id = ?', [id]);
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

router.post('/import', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { csv } = req.body as { csv?: string };
    if (!csv) return next(createError('csv is required', 400));
    const { headers, rows } = parseCsv(csv);
    const ci = (h: string) => headers.indexOf(h);
    if (ci('district_code') === -1 || ci('district_name') === -1 || ci('region_code') === -1)
      return next(createError('CSV must have district_code, district_name and region_code columns', 400));

    let imported = 0;
    const errors: { row: number; reason: string }[] = [];
    transaction(() => {
      rows.forEach((row, i) => {
        const line = i + 2; // header is line 1
        const code = row[ci('district_code')]?.toUpperCase();
        const name = row[ci('district_name')];
        const regionCode = row[ci('region_code')];
        if (!code || !name || !regionCode) {
          errors.push({ row: line, reason: 'district_code, district_name and region_code are required' });
          return;
        }
        const [region] = query<{ id: number }>('SELECT id FROM regions WHERE code = ? COLLATE NOCASE', [regionCode]);
        if (!region) { errors.push({ row: line, reason: `Unknown region_code "${regionCode}"` }); return; }
        try {
          execute('INSERT INTO districts (code, name, region_id) VALUES (?, ?, ?)', [code, name, region.id]);
          imported++;
        } catch (e: unknown) {
          if (e instanceof Error && e.message.includes('UNIQUE')) {
            errors.push({ row: line, reason: `District code "${code}" already exists` });
          } else {
            throw e;
          }
        }
      });
    });
    res.json({ imported, skipped: errors.length, errors });
  } catch (err) { next(err); }
});

export default router;
