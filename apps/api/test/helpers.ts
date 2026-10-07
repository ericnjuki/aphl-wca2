import express from 'express';
import * as ExcelJS from 'exceljs';
import { getDb, execute, query } from '../src/db/database';
import { runMigrations } from '../src/db/migrations';
import adminRouter from '../src/routes/admin';
import reportsRouter from '../src/routes/reports';
import surveyRouter from '../src/routes/survey';
import myAssessmentsRouter from '../src/routes/my-assessments';
import authRouter from '../src/routes/auth';
import assessmentsRouter from '../src/routes/assessments';
import { workbookToBuffer } from '../src/lib/workbook/xlsx';
import { errorHandler } from '../src/middleware/errorHandler';

export async function initTestDb(): Promise<void> {
  const db = await getDb();
  await runMigrations(db);
}

const TABLES = [
  'user_regions', 'user_assessment_responses', 'user_assessments', 'facility_departments',
  'facilities', 'districts', 'regions', 'departments', 'users', 'org_roles', 'user_titles',
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
  app.use('/assessments', assessmentsRouter);
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

export function createUser(opts: {
  role?: 'admin' | 'staff' | 'monitor';
  facilityId?: number | null;
  departmentId?: number | null;
  orgRoleId?: number | null;
  titleId?: number | null;
  email?: string;
  firstName?: string;
  lastName?: string;
  nationalId?: string;
  idType?: string;
  enabled?: boolean;
} = {}): number {
  seq++;
  const email = opts.email ?? `u${seq}@example.test`;
  execute(
    `INSERT INTO users (email, first_name, last_name, national_id, id_type, user_name, password, role, is_first_login,
       is_enabled, facility_id, department_id, org_role_id, title_id)
     VALUES (?, ?, ?, ?, ?, ?, 'x', ?, 0, ?, ?, ?, ?, ?)`,
    [email, opts.firstName ?? 'Test', opts.lastName ?? `User${seq}`, opts.nationalId ?? `N${seq}`, opts.idType ?? 'NIN',
     `user${seq}`, opts.role ?? 'staff', opts.enabled === false ? 0 : 1, opts.facilityId ?? null,
     opts.departmentId ?? null, opts.orgRoleId ?? null, opts.titleId ?? null],
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


export function createOrgRole(code: string, name: string): number {
  execute('INSERT INTO org_roles (code, name) VALUES (?, ?)', [code, name]);
  const [row] = query<{ id: number }>('SELECT id FROM org_roles WHERE code = ? COLLATE NOCASE', [code]);
  return row?.id ?? 0;
}

export function createTitle(code: string, name: string): number {
  execute('INSERT INTO user_titles (code, name) VALUES (?, ?)', [code, name]);
  const [row] = query<{ id: number }>('SELECT id FROM user_titles WHERE code = ? COLLATE NOCASE', [code]);
  return row?.id ?? 0;
}

// ── Workbook fixtures ─────────────────────────────────────────────────────────

/** Tab name → rows (first row is the header). */
export type SheetData = Record<string, (string | number | null)[][]>;

export async function buildWorkbook(sheets: SheetData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const r of rows) ws.addRow(r);
  }
  return workbookToBuffer(wb);
}

/** supertest `.buffer(true).parse(binaryParser)` → `res.body` is a Buffer. */
export function binaryParser(res: NodeJS.ReadableStream, callback: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

export const USERS_HEADER = [
  'email', 'first_name', 'last_name', 'national_id', 'id_type', 'system_role', 'facility_code',
  'department_code', 'org_role_code', 'title_code', 'region_codes', 'status',
];

/** The Users-tab row (USERS_HEADER order) that leaves this user unchanged. */
export function userSheetRow(id: number): string[] {
  const [u] = query<Record<string, string | number | null>>(
    `SELECT u.email, u.first_name, u.last_name, u.national_id, u.id_type, u.role, u.is_enabled,
            f.code AS facility_code, d.code AS department_code, r.code AS org_role_code, t.code AS title_code,
            (SELECT GROUP_CONCAT(rg.code, ';') FROM user_regions ur JOIN regions rg ON rg.id = ur.region_id
              WHERE ur.user_id = u.id) AS region_codes
     FROM users u
     LEFT JOIN facilities  f ON f.id = u.facility_id
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN org_roles   r ON r.id = u.org_role_id
     LEFT JOIN user_titles t ON t.id = u.title_id
     WHERE u.id = ?`,
    [id],
  );
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return [
    s(u.email), s(u.first_name), s(u.last_name), s(u.national_id), s(u.id_type), s(u.role), s(u.facility_code),
    s(u.department_code), s(u.org_role_code), s(u.title_code), s(u.region_codes), u.is_enabled ? 'active' : 'disabled',
  ];
}
