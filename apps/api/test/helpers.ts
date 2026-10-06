import express from 'express';
import { getDb, execute, query } from '../src/db/database';
import { runMigrations } from '../src/db/migrations';
import adminRouter from '../src/routes/admin';
import reportsRouter from '../src/routes/reports';
import surveyRouter from '../src/routes/survey';
import myAssessmentsRouter from '../src/routes/my-assessments';
import authRouter from '../src/routes/auth';
import { errorHandler } from '../src/middleware/errorHandler';

export async function initTestDb(): Promise<void> {
  const db = await getDb();
  await runMigrations(db);
}

const TABLES = [
  'user_regions', 'user_assessment_responses', 'user_assessments', 'facility_departments',
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
  app.use('/survey', surveyRouter);
  app.use('/my-assessments', myAssessmentsRouter);
  app.use('/auth', authRouter);
  app.use(errorHandler);
  return app;
}

export const asUser = (id: number) => ({ 'x-test-user': String(id) });

let seq = 0;

export function createRegion(code: string, name: string): number {
  execute('INSERT INTO regions (code, name) VALUES (?, ?)', [code, name]);
  const [row] = query<{ id: number }>('SELECT id FROM regions WHERE code = ? COLLATE NOCASE', [code]);
  return row?.id ?? 0;
}

export function createDistrict(code: string, name: string, regionId: number): number {
  execute('INSERT INTO districts (code, name, region_id) VALUES (?, ?, ?)', [code, name, regionId]);
  const [row] = query<{ id: number }>('SELECT id FROM districts WHERE code = ? COLLATE NOCASE', [code]);
  return row?.id ?? 0;
}

export function createFacility(
  code: string,
  name: string,
  opts: { regionId?: number | null; districtId?: number | null } = {},
): number {
  execute(
    'INSERT INTO facilities (code, name, region_id, district_id) VALUES (?, ?, ?, ?)',
    [code, name, opts.regionId ?? null, opts.districtId ?? null],
  );
  const [row] = query<{ id: number }>('SELECT id FROM facilities WHERE code = ? COLLATE NOCASE', [code]);
  return row?.id ?? 0;
}

export function createDepartment(code: string, name: string, facilityIds: number[] = []): number {
  execute('INSERT INTO departments (code, name) VALUES (?, ?)', [code, name]);
  const [row] = query<{ id: number }>('SELECT id FROM departments WHERE code = ? COLLATE NOCASE', [code]);
  const id = row?.id ?? 0;
  for (const f of facilityIds) {
    execute('INSERT INTO facility_departments (facility_id, department_id) VALUES (?, ?)', [f, id]);
  }
  return id;
}

export function createUser(opts: { role?: 'admin' | 'staff' | 'monitor'; facilityId?: number | null } = {}): number {
  seq++;
  const email = `u${seq}@example.test`;
  execute(
    `INSERT INTO users (email, first_name, last_name, national_id, id_type, user_name, password, role, is_first_login, facility_id)
     VALUES (?, 'Test', ?, ?, 'NIN', ?, 'x', ?, 0, ?)`,
    [email, `User${seq}`, `N${seq}`, `user${seq}`, opts.role ?? 'staff', opts.facilityId ?? null],
  );
  const [row] = query<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
  return row?.id ?? 0;
}

// One completed + approved session with a single response row.
export function addResponse(opts: {
  userId: number;
  facilityId?: number | null;
  regionId?: number | null;
  districtId?: number | null;
  departmentId?: number | null;
  level?: number;
}): number {
  execute(
    `INSERT INTO user_assessments (user_id, domain_code, domain_name, status, review_status)
     VALUES (?, 'LAB', 'Lab', 'completed', 'approved')`,
    [opts.userId],
  );
  const [ua] = query<{ id: number }>(
    `SELECT id FROM user_assessments WHERE user_id = ? AND domain_code = 'LAB' AND status = 'completed' ORDER BY id DESC LIMIT 1`,
    [opts.userId],
  );
  const uaId = ua?.id ?? 0;

  execute(
    `INSERT INTO user_assessment_responses
       (user_assessment_id, user_id, domain_code, competency_value, subcompetency_value,
        response_level, facility_id, region_id, district_id, department_id)
     VALUES (?, ?, 'LAB', '1', '1.01', ?, ?, ?, ?, ?)`,
    [uaId, opts.userId, opts.level ?? 2, opts.facilityId ?? null, opts.regionId ?? null, opts.districtId ?? null,
     opts.departmentId ?? null],
  );
  const [resp] = query<{ id: number }>(
    `SELECT id FROM user_assessment_responses WHERE user_assessment_id = ? ORDER BY id DESC LIMIT 1`,
    [uaId],
  );
  return resp?.id ?? 0;
}

export function assignRegions(userId: number, regionIds: number[]): void {
  for (const rid of regionIds) {
    execute('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)', [userId, rid]);
  }
}

