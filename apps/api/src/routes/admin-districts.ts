// Districts — the level between regions and facilities. Mounted by admin.ts
// under /admin/districts (auth + password-change guards are applied there).

import { Router, Request, Response, NextFunction } from 'express';
import { query, execute, transaction } from '../db/database';
import { requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { syncFacilitiesRegion } from '../lib/org';
import { assertNoHistory } from '../lib/history';

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
    assertNoHistory('districts', id);
    const [{ n }] = query<{ n: number }>('SELECT COUNT(*) AS n FROM facilities WHERE district_id = ?', [id]);
    if (n > 0)
      return next(createError(`${plural(n, 'facility is', 'facilities are')} still assigned to this district`, 409));
    execute('DELETE FROM districts WHERE id = ?', [id]);
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

export default router;
