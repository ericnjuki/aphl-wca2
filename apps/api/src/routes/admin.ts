import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { SqlValue } from 'sql.js';
import { query, execute, transaction } from '../db/database';
import { requireAuth, requirePasswordChanged, requireAdmin, requireRole } from '../middleware/auth';
import { getScope } from '../lib/report-scope';
import { ROLES, FACILITY_ROLES, USER_MANAGER_ROLES, isRole, isFacilityRole, type Role } from '../lib/roles';
import { createError } from '../middleware/errorHandler';
import districtsRouter from './admin-districts';
import { resolveDistrict, backfillResponseDistrict, withRegions } from '../lib/org';
import { generateTempPassword, generateUsername } from '../lib/credentials';
import setupRouter from './admin-setup';
import reviewsRouter from './reviews';
import { assertNoHistory, type HistoryTable } from '../lib/history';
import { REGION, DISTRICT, COORDINATOR } from '../lib/org-labels';

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
  // Invariant 4 — FKs aren't enforced, so check here. County coordinators count too.
  beforeDelete: (id) => {
    const [{ n }] = query<{ n: number }>('SELECT COUNT(*) AS n FROM districts WHERE region_id = ?', [id]);
    if (n > 0) return `${n} ${n === 1 ? `${DISTRICT.lower} is` : `${DISTRICT.lowerMany} are`} still assigned to this ${REGION.lower}`;
    const [{ m }] = query<{ m: number }>('SELECT COUNT(*) AS m FROM user_regions WHERE region_id = ?', [id]);
    return m > 0 ? `${m} ${COORDINATOR.county.toLowerCase()}${m === 1 ? ' is' : 's are'} still assigned to this ${REGION.lower}` : null;
  },
});

// ── Departments ───────────────────────────────────────────────────────────────

const departmentsRouter = makeCrudRouter({ table: 'departments', fields: ['code', 'name'] });

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
    if (!district) return next(createError(`district_id is required and must reference an existing ${DISTRICT.lower}`, 400));
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
    if (!district) return next(createError(`district_id is required and must reference an existing ${DISTRICT.lower}`, 400));
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

// ── Org roles ─────────────────────────────────────────────────────────────────

const orgRolesRouter = makeCrudRouter({ table: 'org_roles', fields: ['code', 'name'] });

// ── User titles ───────────────────────────────────────────────────────────────

const userTitlesRouter = makeCrudRouter({ table: 'user_titles', fields: ['code', 'name'] });

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

// ── Placement per role (plans/2026-11-12-role-model.md) ───────────────────────
//   admin           optional facility placement (unchanged), no county/sub-county
//   national        no placement at all
//   county          exactly one region (user_regions), no facility placement
//   subcounty       exactly one district (user_districts), no facility placement
//   facility_admin  a facility (required) and optional department/org role/title
//   staff           optional facility/department/org role/title
// FKs aren't enforced, so only county/subcounty users may have rows in
// user_regions / user_districts.

type FacilityFields = { facility_id: unknown; department_id: unknown; org_role_id: unknown; title_id: unknown };

const ROLE_ERROR = `role must be one of: ${ROLES.join(', ')}`;
const NO_FACILITY_ROLES: readonly Role[] = ['national', 'county', 'subcounty'];

function idList(raw: unknown, name: string): number[] | { error: string } {
  const ids = raw ?? [];
  if (!Array.isArray(ids) || !ids.every((v) => Number.isInteger(v)))
    return { error: `${name} must be an array of ids` };
  return [...new Set(ids as number[])];
}

function validatePlacement(
  role: Role, fields: FacilityFields, rawRegionIds: unknown, rawDistrictIds: unknown,
): { regionIds: number[]; districtIds: number[] } | { error: string } {
  const regionIds = idList(rawRegionIds, 'region_ids');
  if ('error' in regionIds) return regionIds;
  const districtIds = idList(rawDistrictIds, 'district_ids');
  if ('error' in districtIds) return districtIds;

  if (role !== 'county' && regionIds.length > 0)
    return { error: `Only ${COORDINATOR.county.toLowerCase()}s can be assigned a ${REGION.lower} (region_ids)` };
  if (role !== 'subcounty' && districtIds.length > 0)
    return { error: `Only ${COORDINATOR.subcounty.toLowerCase()}s can be assigned a ${DISTRICT.lower} (district_ids)` };
  if (NO_FACILITY_ROLES.includes(role) && Object.values(fields).some((v) => v != null))
    return { error: `National users and ${REGION.lower}/${DISTRICT.lower} coordinators cannot have a facility, department, org role or title` };
  if (role === 'facility_admin' && fields.facility_id == null)
    return { error: 'Facility admins need a facility' };

  if (role === 'county') {
    if (regionIds.length !== 1) return { error: `${COORDINATOR.county}s need exactly one ${REGION.lower} (region_ids)` };
    if (!query('SELECT id FROM regions WHERE id = ?', [regionIds[0]]).length) return { error: `Unknown ${REGION.lower} in region_ids` };
  }
  if (role === 'subcounty') {
    if (districtIds.length !== 1) return { error: `${COORDINATOR.subcounty}s need exactly one ${DISTRICT.lower} (district_ids)` };
    if (!query('SELECT id FROM districts WHERE id = ?', [districtIds[0]]).length) return { error: `Unknown ${DISTRICT.lower} in district_ids` };
  }
  return { regionIds, districtIds };
}

function setUserOrgUnits(userId: number, regionIds: number[], districtIds: number[]): void {
  execute('DELETE FROM user_regions WHERE user_id = ?', [userId]);
  for (const rid of regionIds) execute('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)', [userId, rid]);
  execute('DELETE FROM user_districts WHERE user_id = ?', [userId]);
  for (const did of districtIds) execute('INSERT INTO user_districts (user_id, district_id) VALUES (?, ?)', [userId, did]);
}

// ── Facility-admin limits ────────────────────────────────────────────────────
// Facility admins manage facility-role users (staff, facility admins) in their
// own facility only. They cannot move a user to another facility, give any
// other role, enable/disable a user, or change their own role. Everything else
// (admin, national, county, subcounty) is created by admin only.

interface Caller { id: number; role: Role; facilityId: number | null }

function caller(req: Request): Caller {
  const s = getScope(req.session.userId!);
  return { id: s.userId, role: s.role, facilityId: s.facilityId };
}

/** Null if the caller may manage `target`, else a 404/403-worthy reason. */
function manageDeny(c: Caller, target: { role: string; facility_id: number | null }): string | null {
  if (c.role === 'admin') return null;
  if (c.facilityId == null || target.facility_id !== c.facilityId || !isFacilityRole(target.role))
    return 'Facility admins may only manage staff and facility admins in their facility';
  return null;
}

const FACILITY_ADMIN_ROLE_ERROR = 'Facility admins may only give the staff or facility admin role';

usersRouter.use(requireRole(...USER_MANAGER_ROLES));

usersRouter.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const c = caller(req);
    const users = c.role === 'admin'
      ? query<UserRow & Record<string, unknown>>(`${USER_SELECT} ORDER BY u.last_name, u.first_name`)
      : query<UserRow & Record<string, unknown>>(
          `${USER_SELECT} WHERE u.facility_id = ? AND u.role IN (${FACILITY_ROLES.map(() => '?').join(',')})
           ORDER BY u.last_name, u.first_name`,
          [c.facilityId, ...FACILITY_ROLES],
        );
    res.json({ users: users.map(sanitiseUser) });
  } catch (err) { next(err); }
});

usersRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const c = caller(req);
    const body = req.body as Partial<UserRow> & { region_ids?: unknown; district_ids?: unknown };
    const { first_name, last_name, national_id, id_type, email,
            department_id, org_role_id, title_id, role = 'staff' } = body;
    let { facility_id } = body;
    if (!first_name || !last_name || !national_id || !id_type || !email)
      return next(createError('first_name, last_name, national_id, id_type, email are required', 400));
    if (!isRole(role)) return next(createError(ROLE_ERROR, 400));
    if (c.role === 'facility_admin') {
      if (!isFacilityRole(role)) return next(createError(FACILITY_ADMIN_ROLE_ERROR, 403));
      if (facility_id != null && facility_id !== c.facilityId)
        return next(createError('Facility admins may only add users to their own facility', 403));
      facility_id = c.facilityId;
    }
    const placement = validatePlacement(
      role, { facility_id, department_id, org_role_id, title_id }, body.region_ids, body.district_ids,
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
        setUserOrgUnits(created.id, placement.regionIds, placement.districtIds);
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

usersRouter.put('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const c = caller(req);
    const id = Number(req.params.id);
    const [existing] = query<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) return next(createError('User not found', 404));
    const deny = manageDeny(c, existing);
    if (deny) return next(createError(deny, 403));
    const body = req.body as Partial<UserRow> & { region_ids?: unknown; district_ids?: unknown };
    const {
      first_name = existing.first_name, last_name = existing.last_name,
      email = existing.email, role = existing.role,
      facility_id = existing.facility_id, department_id = existing.department_id,
      org_role_id = existing.org_role_id, title_id = existing.title_id,
      is_enabled = existing.is_enabled,
    } = body;
    if (!isRole(role)) return next(createError(ROLE_ERROR, 400));
    if (c.role === 'facility_admin') {
      if (!isFacilityRole(role)) return next(createError(FACILITY_ADMIN_ROLE_ERROR, 403));
      if (id === c.id && role !== existing.role) return next(createError('You cannot change your own role', 403));
      if (facility_id !== existing.facility_id) return next(createError('Only an admin can move a user to another facility', 403));
      if (Boolean(is_enabled) !== Boolean(existing.is_enabled)) return next(createError('Only an admin can enable or disable users', 403));
    }
    // Omitted region_ids / district_ids keep the current assignment while the role keeps using it.
    const current = (sql: string) => query<{ v: number }>(sql, [id]).map((r) => r.v);
    const regionInput = body.region_ids !== undefined ? body.region_ids
      : role === 'county' ? current('SELECT region_id AS v FROM user_regions WHERE user_id = ?') : [];
    const districtInput = body.district_ids !== undefined ? body.district_ids
      : role === 'subcounty' ? current('SELECT district_id AS v FROM user_districts WHERE user_id = ?') : [];
    const placement = validatePlacement(role, { facility_id, department_id, org_role_id, title_id }, regionInput, districtInput);
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
        setUserOrgUnits(id, placement.regionIds, placement.districtIds);
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

usersRouter.post('/:id/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<UserRow>('SELECT id, role, facility_id FROM users WHERE id = ?', [id]);
    if (!existing) return next(createError('User not found', 404));
    const deny = manageDeny(caller(req), existing);
    if (deny) return next(createError(deny, 403));
    const temp = generateTempPassword();
    const hashed = await bcrypt.hash(temp, 12);
    execute(
      `UPDATE users SET password=?, temp_password=?, is_first_login=1, updated_at=datetime('now') WHERE id=?`,
      [hashed, temp, id],
    );
    res.json({ temp_password: temp });
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
router.use('/reviews',     reviewsRouter);

export default router;
