import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { SqlValue } from 'sql.js';
import { query, execute, transaction } from '../db/database';
import { requireAuth, requirePasswordChanged, requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import districtsRouter from './admin-districts';
import { parseCsv as parseCsvRfc } from '../lib/csv';
import { resolveDistrict, backfillResponseDistrict, withRegions } from '../lib/org';
import { generateTempPassword, generateUsername } from '../lib/credentials';
import setupRouter from './admin-setup';
import { assertNoHistory, type HistoryTable } from '../lib/history';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RegionRow    extends Record<string, unknown> { id: number; code: string; name: string; }
interface FacilityRow  extends Record<string, unknown> { id: number; code: string; name: string; facility_type: string | null; region_id: number | null; district_id: number | null; }
interface DeptRow      extends Record<string, unknown> { id: number; code: string; name: string; }
interface OrgRoleRow   extends Record<string, unknown> { id: number; code: string; name: string; }
interface TitleRow     extends Record<string, unknown> { id: number; code: string; name: string; }
interface UserRow      extends Record<string, unknown> {
  id: number; email: string; first_name: string; last_name: string;
  national_id: string; id_type: string; user_name: string; password: string;
  role: string; is_first_login: number; is_enabled: number;
  facility_id: number | null; department_id: number | null;
  org_role_id: number | null; title_id: number | null;
  temp_password: string | null;
}

const router = Router();
router.use(requireAuth, requirePasswordChanged);

// ── CSV helpers ───────────────────────────────────────────────────────────────

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].replace(/^\uFEFF/, '').split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((l) => l.split(',').map((v) => v.trim()));
  return { headers, rows };
}

// ── Archived rows ─────────────────────────────────────────────────────────────
// Lists (and so every picker) show active rows; ?include_archived=1 adds the
// archived ones for the Setup tables' "Show archived" toggle.

const includeArchived = (req: Request) =>
  req.query.include_archived === '1' || req.query.include_archived === 'true';

// ── Generic CRUD factory ──────────────────────────────────────────────────────
// Keeps the reference-data routes DRY.  Each table only needs a small config.

interface CrudConfig {
  table: HistoryTable;
  fields: string[];          // updatable fields (code always included)
  uniqueConflictField?: string; // field name to show in 409 message
  beforeDelete?: (id: number) => string | null; // non-null → 409 with that message
}

function makeCrudRouter(cfg: CrudConfig) {
  const r = Router();
  const { table, fields, beforeDelete } = cfg;
  const allFields = [...new Set(['code', 'name', ...fields])];

  // LIST — active rows unless ?include_archived=1
  r.get('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const where = includeArchived(req) ? '' : 'WHERE archived_at IS NULL';
      res.json({ [table]: query(`SELECT * FROM ${table} ${where} ORDER BY name ASC`) });
    } catch (err) { next(err); }
  });

  // CREATE
  r.post('/', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const missing = allFields.filter((f) => !body[f]);
      if (missing.length) return next(createError(`Missing required fields: ${missing.join(', ')}`, 400));
      const cols = allFields.join(', ');
      const placeholders = allFields.map(() => '?').join(', ');
      const vals = allFields.map((f) => (f === 'code' ? String(body[f]).toUpperCase() : body[f])) as SqlValue[];
      try {
        execute(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`, vals);
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('UNIQUE'))
          return next(createError(`A record with that code or name already exists`, 409));
        throw e;
      }
      const [row] = query(`SELECT * FROM ${table} WHERE code = ? COLLATE NOCASE`, [String(body['code'])]);
      res.status(201).json({ row });
    } catch (err) { next(err); }
  });

  // UPDATE
  r.put('/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const [existing] = query(`SELECT * FROM ${table} WHERE id = ?`, [id]) as Record<string, unknown>[];
      if (!existing) return next(createError('Not found', 404));
      const body = req.body as Record<string, unknown>;
      const updates = allFields.map((f) => {
        const val = body[f] ?? existing[f];
        return { f, val: f === 'code' ? String(val).toUpperCase() : val };
      });
      const hasUpdatedAt = (query(`PRAGMA table_info(${table})`)).some((c: any) => c.name === 'updated_at');
      const setClauses = updates.map((u) => `${u.f} = ?`).join(', ') + (hasUpdatedAt ? `, updated_at = datetime('now')` : '');
      try {
        execute(`UPDATE ${table} SET ${setClauses} WHERE id = ?`, [...updates.map((u) => u.val), id] as SqlValue[]);
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('UNIQUE'))
          return next(createError(`A record with that code or name already exists`, 409));
        throw e;
      }
      const [row] = query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      res.json({ row });
    } catch (err) { next(err); }
  });

  // DELETE
  r.delete('/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const [existing] = query(`SELECT id FROM ${table} WHERE id = ?`, [id]);
      if (!existing) return next(createError('Not found', 404));
      assertNoHistory(table, id);
      const blocked = beforeDelete?.(id);
      if (blocked) return next(createError(blocked, 409));
      execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
      res.json({ message: 'Deleted' });
    } catch (err) { next(err); }
  });

  return r;
}

// ── Regions ───────────────────────────────────────────────────────────────────

const regionsRouter = makeCrudRouter({
  table: 'regions',
  fields: ['code', 'name'],
  // Invariant 4 — FKs aren't enforced, so check here. Partner users count too.
  beforeDelete: (id) => {
    const [{ n }] = query<{ n: number }>('SELECT COUNT(*) AS n FROM districts WHERE region_id = ?', [id]);
    if (n > 0) return `${n} ${n === 1 ? 'district is' : 'districts are'} still assigned to this region`;
    const [{ m }] = query<{ m: number }>('SELECT COUNT(*) AS m FROM user_regions WHERE region_id = ?', [id]);
    return m > 0 ? `${m} partner ${m === 1 ? 'user is' : 'users are'} still assigned to this region` : null;
  },
});

regionsRouter.post('/import', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { csv } = req.body as { csv?: string };
    if (!csv) return next(createError('csv is required', 400));
    const { headers, rows } = parseCsv(csv);
    const ci = (h: string) => headers.indexOf(h);
    if (ci('region_code') === -1 || ci('region_name') === -1)
      return next(createError('CSV must have region_code and region_name columns', 400));
    let imported = 0, skipped = 0;
    for (const row of rows) {
      const code = row[ci('region_code')]?.toUpperCase();
      const name = row[ci('region_name')];
      if (!code || !name) { skipped++; continue; }
      try { execute('INSERT INTO regions (code, name) VALUES (?, ?)', [code, name]); imported++; }
      catch { skipped++; }
    }
    res.json({ imported, skipped });
  } catch (err) { next(err); }
});

// ── Departments ───────────────────────────────────────────────────────────────

const departmentsRouter = makeCrudRouter({ table: 'departments', fields: ['code', 'name'] });

departmentsRouter.post('/import', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { csv } = req.body as { csv?: string };
    if (!csv) return next(createError('csv is required', 400));
    const { headers, rows } = parseCsv(csv);
    const ci = (h: string) => headers.indexOf(h);
    if (ci('department_code') === -1 || ci('department_name') === -1)
      return next(createError('CSV must have department_code and department_name columns', 400));
    let imported = 0, skipped = 0;
    for (const row of rows) {
      const code = row[ci('department_code')]?.toUpperCase();
      const name = row[ci('department_name')];
      if (!code || !name) { skipped++; continue; }
      try { execute('INSERT INTO departments (code, name) VALUES (?, ?)', [code, name]); imported++; }
      catch { skipped++; }
    }
    res.json({ imported, skipped });
  } catch (err) { next(err); }
});

// ── Facilities ────────────────────────────────────────────────────────────────

const facilitiesRouter = Router();
facilitiesRouter.use(requireAuth, requirePasswordChanged);

facilitiesRouter.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const where = includeArchived(req) ? '' : 'WHERE f.archived_at IS NULL';
    const facilities = query<FacilityRow & { region_name: string | null; district_name: string | null; department_ids: string | null }>(`
      SELECT f.*,
             r.name AS region_name,
             d.name AS district_name,
             GROUP_CONCAT(fd.department_id) AS department_ids
      FROM facilities f
      LEFT JOIN regions r   ON r.id = f.region_id
      LEFT JOIN districts d ON d.id = f.district_id
      LEFT JOIN facility_departments fd ON fd.facility_id = f.id
      ${where}
      GROUP BY f.id
      ORDER BY f.name ASC
    `);
    // Parse comma-separated department_ids into arrays
    const result = facilities.map((f) => ({
      ...f,
      department_ids: f.department_ids ? f.department_ids.split(',').map(Number) : [],
    }));
    res.json({ facilities: result });
  } catch (err) { next(err); }
});

facilitiesRouter.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [facility] = query<FacilityRow>('SELECT * FROM facilities WHERE id = ?', [id]);
    if (!facility) return next(createError('Facility not found', 404));
    const depts = query<{ department_id: number }>('SELECT department_id FROM facility_departments WHERE facility_id = ?', [id]);
    res.json({ facility: { ...facility, department_ids: depts.map((d) => d.department_id) } });
  } catch (err) { next(err); }
});

facilitiesRouter.post('/', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, name, facility_type, district_id, department_ids = [] } = req.body as {
      code?: string; name?: string; facility_type?: string; district_id?: unknown; department_ids?: number[];
    };
    if (!code || !name) return next(createError('code and name are required', 400));
    // Region is derived from the district (invariant 1); any region_id in the body is ignored.
    const district = resolveDistrict(district_id);
    if (!district) return next(createError('district_id is required and must reference an existing district', 400));
    try {
      execute('INSERT INTO facilities (code, name, facility_type, region_id, district_id) VALUES (?, ?, ?, ?, ?)',
        [code.toUpperCase(), name, facility_type ?? null, district.region_id, district.id]);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('UNIQUE'))
        return next(createError(`Facility code "${code.toUpperCase()}" already exists`, 409));
      throw e;
    }
    const [facility] = query<FacilityRow>('SELECT * FROM facilities WHERE code = ? COLLATE NOCASE', [code]);
    if (department_ids.length) {
      for (const deptId of department_ids)
        execute('INSERT OR IGNORE INTO facility_departments (facility_id, department_id) VALUES (?, ?)', [facility.id, deptId]);
    }
    res.status(201).json({ facility: { ...facility, department_ids } });
  } catch (err) { next(err); }
});

facilitiesRouter.put('/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<FacilityRow>('SELECT * FROM facilities WHERE id = ?', [id]);
    if (!existing) return next(createError('Facility not found', 404));
    const body = req.body as {
      code?: string; name?: string; facility_type?: string | null; district_id?: unknown; department_ids?: number[];
    };
    const code = body.code ?? existing.code;
    const name = body.name ?? existing.name;
    const facility_type = body.facility_type === undefined ? existing.facility_type : body.facility_type;
    const department_ids = body.department_ids;
    const district = resolveDistrict(body.district_id ?? existing.district_id);
    if (!district) return next(createError('district_id is required and must reference an existing district', 400));
    try {
      execute(`UPDATE facilities SET code=?, name=?, facility_type=?, region_id=?, district_id=?, updated_at=datetime('now') WHERE id=?`,
        [code.toUpperCase(), name, facility_type ?? null, district.region_id, district.id, id]);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('UNIQUE'))
        return next(createError(`Facility code "${code.toUpperCase()}" already exists`, 409));
      throw e;
    }
    if (Array.isArray(department_ids)) {
      execute('DELETE FROM facility_departments WHERE facility_id = ?', [id]);
      for (const deptId of department_ids)
        execute('INSERT INTO facility_departments (facility_id, department_id) VALUES (?, ?)', [id, deptId]);
    }
    backfillResponseDistrict(id, district.id);
    const currentDepts = query<{ department_id: number }>('SELECT department_id FROM facility_departments WHERE facility_id = ?', [id]);
    const [updated] = query<FacilityRow>('SELECT * FROM facilities WHERE id = ?', [id]);
    res.json({ facility: { ...updated, department_ids: currentDepts.map((d) => d.department_id) } });
  } catch (err) { next(err); }
});

facilitiesRouter.delete('/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<FacilityRow>('SELECT id FROM facilities WHERE id = ?', [id]);
    if (!existing) return next(createError('Facility not found', 404));
    assertNoHistory('facilities', id);
    execute('DELETE FROM facilities WHERE id = ?', [id]);
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

facilitiesRouter.post('/import', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { csv } = req.body as { csv?: string };
    if (!csv) return next(createError('csv is required', 400));
    const { headers, rows } = parseCsvRfc(csv);
    const ci = (h: string) => headers.indexOf(h);
    if (ci('facility_code') === -1 || ci('facility_name') === -1 || ci('district_code') === -1)
      return next(createError('CSV must have facility_code, facility_name and district_code columns', 400));

    const cell = (row: string[], h: string) => (ci(h) >= 0 ? row[ci(h)] || null : null);
    let imported = 0, updated = 0;
    const errors: { row: number; reason: string }[] = [];

    transaction(() => {
      rows.forEach((row, i) => {
        const line = i + 2; // header is line 1
        const code = cell(row, 'facility_code')?.toUpperCase();
        const name = cell(row, 'facility_name');
        const districtCode = cell(row, 'district_code');
        if (!code || !name || !districtCode) {
          errors.push({ row: line, reason: 'facility_code, facility_name and district_code are required' });
          return;
        }
        const [district] = query<{ id: number; region_id: number; region_code: string }>(
          `SELECT d.id, d.region_id, r.code AS region_code
           FROM districts d JOIN regions r ON r.id = d.region_id
           WHERE d.code = ? COLLATE NOCASE`,
          [districtCode],
        );
        if (!district) { errors.push({ row: line, reason: `Unknown district_code "${districtCode}"` }); return; }
        const regionCode = cell(row, 'region_code');
        if (regionCode && regionCode.toUpperCase() !== district.region_code.toUpperCase()) {
          errors.push({
            row: line,
            reason: `region_code "${regionCode}" does not match district ${districtCode.toUpperCase()} (region ${district.region_code})`,
          });
          return;
        }

        const [existing] = query<{ id: number }>('SELECT id FROM facilities WHERE code = ? COLLATE NOCASE', [code]);
        if (existing) {
          // Existing code: only (re)assign its district — name/type/departments untouched.
          execute(`UPDATE facilities SET district_id = ?, region_id = ?, updated_at = datetime('now') WHERE id = ?`,
            [district.id, district.region_id, existing.id]);
          backfillResponseDistrict(existing.id, district.id);
          updated++;
        } else {
          execute('INSERT INTO facilities (code, name, facility_type, region_id, district_id) VALUES (?, ?, ?, ?, ?)',
            [code, name, cell(row, 'facility_type'), district.region_id, district.id]);
          imported++;
        }
      });
    });

    res.json({ imported, updated, skipped: errors.length, errors });
  } catch (err) { next(err); }
});

// ── Org roles ─────────────────────────────────────────────────────────────────

const orgRolesRouter = makeCrudRouter({ table: 'org_roles', fields: ['code', 'name'] });

orgRolesRouter.post('/import', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { csv } = req.body as { csv?: string };
    if (!csv) return next(createError('csv is required', 400));
    const { headers, rows } = parseCsv(csv);
    const ci = (h: string) => headers.indexOf(h);
    if (ci('role_code') === -1 || ci('role_name') === -1)
      return next(createError('CSV must have role_code and role_name columns', 400));
    let imported = 0, skipped = 0;
    for (const row of rows) {
      const code = row[ci('role_code')]?.toUpperCase();
      const name = row[ci('role_name')];
      if (!code || !name) { skipped++; continue; }
      try { execute('INSERT INTO org_roles (code, name) VALUES (?, ?)', [code, name]); imported++; }
      catch { skipped++; }
    }
    res.json({ imported, skipped });
  } catch (err) { next(err); }
});

// ── User titles ───────────────────────────────────────────────────────────────

const userTitlesRouter = makeCrudRouter({ table: 'user_titles', fields: ['code', 'name'] });

userTitlesRouter.post('/import', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { csv } = req.body as { csv?: string };
    if (!csv) return next(createError('csv is required', 400));
    const { headers, rows } = parseCsv(csv);
    const ci = (h: string) => headers.indexOf(h);
    if (ci('title_code') === -1 || ci('title_name') === -1)
      return next(createError('CSV must have title_code and title_name columns', 400));
    let imported = 0, skipped = 0;
    for (const row of rows) {
      const code = row[ci('title_code')]?.toUpperCase();
      const name = row[ci('title_name')];
      if (!code || !name) { skipped++; continue; }
      try { execute('INSERT INTO user_titles (code, name) VALUES (?, ?)', [code, name]); imported++; }
      catch { skipped++; }
    }
    res.json({ imported, skipped });
  } catch (err) { next(err); }
});

// ── Users ─────────────────────────────────────────────────────────────────────

const usersRouter = Router();
usersRouter.use(requireAuth, requirePasswordChanged);

const USER_SELECT = `
  SELECT u.*,
         f.name  AS facility_name,
         d.name  AS department_name,
         r.name  AS org_role_name,
         t.name  AS title_name
  FROM users u
  LEFT JOIN facilities  f ON f.id = u.facility_id
  LEFT JOIN departments d ON d.id = u.department_id
  LEFT JOIN org_roles   r ON r.id = u.org_role_id
  LEFT JOIN user_titles t ON t.id = u.title_id
`;

function sanitiseUser(u: UserRow & Record<string, unknown>) {
  const { password: _, ...safe } = u;
  return withRegions({ ...safe, id: u.id, is_first_login: Boolean(u.is_first_login), is_enabled: Boolean(u.is_enabled) });
}

// ── Partner (monitor) placement ───────────────────────────────────────────────
// Monitors have no facility placement; they see reports for the regions in
// user_regions. Only monitors may have rows there (FKs aren't enforced).

type Placement = { facility_id: unknown; department_id: unknown; org_role_id: unknown; title_id: unknown };

const USER_ROLES = ['staff', 'admin', 'monitor'];
const ROLE_ERROR = 'role must be one of: staff, admin, monitor';

function validatePlacement(
  role: string, placement: Placement, rawRegionIds: unknown,
): { regionIds: number[] } | { error: string } {
  const ids = rawRegionIds ?? [];
  if (!Array.isArray(ids) || !ids.every((v) => Number.isInteger(v)))
    return { error: 'region_ids must be an array of region ids' };
  if (role !== 'monitor')
    return ids.length > 0 ? { error: 'Only partner (monitor) users can be assigned regions' } : { regionIds: [] };
  if (Object.values(placement).some((v) => v != null))
    return { error: 'Partner (monitor) users cannot have a facility, department, org role or title' };
  const unique = [...new Set(ids as number[])];
  if (unique.length === 0) return { error: 'Partner (monitor) users need at least one region' };
  const found = query<{ id: number }>(
    `SELECT id FROM regions WHERE id IN (${unique.map(() => '?').join(',')})`, unique,
  );
  if (found.length !== unique.length) return { error: 'Unknown region in region_ids' };
  return { regionIds: unique };
}

function setUserRegions(userId: number, regionIds: number[]): void {
  execute('DELETE FROM user_regions WHERE user_id = ?', [userId]);
  for (const rid of regionIds) {
    execute('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)', [userId, rid]);
  }
}

usersRouter.get('/', requireAdmin, (_req, res: Response, next: NextFunction) => {
  try {
    const users = query<UserRow & Record<string, unknown>>(`${USER_SELECT} ORDER BY u.last_name, u.first_name`);
    res.json({ users: users.map(sanitiseUser) });
  } catch (err) { next(err); }
});

usersRouter.post('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { first_name, last_name, national_id, id_type, email,
            facility_id, department_id, org_role_id, title_id, role = 'staff' } = req.body as Partial<UserRow>;
    if (!first_name || !last_name || !national_id || !id_type || !email)
      return next(createError('first_name, last_name, national_id, id_type, email are required', 400));
    if (!USER_ROLES.includes(role)) return next(createError(ROLE_ERROR, 400));
    const placement = validatePlacement(
      role, { facility_id, department_id, org_role_id, title_id }, (req.body as { region_ids?: unknown }).region_ids,
    );
    if ('error' in placement) return next(createError(placement.error, 400));
    const user_name = generateUsername(first_name, last_name);
    const temp = generateTempPassword();
    const hashed = await bcrypt.hash(temp, 12);
    try {
      transaction(() => {
        execute(
          `INSERT INTO users (first_name, last_name, national_id, id_type, email, user_name, password,
             role, facility_id, department_id, org_role_id, title_id, temp_password)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [first_name, last_name, national_id, id_type, email, user_name, hashed,
           role, facility_id ?? null, department_id ?? null, org_role_id ?? null, title_id ?? null, temp],
        );
        const [created] = query<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
        setUserRegions(created.id, placement.regionIds);
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('UNIQUE'))
        return next(createError('A user with that email, national ID, or username already exists', 409));
      throw e;
    }
    const [user] = query<UserRow & Record<string, unknown>>(`${USER_SELECT} WHERE u.email = ?`, [email]);
    res.status(201).json({ user: sanitiseUser(user) });
  } catch (err) { next(err); }
});

usersRouter.put('/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) return next(createError('User not found', 404));
    const {
      first_name = existing.first_name, last_name = existing.last_name,
      email = existing.email, role = existing.role,
      facility_id = existing.facility_id, department_id = existing.department_id,
      org_role_id = existing.org_role_id, title_id = existing.title_id,
      is_enabled = existing.is_enabled,
    } = req.body as Partial<UserRow>;
    // Omitted region_ids keep the current assignment while the user stays a monitor.
    const sentRegionIds = (req.body as { region_ids?: unknown }).region_ids;
    const regionInput = sentRegionIds !== undefined ? sentRegionIds
      : role === 'monitor'
        ? query<{ region_id: number }>('SELECT region_id FROM user_regions WHERE user_id = ?', [id]).map((r) => r.region_id)
        : [];
    if (!USER_ROLES.includes(role)) return next(createError(ROLE_ERROR, 400));
    const placement = validatePlacement(role, { facility_id, department_id, org_role_id, title_id }, regionInput);
    if ('error' in placement) return next(createError(placement.error, 400));
    try {
      transaction(() => {
        execute(
          `UPDATE users SET first_name=?, last_name=?, email=?, role=?,
             facility_id=?, department_id=?, org_role_id=?, title_id=?, is_enabled=?,
             updated_at=datetime('now') WHERE id=?`,
          [first_name, last_name, email, role,
           facility_id ?? null, department_id ?? null, org_role_id ?? null, title_id ?? null,
           is_enabled ? 1 : 0, id],
        );
        setUserRegions(id, placement.regionIds);
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('UNIQUE'))
        return next(createError('That email is already in use', 409));
      throw e;
    }
    const [user] = query<UserRow & Record<string, unknown>>(`${USER_SELECT} WHERE u.id = ?`, [id]);
    res.json({ user: sanitiseUser(user) });
  } catch (err) { next(err); }
});

usersRouter.post('/:id/reset-password', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<UserRow>('SELECT id FROM users WHERE id = ?', [id]);
    if (!existing) return next(createError('User not found', 404));
    const temp = generateTempPassword();
    const hashed = await bcrypt.hash(temp, 12);
    execute(
      `UPDATE users SET password=?, temp_password=?, is_first_login=1, updated_at=datetime('now') WHERE id=?`,
      [hashed, temp, id],
    );
    res.json({ temp_password: temp });
  } catch (err) { next(err); }
});

// ── Personnel bulk import ─────────────────────────────────────────────────────
// CSV: first_name,last_name,national_id,id_type,email,facility_code,department_code,role_code,title_code
// Validates ALL rows before writing (fail + rollback on any error).

usersRouter.post('/import', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { csv } = req.body as { csv?: string };
    if (!csv) return next(createError('csv is required', 400));
    const { headers, rows } = parseCsv(csv);
    const ci = (h: string) => headers.indexOf(h);
    const required = ['first_name', 'last_name', 'national_id', 'id_type', 'email'];
    const missingHeaders = required.filter((h) => ci(h) === -1);
    if (missingHeaders.length)
      return next(createError(`CSV missing required columns: ${missingHeaders.join(', ')}`, 400));

    interface PreparedUser {
      first_name: string; last_name: string; national_id: string; id_type: string;
      email: string; user_name: string; hashed: string; temp: string;
      role: string; facility_id: number | null; department_id: number | null;
      org_role_id: number | null; title_id: number | null;
    }

    const errors: { row: number; message: string }[] = [];
    const prepared: PreparedUser[] = [];
    let skipped = 0;
    const seenEmails = new Set<string>();
    const seenIds = new Set<string>();
    const seenUsernames = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // 1-based + header
      const get = (h: string) => (ci(h) >= 0 ? rows[i][ci(h)]?.trim() ?? '' : '');

      const first_name = get('first_name');
      const last_name  = get('last_name');
      const national_id = get('national_id');
      const id_type    = get('id_type');
      const email      = get('email').toLowerCase();

      if (!first_name || !last_name || !national_id || !id_type || !email) {
        errors.push({ row: rowNum, message: 'Missing required field (first_name, last_name, national_id, id_type, email)' });
        continue;
      }

      // Intra-CSV duplicates — skip silently
      if (seenEmails.has(email) || seenIds.has(`${national_id}:${id_type}`)) { skipped++; continue; }
      seenEmails.add(email);
      seenIds.add(`${national_id}:${id_type}`);

      // DB duplicates — skip silently (idempotent re-upload)
      if (query('SELECT id FROM users WHERE email = ?', [email]).length ||
          query('SELECT id FROM users WHERE national_id = ? AND id_type = ?', [national_id, id_type]).length)
        { skipped++; continue; }

      // Reference lookups (optional fields)
      let facility_id: number | null = null;
      const facilityCode = get('facility_code');
      if (facilityCode) {
        const [f] = query<{ id: number }>('SELECT id FROM facilities WHERE code = ? COLLATE NOCASE', [facilityCode]);
        if (!f) { errors.push({ row: rowNum, message: `facility_code not found: ${facilityCode}` }); continue; }
        facility_id = f.id;
      }

      let department_id: number | null = null;
      const deptCode = get('department_code');
      if (deptCode) {
        const [d] = query<{ id: number }>('SELECT id FROM departments WHERE code = ? COLLATE NOCASE', [deptCode]);
        if (!d) { errors.push({ row: rowNum, message: `department_code not found: ${deptCode}` }); continue; }
        department_id = d.id;
      }

      let org_role_id: number | null = null;
      const roleCode = get('role_code');
      if (roleCode) {
        const [r] = query<{ id: number }>('SELECT id FROM org_roles WHERE code = ? COLLATE NOCASE', [roleCode]);
        if (!r) { errors.push({ row: rowNum, message: `role_code not found: ${roleCode}` }); continue; }
        org_role_id = r.id;
      }

      let title_id: number | null = null;
      const titleCode = get('title_code');
      if (titleCode) {
        const [t] = query<{ id: number }>('SELECT id FROM user_titles WHERE code = ? COLLATE NOCASE', [titleCode]);
        if (!t) { errors.push({ row: rowNum, message: `title_code not found: ${titleCode}` }); continue; }
        title_id = t.id;
      }

      // Generate username (account for others being generated in this batch)
      let user_name = `${first_name.toLowerCase()}.${last_name.toLowerCase()}`.replace(/[^a-z0-9.]/g, '');
      if (seenUsernames.has(user_name) || query('SELECT id FROM users WHERE user_name = ?', [user_name]).length) {
        let suffix = 2;
        while (seenUsernames.has(`${user_name}_${suffix}`) || query('SELECT id FROM users WHERE user_name = ?', [`${user_name}_${suffix}`]).length)
          suffix++;
        user_name = `${user_name}_${suffix}`;
      }
      seenUsernames.add(user_name);

      const temp = generateTempPassword();
      const hashed = await bcrypt.hash(temp, 12);
      prepared.push({ first_name, last_name, national_id, id_type, email, user_name, hashed, temp,
                      role: 'staff', facility_id, department_id, org_role_id, title_id });
    }

    // Fail if any row had errors — do not write anything
    if (errors.length) {
      res.status(422).json({ error: `Import failed with ${errors.length} error(s)`, errors });
      return;
    }

    // All valid — write in a transaction
    const credentials = transaction(() => {
      const creds: { user_name: string; temp_password: string }[] = [];
      for (const u of prepared) {
        execute(
          `INSERT INTO users (first_name, last_name, national_id, id_type, email, user_name, password,
             role, facility_id, department_id, org_role_id, title_id, temp_password)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [u.first_name, u.last_name, u.national_id, u.id_type, u.email, u.user_name, u.hashed,
           u.role, u.facility_id, u.department_id, u.org_role_id, u.title_id, u.temp],
        );
        creds.push({ user_name: u.user_name, temp_password: u.temp });
      }
      return creds;
    });

    res.status(201).json({ imported: prepared.length, skipped, credentials });
  } catch (err) { next(err); }
});

// ── Mount sub-routers ─────────────────────────────────────────────────────────

router.use('/regions',     regionsRouter);
router.use('/districts',   districtsRouter);
router.use('/departments', departmentsRouter);
router.use('/facilities',  facilitiesRouter);
router.use('/org-roles',   orgRolesRouter);
router.use('/user-titles', userTitlesRouter);
router.use('/users',       usersRouter);
router.use('/setup',       setupRouter);

// ── Reviews (admin-only approval queue for completed submissions) ────────────

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

router.get('/reviews', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = (req.query.status as string | undefined) ?? 'pending';
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
      return next(createError('Invalid status filter', 400));
    }
    const limit  = Math.min(Number(req.query.limit ?? 100), 500);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    const whereParts: string[] = ["ua.status = 'completed'"];
    const params: (string | number)[] = [];
    if (status !== 'all') { whereParts.push('ua.review_status = ?'); params.push(status); }

    const rows = query<ReviewListRow>(
      `SELECT ua.id, ua.user_id,
              (u.first_name || ' ' || u.last_name) AS full_name,
              f.name AS facility_name, d.name AS department_name,
              ua.domain_code, ua.domain_name, ua.completed_at, ua.review_status,
              (SELECT AVG(CASE WHEN r.response_level > 0 THEN r.response_level END)
                 FROM user_assessment_responses r
                WHERE r.user_assessment_id = ua.id) AS avg_level
       FROM user_assessments ua
       INNER JOIN users u ON u.id = ua.user_id
       LEFT JOIN facilities  f ON f.id = u.facility_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE ${whereParts.join(' AND ')}
       ORDER BY ua.completed_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({ reviews: rows });
  } catch (err) { next(err); }
});

router.post('/reviews/:id/approve', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const { notes } = req.body as { notes?: string | null };
    const [existing] = query<{ id: number }>(
      "SELECT id FROM user_assessments WHERE id = ? AND status = 'completed'",
      [id],
    );
    if (!existing) return next(createError('Submission not found', 404));
    execute(
      `UPDATE user_assessments
       SET review_status = 'approved',
           reviewed_by   = ?,
           reviewed_at   = datetime('now'),
           review_notes  = ?
       WHERE id = ?`,
      [req.session.userId!, notes ?? null, id],
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/reviews/:id/reject', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const { notes } = req.body as { notes?: string };
    if (!notes || !notes.trim()) {
      return next(createError('Rejection notes are required', 400));
    }
    const [existing] = query<{ id: number }>(
      "SELECT id FROM user_assessments WHERE id = ? AND status = 'completed'",
      [id],
    );
    if (!existing) return next(createError('Submission not found', 404));
    execute(
      `UPDATE user_assessments
       SET review_status = 'rejected',
           reviewed_by   = ?,
           reviewed_at   = datetime('now'),
           review_notes  = ?
       WHERE id = ?`,
      [req.session.userId!, notes.trim(), id],
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
