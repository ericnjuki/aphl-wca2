import express from 'express';
import { getDb, execute } from '../src/db/database';
import { runMigrations } from '../src/db/migrations';
import adminRouter from '../src/routes/admin';
import reportsRouter from '../src/routes/reports';
import { errorHandler } from '../src/middleware/errorHandler';

export async function initTestDb(): Promise<void> {
  const db = await getDb();
  await runMigrations(db);
}

const TABLES = [
  'user_assessment_responses', 'user_assessments', 'facility_departments',
  'facilities', 'districts', 'regions', 'departments', 'users',
];

export function resetDb(): void {
  for (const t of TABLES) execute(`DELETE FROM ${t}`);
}

// Minimal app: a fake session taken from the x-test-user header replaces
// express-session so tests can act as any user.
export function testApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.header('x-test-user');
    (req as unknown as { session: Record<string, unknown> }).session = uid ? { userId: Number(uid) } : {};
    next();
  });
  app.use('/admin', adminRouter);
  app.use('/reports', reportsRouter);
  app.use(errorHandler);
  return app;
}

export const asUser = (id: number) => ({ 'x-test-user': String(id) });

let seq = 0;

export function createRegion(code: string, name: string): number {
  return execute('INSERT INTO regions (code, name) VALUES (?, ?)', [code, name]).lastInsertRowid;
}

export function createDistrict(code: string, name: string, regionId: number): number {
  return execute('INSERT INTO districts (code, name, region_id) VALUES (?, ?, ?)', [code, name, regionId]).lastInsertRowid;
}

export function createFacility(
  code: string,
  name: string,
  opts: { regionId?: number | null; districtId?: number | null } = {},
): number {
  return execute(
    'INSERT INTO facilities (code, name, region_id, district_id) VALUES (?, ?, ?, ?)',
    [code, name, opts.regionId ?? null, opts.districtId ?? null],
  ).lastInsertRowid;
}

export function createUser(opts: { role?: 'admin' | 'staff'; facilityId?: number | null } = {}): number {
  seq++;
  return execute(
    `INSERT INTO users (email, first_name, last_name, national_id, id_type, user_name, password, role, is_first_login, facility_id)
     VALUES (?, 'Test', ?, ?, 'NIN', ?, 'x', ?, 0, ?)`,
    [`u${seq}@example.test`, `User${seq}`, `N${seq}`, `user${seq}`, opts.role ?? 'staff', opts.facilityId ?? null],
  ).lastInsertRowid;
}

// One completed + approved session with a single response row.
export function addResponse(opts: {
  userId: number;
  facilityId?: number | null;
  regionId?: number | null;
  districtId?: number | null;
  level?: number;
}): number {
  const uaId = execute(
    `INSERT INTO user_assessments (user_id, domain_code, domain_name, status, review_status)
     VALUES (?, 'LAB', 'Lab', 'completed', 'approved')`,
    [opts.userId],
  ).lastInsertRowid;
  return execute(
    `INSERT INTO user_assessment_responses
       (user_assessment_id, user_id, domain_code, competency_value, subcompetency_value,
        response_level, facility_id, region_id, district_id)
     VALUES (?, ?, 'LAB', '1', '1.01', ?, ?, ?, ?)`,
    [uaId, opts.userId, opts.level ?? 2, opts.facilityId ?? null, opts.regionId ?? null, opts.districtId ?? null],
  ).lastInsertRowid;
}
