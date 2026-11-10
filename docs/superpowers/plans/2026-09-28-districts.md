# Districts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add District as a full org-hierarchy level (Region → District → Facility) with setup UI, CSV import, response snapshotting, a District report level, drill-down, breadcrumbs, exports and staff scoping.

**Architecture:** New `districts` table; `facilities.district_id` is required by the API and `facilities.region_id` becomes a server-maintained copy of the district's region, so every existing region query keeps working. `user_assessment_responses.district_id` is snapshotted on completion and back-filled (NULLs only) when a facility is assigned a district. Referential rules are enforced in API code because SQLite foreign keys are not enabled in this codebase.

**Tech Stack:** Express 5 + sql.js (SQLite) API in TypeScript (CommonJS); React + Vite + TanStack Query + shadcn/ui web app; vitest (+ supertest for the API, new).

**Spec:** `docs/superpowers/specs/2026-09-28-districts-design.md`

## Global Constraints

- Monorepo, pnpm 10. Package names: `@workforce-competency/api`, `@workforce-competency/web`.
- New migration id is **9** (last existing is 8). Never edit earlier migrations.
- `PRAGMA foreign_keys` stays OFF — enforce every referential rule in code.
- Invariant 1: saving a facility with `district_id = D` sets `facilities.region_id = districts.region_id` of `D`.
- Invariant 2: changing a district's `region_id` updates `region_id` on all its facilities.
- Invariant 3: a district cannot be deleted while any facility references it (409).
- Invariant 4: a region cannot be deleted while any district references it (409).
- Response backfill only ever fills `user_assessment_responses.district_id` where it IS NULL.
- Codes are upper-cased on write; lookups use `COLLATE NOCASE`.
- API tests live in `apps/api/test/` (outside `src/`, so the `tsc` build never compiles them).
- Match surrounding code style: section banners `// ── Name ───`, `try { … } catch (err) { next(err); }` in handlers, `createError(msg, status)`.

---

## File Map

**API**
- Create `apps/api/vitest.config.ts`, `apps/api/test/setup-env.ts`, `apps/api/test/helpers.ts` — test harness.
- Modify `apps/api/package.json` — `test` script, vitest/supertest devDeps.
- Modify `apps/api/src/db/migrations.ts` — migration 9.
- Create `apps/api/src/lib/org.ts` — org-context lookup, district resolution, region sync, response backfill.
- Modify `apps/api/src/routes/survey.ts`, `apps/api/src/scripts/backfill-responses.ts` — use `getOrgContext`, write `district_id`.
- Create `apps/api/src/routes/admin-districts.ts` — districts CRUD + import.
- Modify `apps/api/src/routes/admin.ts` — mount districts, region delete guard, facilities district handling + import.
- Modify `apps/api/src/lib/report-scope.ts` — `districtId`, `district` level.
- Modify `apps/api/src/routes/reports.ts` — district endpoint, region endpoint by district, facility district fields.

**Web**
- Modify `apps/web/src/types/reports.ts` — district types, `AnyReport`.
- Modify `apps/web/src/lib/reports/export-excel.ts`, `export-pdf.ts`, `components/reports/ExportMenu.tsx` — district cases, shared `AnyReport`.
- Create `apps/web/src/lib/reports/export-excel.test.ts`.
- Modify `apps/web/src/hooks/reports/useReportQueries.ts`, `apps/web/src/main.tsx`, `apps/web/src/pages/ReportsPage.tsx`, `components/reports/UnassignedBanner.tsx`, `components/reports/levels/RegionReport.tsx`.
- Create `apps/web/src/components/reports/levels/DistrictReport.tsx`.
- Create `apps/web/src/lib/setup/districts.ts` + `districts.test.ts` — grouping + import-result formatting.
- Create `apps/web/src/components/setup/ImportDialog.tsx` (moved out of SetupPage), `apps/web/src/components/setup/DistrictsTab.tsx`.
- Modify `apps/web/src/pages/SetupPage.tsx` — Districts tab, facility District select.
- Create `apps/web/public/data/districts.csv`; modify `apps/web/public/data/facilities.csv`.

**Docs**
- Modify `apps/web/src/docs/1.0.0/{setup,reports,getting-started,users}.md`, `README.md`, `apps/web/README.md`.

---

### Task 1: API test harness + migration 9

**Files:**
- Create: `apps/api/vitest.config.ts`, `apps/api/test/setup-env.ts`, `apps/api/test/helpers.ts`, `apps/api/test/migration.test.ts`
- Modify: `apps/api/package.json`, `apps/api/src/db/migrations.ts` (append after the `id: 8` entry, before the closing `];`)

**Interfaces:**
- Produces (in `test/helpers.ts`): `initTestDb(): Promise<void>`, `resetDb(): void`, `testApp(): express.Express`, `asUser(id: number): { 'x-test-user': string }`, `createRegion(code, name): number`, `createDistrict(code, name, regionId): number`, `createFacility(code, name, opts?: { regionId?: number|null; districtId?: number|null }): number`, `createUser(opts?: { role?: 'admin'|'staff'; facilityId?: number|null }): number`, `addResponse(opts: { userId: number; facilityId?: number|null; regionId?: number|null; districtId?: number|null; level?: number }): number`.

- [ ] **Step 1: Add dev dependencies and test script**

```bash
pnpm --filter @workforce-competency/api add -D vitest@^3.0.0 supertest@^7.1.0 @types/supertest@^6.0.2
```

In `apps/api/package.json` `scripts`, add after `"typecheck"`:

```json
    "test": "vitest run",
```

- [ ] **Step 2: Create `apps/api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

// API integration tests. Each test file runs in its own module registry, so the
// sql.js singleton in src/db/database.ts is fresh per file; setup-env points it
// at a throwaway DB file.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup-env.ts'],
    pool: 'forks',
  },
});
```

- [ ] **Step 3: Create `apps/api/test/setup-env.ts`**

```ts
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Must run before src/config/env.ts is imported. dotenv never overrides
// variables that are already set, so these win over apps/api/.env.
process.env.DB_PATH = path.join(os.tmpdir(), `wca-test-${crypto.randomUUID()}.db`);
process.env.NODE_ENV = 'test';
```

- [ ] **Step 4: Create `apps/api/test/helpers.ts`**

```ts
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
```

- [ ] **Step 5: Write the failing migration test** — `apps/api/test/migration.test.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../src/db/database';
import { initTestDb } from './helpers';

const columns = (table: string) =>
  query<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);

describe('migration 9 — districts', () => {
  beforeAll(initTestDb);

  it('creates the districts table', () => {
    expect(columns('districts')).toEqual(
      expect.arrayContaining(['id', 'code', 'name', 'region_id', 'created_at', 'updated_at']),
    );
  });

  it('adds district_id to facilities and user_assessment_responses', () => {
    expect(columns('facilities')).toContain('district_id');
    expect(columns('user_assessment_responses')).toContain('district_id');
  });

  it('indexes responses by district', () => {
    const idx = query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_uar_district'",
    );
    expect(idx).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @workforce-competency/api test`
Expected: FAIL — `no such table: districts` / columns missing.

- [ ] **Step 7: Add migration 9** to `apps/api/src/db/migrations.ts`, as a new array entry after `id: 8`:

```ts
  {
    id: 9,
    sql: `
      -- Districts sit between regions and facilities. facilities.region_id is
      -- kept as an API-maintained copy of districts.region_id so existing
      -- region queries keep working. Foreign keys are not enforced (no
      -- PRAGMA foreign_keys) — referential rules live in the API.

      CREATE TABLE IF NOT EXISTS districts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        code       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        name       TEXT    NOT NULL,
        region_id  INTEGER NOT NULL REFERENCES regions(id),
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_districts_region ON districts(region_id);

      ALTER TABLE facilities ADD COLUMN district_id INTEGER REFERENCES districts(id) ON DELETE SET NULL;

      ALTER TABLE user_assessment_responses ADD COLUMN district_id INTEGER REFERENCES districts(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_uar_district ON user_assessment_responses(district_id, domain_code, competency_value);
    `,
  },
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @workforce-competency/api test`
Expected: PASS (3 tests). Also run `pnpm --filter @workforce-competency/api typecheck` — expected clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/vitest.config.ts apps/api/test apps/api/src/db/migrations.ts
git commit -m "feat(api): districts schema (migration 9) + API test harness"
```

---

### Task 2: Org-context library + district snapshot on responses

**Files:**
- Create: `apps/api/src/lib/org.ts`, `apps/api/test/org.test.ts`
- Modify: `apps/api/src/routes/survey.ts:170-224`, `apps/api/src/scripts/backfill-responses.ts:56-86`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces (in `src/lib/org.ts`):
  - `interface OrgContext { facility_id: number|null; department_id: number|null; region_id: number|null; district_id: number|null }`
  - `getOrgContext(userId: number): OrgContext | undefined`
  - `resolveDistrict(raw: unknown): { id: number; region_id: number } | null`
  - `syncFacilitiesRegion(districtId: number, regionId: number): void` (invariant 2)
  - `backfillResponseDistrict(facilityId: number, districtId: number): void`

- [ ] **Step 1: Write the failing tests** — `apps/api/test/org.test.ts`

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/database';
import {
  getOrgContext, resolveDistrict, syncFacilitiesRegion, backfillResponseDistrict,
} from '../src/lib/org';
import {
  initTestDb, resetDb, createRegion, createDistrict, createFacility, createUser, addResponse,
} from './helpers';

describe('lib/org', () => {
  beforeAll(initTestDb);
  beforeEach(resetDb);

  it('getOrgContext includes the facility district', () => {
    const r = createRegion('DSM', 'Dar es Salaam');
    const d = createDistrict('TMK', 'Temeke', r);
    const f = createFacility('F1', 'Fac 1', { regionId: r, districtId: d });
    const u = createUser({ facilityId: f });
    expect(getOrgContext(u)).toEqual({ facility_id: f, department_id: null, region_id: r, district_id: d });
  });

  it('resolveDistrict returns id + region, or null for missing/unknown', () => {
    const r = createRegion('DSM', 'Dar es Salaam');
    const d = createDistrict('TMK', 'Temeke', r);
    expect(resolveDistrict(d)).toEqual({ id: d, region_id: r });
    expect(resolveDistrict(String(d))).toEqual({ id: d, region_id: r });
    expect(resolveDistrict(undefined)).toBeNull();
    expect(resolveDistrict(null)).toBeNull();
    expect(resolveDistrict(99999)).toBeNull();
  });

  it('syncFacilitiesRegion moves every facility in the district to the new region', () => {
    const r1 = createRegion('R1', 'One');
    const r2 = createRegion('R2', 'Two');
    const d = createDistrict('D1', 'Dist', r1);
    const f = createFacility('F1', 'Fac', { regionId: r1, districtId: d });
    const other = createFacility('F2', 'Other', { regionId: r1 });
    syncFacilitiesRegion(d, r2);
    const rows = query<{ id: number; region_id: number }>('SELECT id, region_id FROM facilities ORDER BY id');
    expect(rows).toEqual([{ id: f, region_id: r2 }, { id: other, region_id: r1 }]);
  });

  it('backfillResponseDistrict fills only NULL district_id for that facility', () => {
    const r = createRegion('R1', 'One');
    const dOld = createDistrict('OLD', 'Old', r);
    const dNew = createDistrict('NEW', 'New', r);
    const f = createFacility('F1', 'Fac', { regionId: r });
    const g = createFacility('F2', 'Other', { regionId: r });
    const u = createUser({ facilityId: f });
    const empty = addResponse({ userId: u, facilityId: f, regionId: r });
    const kept = addResponse({ userId: u, facilityId: f, regionId: r, districtId: dOld });
    const elsewhere = addResponse({ userId: u, facilityId: g, regionId: r });

    backfillResponseDistrict(f, dNew);

    const byId = Object.fromEntries(
      query<{ id: number; district_id: number | null }>('SELECT id, district_id FROM user_assessment_responses')
        .map((x) => [x.id, x.district_id]),
    );
    expect(byId[empty]).toBe(dNew);
    expect(byId[kept]).toBe(dOld);
    expect(byId[elsewhere]).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workforce-competency/api test -- org`
Expected: FAIL — cannot resolve `../src/lib/org`.

- [ ] **Step 3: Implement `apps/api/src/lib/org.ts`**

```ts
// Organisational-hierarchy helpers shared by admin routes, survey completion,
// the startup backfill and report scoping.
//
// Hierarchy: Region → District → Facility → Department. facilities.region_id is
// a copy of districts.region_id maintained here (foreign keys are not enforced
// in this database, so these rules live in code).

import { query, execute } from '../db/database';

export interface OrgContext {
  facility_id: number | null;
  department_id: number | null;
  region_id: number | null;
  district_id: number | null;
}

/** The user's current org placement — snapshotted onto response rows. */
export function getOrgContext(userId: number): OrgContext | undefined {
  const [row] = query<OrgContext & Record<string, unknown>>(
    `SELECT u.facility_id, u.department_id, f.region_id, f.district_id
     FROM users u LEFT JOIN facilities f ON f.id = u.facility_id
     WHERE u.id = ?`,
    [userId],
  );
  return row;
}

/** Look up a district by id (number or numeric string). Null if absent/unknown. */
export function resolveDistrict(raw: unknown): { id: number; region_id: number } | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const id = Number(raw);
  if (!Number.isInteger(id)) return null;
  const [row] = query<{ id: number; region_id: number }>(
    'SELECT id, region_id FROM districts WHERE id = ?',
    [id],
  );
  return row ?? null;
}

/** Invariant 2: facilities follow their district when it moves region. */
export function syncFacilitiesRegion(districtId: number, regionId: number): void {
  execute(
    `UPDATE facilities SET region_id = ?, updated_at = datetime('now') WHERE district_id = ?`,
    [regionId, districtId],
  );
}

/**
 * Attribute a facility's pre-district responses to its (new) district.
 * Only NULLs are filled — an existing snapshot is history and never rewritten.
 */
export function backfillResponseDistrict(facilityId: number, districtId: number): void {
  execute(
    `UPDATE user_assessment_responses SET district_id = ?
     WHERE facility_id = ? AND district_id IS NULL`,
    [districtId, facilityId],
  );
}
```

- [ ] **Step 4: Use it in survey completion** — in `apps/api/src/routes/survey.ts`, add next to the other `../lib` imports:

```ts
import { getOrgContext } from '../lib/org';
```

Replace the `const [orgCtx] = query<{ … }>(…);` block (currently lines ~172-181) with:

```ts
    const orgCtx = getOrgContext(userId);
```

In the `INSERT INTO user_assessment_responses` inside the `for (const r of responses)` loop, change the column list, placeholders and values to include `district_id`:

```ts
        execute(
          `INSERT INTO user_assessment_responses
             (user_assessment_id, user_id, domain_id, domain_code,
              competency_value, subcompetency_value,
              response_level, response_text,
              facility_id, department_id, region_id, district_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            sessionId, userId, r.domain_id, existing.domain_code,
            r.competency_value, r.subcompetency_value,
            r.response_level, r.response_text,
            orgCtx?.facility_id ?? null,
            orgCtx?.department_id ?? null,
            orgCtx?.region_id ?? null,
            orgCtx?.district_id ?? null,
          ],
        );
```

(`query` stays imported — it is still used for `assessment_items` above.)

- [ ] **Step 5: Same change in `apps/api/src/scripts/backfill-responses.ts`** — add `import { getOrgContext } from '../lib/org';`, replace its `const [orgCtx] = query<{…}>(…)` block with `const orgCtx = getOrgContext(ua.user_id);`, and extend its INSERT exactly as in Step 4 (columns `…, region_id, district_id`, 12 placeholders, values `…, orgCtx?.region_id ?? null, orgCtx?.district_id ?? null`). Update the header comment's "(facility/department/region)" to "(facility/department/district/region)".

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @workforce-competency/api test` and `pnpm --filter @workforce-competency/api typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/org.ts apps/api/test/org.test.ts apps/api/src/routes/survey.ts apps/api/src/scripts/backfill-responses.ts
git commit -m "feat(api): snapshot district on responses; shared org-context helpers"
```

---

### Task 3: Districts admin API + region delete guard

**Files:**
- Create: `apps/api/src/routes/admin-districts.ts`, `apps/api/test/admin-districts.test.ts`
- Modify: `apps/api/src/routes/admin.ts` (CrudConfig/`makeCrudRouter` delete handler, regions router, mount list)

**Interfaces:**
- Consumes: `syncFacilitiesRegion` (Task 2); helpers (Task 1).
- Produces: `GET/POST/PUT/DELETE /admin/districts`, `POST /admin/districts/import` returning `{ imported, skipped, errors: { row: number; reason: string }[] }`. `CrudConfig.beforeDelete?: (id: number) => string | null`.

- [ ] **Step 1: Write the failing tests** — `apps/api/test/admin-districts.test.ts`

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { query } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createRegion, createDistrict, createFacility, createUser,
} from './helpers';

const app = testApp();

describe('/admin/districts', () => {
  let admin: number;
  let dsm: number;
  let mwz: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
    dsm = createRegion('DSM', 'Dar es Salaam');
    mwz = createRegion('MWZ', 'Mwanza');
  });

  it('lists districts with region name and facility count', async () => {
    const d = createDistrict('TMK', 'Temeke', dsm);
    createFacility('F1', 'Fac', { regionId: dsm, districtId: d });
    const res = await request(app).get('/admin/districts').set(asUser(admin));
    expect(res.status).toBe(200);
    expect(res.body.districts).toEqual([
      expect.objectContaining({ id: d, code: 'TMK', name: 'Temeke', region_id: dsm, region_name: 'Dar es Salaam', facility_count: 1 }),
    ]);
  });

  it('creates a district (code upper-cased) and requires a real region', async () => {
    const ok = await request(app).post('/admin/districts').set(asUser(admin))
      .send({ code: 'tmk', name: 'Temeke', region_id: dsm });
    expect(ok.status).toBe(201);
    expect(ok.body.district).toMatchObject({ code: 'TMK', region_id: dsm });

    const noRegion = await request(app).post('/admin/districts').set(asUser(admin))
      .send({ code: 'X', name: 'X' });
    expect(noRegion.status).toBe(400);

    const badRegion = await request(app).post('/admin/districts').set(asUser(admin))
      .send({ code: 'Y', name: 'Y', region_id: 99999 });
    expect(badRegion.status).toBe(400);

    const dup = await request(app).post('/admin/districts').set(asUser(admin))
      .send({ code: 'TMK', name: 'Again', region_id: dsm });
    expect(dup.status).toBe(409);
  });

  it('rejects non-admins', async () => {
    const staff = createUser();
    const res = await request(app).post('/admin/districts').set(asUser(staff))
      .send({ code: 'TMK', name: 'Temeke', region_id: dsm });
    expect(res.status).toBe(403);
  });

  it('moving a district to another region moves its facilities (invariant 2)', async () => {
    const d = createDistrict('TMK', 'Temeke', dsm);
    const f = createFacility('F1', 'Fac', { regionId: dsm, districtId: d });
    const res = await request(app).put(`/admin/districts/${d}`).set(asUser(admin)).send({ region_id: mwz });
    expect(res.status).toBe(200);
    expect(res.body.district.region_id).toBe(mwz);
    expect(query<{ region_id: number }>('SELECT region_id FROM facilities WHERE id = ?', [f])[0].region_id).toBe(mwz);
  });

  it('refuses to delete a district that still has facilities (invariant 3)', async () => {
    const d = createDistrict('TMK', 'Temeke', dsm);
    createFacility('F1', 'Fac', { regionId: dsm, districtId: d });
    const blocked = await request(app).delete(`/admin/districts/${d}`).set(asUser(admin));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('1 facility is still assigned to this district');

    const empty = createDistrict('ILA', 'Ilala', dsm);
    const ok = await request(app).delete(`/admin/districts/${empty}`).set(asUser(admin));
    expect(ok.status).toBe(200);
  });

  it('refuses to delete a region that still has districts (invariant 4)', async () => {
    createDistrict('TMK', 'Temeke', dsm);
    const blocked = await request(app).delete(`/admin/regions/${dsm}`).set(asUser(admin));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('1 district is still assigned to this region');

    const ok = await request(app).delete(`/admin/regions/${mwz}`).set(asUser(admin));
    expect(ok.status).toBe(200);
  });

  it('imports districts from CSV and reports skipped rows with reasons', async () => {
    createDistrict('TMK', 'Temeke', dsm);
    const csv = [
      'district_code,district_name,region_code',
      'ila,Ilala,dsm',
      'NYA,Nyamagana,MWZ',
      'XXX,Nowhere,ZZZ',
      'TMK,Temeke again,DSM',
      ',Missing code,DSM',
    ].join('\n');
    const res = await request(app).post('/admin/districts/import').set(asUser(admin)).send({ csv });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      imported: 2,
      skipped: 3,
      errors: [
        { row: 4, reason: 'Unknown region_code "ZZZ"' },
        { row: 5, reason: 'District code "TMK" already exists' },
        { row: 6, reason: 'district_code, district_name and region_code are required' },
      ],
    });
  });

  it('rejects an import missing required columns', async () => {
    const res = await request(app).post('/admin/districts/import').set(asUser(admin))
      .send({ csv: 'district_code,district_name\nA,B' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workforce-competency/api test -- admin-districts`
Expected: FAIL — 404s (routes not mounted).

- [ ] **Step 3: Create `apps/api/src/routes/admin-districts.ts`**

```ts
// Districts — the level between regions and facilities. Mounted by admin.ts
// under /admin/districts (auth + password-change guards are applied there).

import { Router, Request, Response, NextFunction } from 'express';
import { query, execute } from '../db/database';
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

router.get('/', (_req, res: Response, next: NextFunction) => {
  try {
    const districts = query(`
      SELECT d.*, r.name AS region_name, COUNT(f.id) AS facility_count
      FROM districts d
      LEFT JOIN regions r    ON r.id = d.region_id
      LEFT JOIN facilities f ON f.district_id = d.id
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
    const regionId = regionExists(body.region_id ?? existing.region_id);
    if (regionId === null) return next(createError('region_id must reference an existing region', 400));
    try {
      execute(
        `UPDATE districts SET code = ?, name = ?, region_id = ?, updated_at = datetime('now') WHERE id = ?`,
        [code, name, regionId, id],
      );
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('UNIQUE'))
        return next(createError(`District code "${code}" already exists`, 409));
      throw e;
    }
    if (regionId !== existing.region_id) syncFacilitiesRegion(id, regionId);
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
      } catch {
        errors.push({ row: line, reason: `District code "${code}" already exists` });
      }
    });
    res.json({ imported, skipped: errors.length, errors });
  } catch (err) { next(err); }
});

export default router;
```

- [ ] **Step 4: Add `beforeDelete` to the generic CRUD factory** in `apps/api/src/routes/admin.ts`.

In `interface CrudConfig`, add:

```ts
  beforeDelete?: (id: number) => string | null; // non-null → 409 with that message
```

In `makeCrudRouter`, change `const { table, fields } = cfg;` to `const { table, fields, beforeDelete } = cfg;`, and in the DELETE handler, after the `if (!existing) …404` line, add:

```ts
      const blocked = beforeDelete?.(id);
      if (blocked) return next(createError(blocked, 409));
```

- [ ] **Step 5: Guard region deletes and mount districts** in `apps/api/src/routes/admin.ts`.

Replace `const regionsRouter = makeCrudRouter({ table: 'regions', fields: ['code', 'name'] });` with:

```ts
const regionsRouter = makeCrudRouter({
  table: 'regions',
  fields: ['code', 'name'],
  // Invariant 4 — FKs aren't enforced, so check here.
  beforeDelete: (id) => {
    const [{ n }] = query<{ n: number }>('SELECT COUNT(*) AS n FROM districts WHERE region_id = ?', [id]);
    return n > 0 ? `${n} ${n === 1 ? 'district is' : 'districts are'} still assigned to this region` : null;
  },
});
```

Add the import at the top with the other imports:

```ts
import districtsRouter from './admin-districts';
```

In the "Mount sub-routers" block, add after the regions line:

```ts
router.use('/districts',   districtsRouter);
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @workforce-competency/api test` and `pnpm --filter @workforce-competency/api typecheck`
Expected: PASS; clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin-districts.ts apps/api/src/routes/admin.ts apps/api/test/admin-districts.test.ts
git commit -m "feat(api): districts admin CRUD + CSV import; block deleting regions with districts"
```

---

### Task 4: Facilities require a district (API + CSV import)

**Files:**
- Modify: `apps/api/src/routes/admin.ts` — `FacilityRow`, facilities GET `/`, POST `/`, PUT `/:id`, POST `/import`
- Test: `apps/api/test/admin-facilities.test.ts`

**Interfaces:**
- Consumes: `resolveDistrict`, `backfillResponseDistrict` (Task 2).
- Produces: facility JSON gains `district_id` (all endpoints) and `district_name` (list). Facilities import returns `{ imported, updated, skipped, errors: { row, reason }[] }`.

- [ ] **Step 1: Write the failing tests** — `apps/api/test/admin-facilities.test.ts`

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { query } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createRegion, createDistrict, createFacility, createUser, addResponse,
} from './helpers';

const app = testApp();

describe('/admin/facilities with districts', () => {
  let admin: number, dsm: number, mwz: number, tmk: number, nya: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
    dsm = createRegion('DSM', 'Dar es Salaam');
    mwz = createRegion('MWZ', 'Mwanza');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    nya = createDistrict('NYA', 'Nyamagana', mwz);
  });

  it('requires a valid district on create and derives region from it', async () => {
    const missing = await request(app).post('/admin/facilities').set(asUser(admin)).send({ code: 'F1', name: 'Fac' });
    expect(missing.status).toBe(400);

    const res = await request(app).post('/admin/facilities').set(asUser(admin))
      .send({ code: 'F1', name: 'Fac', district_id: tmk, region_id: mwz /* ignored */ });
    expect(res.status).toBe(201);
    expect(res.body.facility).toMatchObject({ district_id: tmk, region_id: dsm });
  });

  it('on update, requires a district, derives region and back-fills NULL response districts', async () => {
    const f = createFacility('F1', 'Fac', { regionId: dsm }); // legacy: no district
    const u = createUser({ facilityId: f });
    const resp = addResponse({ userId: u, facilityId: f, regionId: dsm });

    const noDistrict = await request(app).put(`/admin/facilities/${f}`).set(asUser(admin)).send({ name: 'Renamed' });
    expect(noDistrict.status).toBe(400);

    const ok = await request(app).put(`/admin/facilities/${f}`).set(asUser(admin)).send({ district_id: nya });
    expect(ok.status).toBe(200);
    expect(ok.body.facility).toMatchObject({ district_id: nya, region_id: mwz });
    expect(query<{ district_id: number }>('SELECT district_id FROM user_assessment_responses WHERE id = ?', [resp])[0].district_id).toBe(nya);
  });

  it('lists district_id and district_name', async () => {
    createFacility('F1', 'Fac', { regionId: dsm, districtId: tmk });
    const res = await request(app).get('/admin/facilities').set(asUser(admin));
    expect(res.body.facilities[0]).toMatchObject({ district_id: tmk, district_name: 'Temeke', region_name: 'Dar es Salaam' });
  });

  it('imports new facilities, updates districts of existing codes, and explains skips', async () => {
    const legacy = createFacility('OLD', 'Legacy Hospital', { regionId: dsm });
    const u = createUser({ facilityId: legacy });
    const resp = addResponse({ userId: u, facilityId: legacy, regionId: dsm });

    const csv = [
      'facility_code,facility_name,facility_type,district_code,region_code',
      'NEW1,New One,Hospital,TMK,DSM',
      'OLD,Ignored Name,Ignored,NYA,',
      'BAD1,Mismatch,,TMK,MWZ',
      'BAD2,No district,,,DSM',
      'BAD3,Unknown district,,ZZZ,',
    ].join('\n');
    const res = await request(app).post('/admin/facilities/import').set(asUser(admin)).send({ csv });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      imported: 1,
      updated: 1,
      skipped: 3,
      errors: [
        { row: 4, reason: 'region_code "MWZ" does not match district TMK (region DSM)' },
        { row: 5, reason: 'facility_code, facility_name and district_code are required' },
        { row: 6, reason: 'Unknown district_code "ZZZ"' },
      ],
    });

    const [created] = query('SELECT * FROM facilities WHERE code = ?', ['NEW1']);
    expect(created).toMatchObject({ name: 'New One', facility_type: 'Hospital', district_id: tmk, region_id: dsm });
    const [updated] = query('SELECT * FROM facilities WHERE id = ?', [legacy]);
    expect(updated).toMatchObject({ name: 'Legacy Hospital', district_id: nya, region_id: mwz });
    expect(query<{ district_id: number }>('SELECT district_id FROM user_assessment_responses WHERE id = ?', [resp])[0].district_id).toBe(nya);
  });

  it('rejects an import without district_code column', async () => {
    const res = await request(app).post('/admin/facilities/import').set(asUser(admin))
      .send({ csv: 'facility_code,facility_name\nA,B' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workforce-competency/api test -- admin-facilities`
Expected: FAIL (create without district returns 201, no `district_name`, import shape differs).

- [ ] **Step 3: Update `FacilityRow` and imports** in `apps/api/src/routes/admin.ts`:

```ts
interface FacilityRow  extends Record<string, unknown> { id: number; code: string; name: string; facility_type: string | null; region_id: number | null; district_id: number | null; }
```

Add near the top:

```ts
import { parseCsv as parseCsvRfc } from '../lib/csv';
import { resolveDistrict, backfillResponseDistrict } from '../lib/org';
```

(`admin.ts` has its own naive local `parseCsv`; the facilities import switches to the shared RFC-4180 parser under an alias so quoted names containing commas work. Other imports in this file are untouched.)

- [ ] **Step 4: Facilities list** — replace the SQL in `facilitiesRouter.get('/')` with:

```ts
    const facilities = query<FacilityRow & { region_name: string | null; district_name: string | null; department_ids: string | null }>(`
      SELECT f.*,
             r.name AS region_name,
             d.name AS district_name,
             GROUP_CONCAT(fd.department_id) AS department_ids
      FROM facilities f
      LEFT JOIN regions r   ON r.id = f.region_id
      LEFT JOIN districts d ON d.id = f.district_id
      LEFT JOIN facility_departments fd ON fd.facility_id = f.id
      GROUP BY f.id
      ORDER BY f.name ASC
    `);
```

- [ ] **Step 5: Facility create** — in `facilitiesRouter.post('/')`, replace everything from the destructuring through the `execute('INSERT INTO facilities …')` call with:

```ts
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
```

(the existing `} catch (e: unknown) {` block and the rest of the handler stay unchanged).

- [ ] **Step 6: Facility update** — in `facilitiesRouter.put('/:id')`, replace the destructuring and the `execute('UPDATE facilities …')` call with:

```ts
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
```

Then, right after the existing `if (Array.isArray(department_ids)) { … }` block, add:

```ts
    backfillResponseDistrict(id, district.id);
```

- [ ] **Step 7: Replace the facilities import handler** (`facilitiesRouter.post('/import', …)`) entirely:

```ts
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
```

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm --filter @workforce-competency/api test` and `pnpm --filter @workforce-competency/api typecheck`
Expected: PASS; clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/test/admin-facilities.test.ts
git commit -m "feat(api): facilities require a district; import assigns districts to existing codes"
```

---

### Task 5: Reports API — district level, region-by-district, scoping

**Files:**
- Modify: `apps/api/src/lib/report-scope.ts`, `apps/api/src/routes/reports.ts`
- Test: `apps/api/test/reports-districts.test.ts`

**Interfaces:**
- Consumes: helpers (Task 1).
- Produces:
  - `GET /reports/districts/:districtId` → `{ level: 'district', district: { id, name, region_id, region_name }, items: { facility_id, facility_name, …counts }[], meta }`
  - `GET /reports/regions/:regionId` → `{ level: 'region', region, items: { district_id, district_name, …counts }[], undistricted_facilities: { id, name }[], meta }`
  - `GET /reports/facilities/:id` → `facility` = `{ id, name, region_id, region_name, district_id, district_name }`.
  - `Scope.districtId`; `denyReason(scope, { level: 'district', districtId })`.

- [ ] **Step 1: Write the failing tests** — `apps/api/test/reports-districts.test.ts`

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  initTestDb, resetDb, testApp, asUser, createRegion, createDistrict, createFacility, createUser, addResponse,
} from './helpers';

const app = testApp();

describe('district reports', () => {
  let admin: number, dsm: number, tmk: number, ila: number, fTmk: number, fLegacy: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
    dsm = createRegion('DSM', 'Dar es Salaam');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    ila = createDistrict('ILA', 'Ilala', dsm);
    fTmk = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    createFacility('F2', 'Ilala Clinic', { regionId: dsm, districtId: ila });
    fLegacy = createFacility('F3', 'Legacy Lab', { regionId: dsm });

    const a = createUser({ facilityId: fTmk });
    const b = createUser({ facilityId: fTmk });
    const c = createUser({ facilityId: fLegacy });
    addResponse({ userId: a, facilityId: fTmk, regionId: dsm, districtId: tmk, level: 2 });
    addResponse({ userId: b, facilityId: fTmk, regionId: dsm, districtId: tmk, level: 4 });
    addResponse({ userId: c, facilityId: fLegacy, regionId: dsm, level: 1 });
  });

  it('region report groups by district and lists undistricted facilities', async () => {
    const res = await request(app).get(`/reports/regions/${dsm}`).set(asUser(admin));
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { district_name: string; respondents: number }) => [i.district_name, i.respondents]))
      .toEqual([['Ilala', 0], ['Temeke', 2]]);
    expect(res.body.undistricted_facilities).toEqual([{ id: fLegacy, name: 'Legacy Lab' }]);
    expect(res.body.meta.total_respondents).toBe(3);
    expect(res.body.meta.unassigned_respondents).toBe(1);
  });

  it('district report lists its facilities with counts', async () => {
    const res = await request(app).get(`/reports/districts/${tmk}`).set(asUser(admin));
    expect(res.status).toBe(200);
    expect(res.body.level).toBe('district');
    expect(res.body.district).toEqual({ id: tmk, name: 'Temeke', region_id: dsm, region_name: 'Dar es Salaam' });
    expect(res.body.items).toEqual([
      expect.objectContaining({ facility_id: fTmk, facility_name: 'Temeke Hospital', respondents: 2, avg_level: 3 }),
    ]);
    expect(res.body.meta.total_respondents).toBe(2);
    expect(res.body.meta.unassigned_respondents).toBe(0);
  });

  it('district report 404s for an unknown district', async () => {
    const res = await request(app).get('/reports/districts/99999').set(asUser(admin));
    expect(res.status).toBe(404);
  });

  it('facility report exposes district and region names', async () => {
    const res = await request(app).get(`/reports/facilities/${fTmk}`).set(asUser(admin));
    expect(res.body.facility).toEqual({
      id: fTmk, name: 'Temeke Hospital', region_id: dsm, region_name: 'Dar es Salaam',
      district_id: tmk, district_name: 'Temeke',
    });
  });

  it('staff can see their own district only', async () => {
    const staff = createUser({ facilityId: fTmk });
    expect((await request(app).get(`/reports/districts/${tmk}`).set(asUser(staff))).status).toBe(200);
    expect((await request(app).get(`/reports/districts/${ila}`).set(asUser(staff))).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workforce-competency/api test -- reports-districts`
Expected: FAIL (404 on `/reports/districts`, region items are facilities).

- [ ] **Step 3: Scope** — in `apps/api/src/lib/report-scope.ts`:

- Add `districtId: number | null;` to `interface Scope` after `regionId`.
- In `getScope`, add `district_id: number | null;` to the row type, change the SELECT to `SELECT u.role, u.facility_id, u.department_id, f.region_id, f.district_id`, and add `districtId: row?.district_id ?? null,` to the returned object.
- Extend the `requested` union with `| { level: 'district'; districtId: number }` and add this case after `'region'`:

```ts
    case 'district':
      return scope.districtId === requested.districtId
        ? null
        : 'Staff users may not view reports for other districts';
```

- Update the header comment's staff policy line to "may only view reports covering their own facility / department / district / region".

- [ ] **Step 4: Region report by district** — in `apps/api/src/routes/reports.ts`, widen the `respondentCounts` column union:

```ts
  unassignedCol: 'region_id' | 'district_id' | 'facility_id' | 'department_id',
```

In `router.get('/regions/:regionId')`, replace the `items` query with:

```ts
    const items = query(
      `SELECT d.id AS district_id, d.name AS district_name, ${COUNTS_SELECT}
       FROM districts d
       LEFT JOIN user_assessment_responses uar
              ON uar.district_id = d.id${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       WHERE d.region_id = ?
       GROUP BY d.id, d.name
       ORDER BY d.name`,
      [...on.params, regionId],
    );

    // Facilities not yet placed in a district — surfaced so they stay reachable.
    const undistricted_facilities = query<{ id: number; name: string }>(
      'SELECT id, name FROM facilities WHERE region_id = ? AND district_id IS NULL ORDER BY name',
      [regionId],
    );
```

Keep the `whereParts`/`whereParams` lines; replace the comment, counts call and response with:

```ts
    // At region level, unassigned = respondents in this region with no district_id.
    const counts = respondentCounts('WHERE ' + whereParts.join(' AND '), whereParams, f, 'district_id');

    res.json({ level: 'region', region, items, undistricted_facilities, meta: meta(f, counts.total, counts.unassigned) });
```

- [ ] **Step 5: District endpoint** — insert between the region and facility handlers:

```ts
// ── GET /reports/districts/:districtId ─────────────────────────────────────
router.get('/districts/:districtId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const districtId = Number(req.params.districtId);
    const scope = getScope(req.session.userId!);
    const reason = denyReason(scope, { level: 'district', districtId });
    if (reason) return next(createError(reason, 403));

    const [district] = query<{ id: number; name: string; region_id: number; region_name: string | null }>(
      `SELECT d.id, d.name, d.region_id, r.name AS region_name
       FROM districts d LEFT JOIN regions r ON r.id = d.region_id
       WHERE d.id = ?`,
      [districtId],
    );
    if (!district) return next(createError('District not found', 404));

    const f = parseFilters(req);
    const on = uarOnFilters(f);

    const items = query(
      `SELECT fa.id AS facility_id, fa.name AS facility_name, ${COUNTS_SELECT}
       FROM facilities fa
       LEFT JOIN user_assessment_responses uar
              ON uar.facility_id = fa.id${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       WHERE fa.district_id = ?
       GROUP BY fa.id, fa.name
       ORDER BY fa.name`,
      [...on.params, districtId],
    );

    const whereParts: string[] = ['uar.district_id = ?'];
    const whereParams: SqlValue[] = [districtId];
    if (f.domainCode)      { whereParts.push('uar.domain_code = ?');      whereParams.push(f.domainCode); }
    if (f.competencyValue) { whereParts.push('uar.competency_value = ?'); whereParams.push(f.competencyValue); }
    // At district level, unassigned = respondents in this district with no facility_id.
    const counts = respondentCounts('WHERE ' + whereParts.join(' AND '), whereParams, f, 'facility_id');

    res.json({ level: 'district', district, items, meta: meta(f, counts.total, counts.unassigned) });
  } catch (err) { next(err); }
});
```

- [ ] **Step 6: Facility report names** — in `router.get('/facilities/:facilityId')`, replace the facility lookup with:

```ts
    const [facility] = query<{
      id: number; name: string; region_id: number | null; region_name: string | null;
      district_id: number | null; district_name: string | null;
    }>(
      `SELECT fa.id, fa.name, fa.region_id, r.name AS region_name, fa.district_id, d.name AS district_name
       FROM facilities fa
       LEFT JOIN regions r   ON r.id = fa.region_id
       LEFT JOIN districts d ON d.id = fa.district_id
       WHERE fa.id = ?`,
      [facilityId],
    );
```

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @workforce-competency/api test` and `pnpm --filter @workforce-competency/api typecheck`
Expected: PASS; clean.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/report-scope.ts apps/api/src/routes/reports.ts apps/api/test/reports-districts.test.ts
git commit -m "feat(api): district report level; region report groups by district"
```

---

### Task 6: Web report types + exports

**Files:**
- Modify: `apps/web/src/types/reports.ts`, `apps/web/src/lib/reports/export-excel.ts`, `apps/web/src/lib/reports/export-pdf.ts`, `apps/web/src/components/reports/ExportMenu.tsx`
- Test: `apps/web/src/lib/reports/export-excel.test.ts`

**Interfaces:**
- Consumes: API shapes from Task 5.
- Produces: `ReportLevel` includes `'district'`; `DistrictItem`, `DistrictReportResponse`, `UndistrictedFacility`, `AnyReport` exported from `@/types/reports`; `RegionItem` = `MaturityCounts & { district_id: number; district_name: string }`.

- [ ] **Step 1: Write the failing test** — `apps/web/src/lib/reports/export-excel.test.ts`

```ts
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildWorkbook } from "./export-excel";
import type { DistrictReportResponse, RegionReportResponse, MaturityCounts, ReportMeta } from "@/types/reports";

const counts: MaturityCounts = {
  respondents: 2, total_responses: 4, avg_level: 3,
  count_na: 0, count_beginner: 0, count_competent: 2, count_proficient: 0, count_expert: 2,
};
const meta: ReportMeta = {
  total_respondents: 2, unassigned_respondents: 0, generated_at: "2026-09-28T00:00:00Z",
  filters: { domain_code: null, competency_value: null, approved_only: true },
};

const breakdown = (wb: XLSX.WorkBook) => XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Breakdown"]);
const summary = (wb: XLSX.WorkBook) => XLSX.utils.sheet_to_json<{ Field: string; Value: unknown }>(wb.Sheets["Summary"]);

describe("buildWorkbook — districts", () => {
  it("region report breaks down by district", () => {
    const r: RegionReportResponse = {
      level: "region", region: { id: 1, name: "Dar es Salaam" },
      items: [{ district_id: 7, district_name: "Temeke", ...counts }],
      undistricted_facilities: [], meta,
    };
    expect(breakdown(buildWorkbook(r))[0]).toMatchObject({ District: "Temeke", Respondents: 2 });
  });

  it("district report breaks down by facility and is titled after the district", () => {
    const r: DistrictReportResponse = {
      level: "district",
      district: { id: 7, name: "Temeke", region_id: 1, region_name: "Dar es Salaam" },
      items: [{ facility_id: 3, facility_name: "Temeke Hospital", ...counts }],
      meta,
    };
    const wb = buildWorkbook(r);
    expect(breakdown(wb)[0]).toMatchObject({ Facility: "Temeke Hospital", Respondents: 2 });
    expect(summary(wb).find((s) => s.Field === "Title")?.Value).toBe("Temeke district");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workforce-competency/web test -- export-excel`
Expected: FAIL — `District` / `Facility` columns missing, title mismatch.

- [ ] **Step 3: Update `apps/web/src/types/reports.ts`**

Change the level union:

```ts
export type ReportLevel = 'national' | 'region' | 'district' | 'facility' | 'department' | 'individual';
```

Replace the `RegionItem` / `RegionReportResponse` block with:

```ts
export interface RegionItem extends MaturityCounts {
  district_id: number;
  district_name: string;
}
export interface UndistrictedFacility {
  id: number;
  name: string;
}
export interface RegionReportResponse {
  level: 'region';
  region: { id: number; name: string };
  items: RegionItem[];
  // Facilities in this region with no district yet — listed so they stay reachable.
  undistricted_facilities: UndistrictedFacility[];
  meta: ReportMeta;
}

export interface DistrictItem extends MaturityCounts {
  facility_id: number;
  facility_name: string;
}
export interface DistrictReportResponse {
  level: 'district';
  district: { id: number; name: string; region_id: number; region_name: string | null };
  items: DistrictItem[];
  meta: ReportMeta;
}
```

Change the facility shape in `FacilityReportResponse`:

```ts
  facility: {
    id: number;
    name: string;
    region_id: number | null;
    region_name: string | null;
    district_id: number | null;
    district_name: string | null;
  };
```

Append at the end of the file:

```ts
export type AnyReport =
  | NationalReportResponse
  | RegionReportResponse
  | DistrictReportResponse
  | FacilityReportResponse
  | DepartmentReportResponse
  | IndividualReportResponse;
```

- [ ] **Step 4: Update `apps/web/src/lib/reports/export-excel.ts`**

Replace the type import and the local `type AnyReport = …` union with:

```ts
import type { AnyReport } from '@/types/reports';
```

In `titleFor`, add after the `'region'` case:

```ts
    case 'district':   return `${r.district.name} district`;
```

In `breakdownRows`, change the `'region'` case's `Facility: i.facility_name,` to `District: i.district_name,` and add after that case:

```ts
    case 'district':
      return r.items.map((i) => ({
        Facility: i.facility_name,
        Respondents: i.respondents,
        'Avg level': i.avg_level ?? '',
        Beginner: i.count_beginner, Competent: i.count_competent,
        Proficient: i.count_proficient, Expert: i.count_expert,
        'N/A': i.count_na,
      }));
```

- [ ] **Step 5: Update `apps/web/src/lib/reports/export-pdf.ts`**

Replace the type import and local union with `import type { AnyReport } from '@/types/reports';`. In `titleFor`, add after `'region'`:

```ts
    case 'district':   return `District · ${r.district.name}`;
```

In `breakdownHeadRows`, replace the `'region'` case with these two cases:

```ts
    case 'region':
      return {
        head: [['District', 'Respondents', 'Avg', ...levels]],
        body: r.items.map((i) => [
          i.district_name, i.respondents, (i.avg_level ?? 0).toFixed(1),
          i.count_beginner, i.count_competent, i.count_proficient, i.count_expert, i.count_na,
        ]),
      };
    case 'district':
      return {
        head: [['Facility', 'Respondents', 'Avg', ...levels]],
        body: r.items.map((i) => [
          i.facility_name, i.respondents, (i.avg_level ?? 0).toFixed(1),
          i.count_beginner, i.count_competent, i.count_proficient, i.count_expert, i.count_na,
        ]),
      };
```

- [ ] **Step 6: Update `apps/web/src/components/reports/ExportMenu.tsx`** — replace the type import and local `AnyReport` union with:

```ts
import type { AnyReport, ReportLevel } from '@/types/reports';
```

and change the prop to `payload: AnyReport | null | undefined;`.

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @workforce-competency/web test` then `pnpm --filter @workforce-competency/web typecheck`
Expected: tests PASS. Typecheck is expected to FAIL only in `RegionReport.tsx`, `ReportsPage.tsx` and `UnassignedBanner.tsx` (old region shape / missing `district` key) — fixed in Task 7. Confirm there are no other errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/types/reports.ts apps/web/src/lib/reports apps/web/src/components/reports/ExportMenu.tsx
git commit -m "feat(web): district report types and exports"
```

---

### Task 7: Web District report level, drill-down and breadcrumbs

**Files:**
- Create: `apps/web/src/components/reports/levels/DistrictReport.tsx`
- Modify: `apps/web/src/hooks/reports/useReportQueries.ts`, `apps/web/src/main.tsx:42`, `apps/web/src/components/reports/levels/RegionReport.tsx`, `apps/web/src/components/reports/UnassignedBanner.tsx`, `apps/web/src/pages/ReportsPage.tsx`

**Interfaces:**
- Consumes: Task 6 types.
- Produces: `useDistrictReport(districtId: number | null)`; route `${baseUrl}reports/districts/:districtId`; `<DistrictReport districtId={number} />`.

- [ ] **Step 1: Hook** — in `useReportQueries.ts` add `DistrictReportResponse` to the type import and, after `useRegionReport`:

```ts
export function useDistrictReport(districtId: number | null) {
  const filters = useFilters();
  return useQuery({
    queryKey: ['reports', 'district', districtId, filters],
    enabled: districtId != null,
    queryFn: async () => {
      const res = await api.get<DistrictReportResponse>(`/reports/districts/${districtId}${qs(filters)}`);
      if (res.error !== null) throw new Error(res.error);
      return res.data;
    },
    staleTime: FIVE_MINUTES,
  });
}
```

- [ ] **Step 2: Route** — in `main.tsx`, after the regions report route line:

```tsx
      { path: `${baseUrl}reports/districts/:districtId`,     element: <ReportsPage />, errorElement: <ErrorPage /> },
```

- [ ] **Step 3: Create `apps/web/src/components/reports/levels/DistrictReport.tsx`**

```tsx
import { useNavigate } from 'react-router-dom';
import { useDistrictReport } from '@/hooks/reports/useReportQueries';
import { MaturityLegend } from '../MaturityLegend';
import { MaturityStackedBar } from '../MaturityStackedBar';
import { MaturityBreakdownTable } from '../MaturityBreakdownTable';
import { ChartSkeleton } from '../ChartSkeleton';
import { ReportKpiCards } from '../ReportKpiCards';
import { UnassignedBanner } from '../UnassignedBanner';

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || '/';

interface Props { districtId: number }

export function DistrictReport({ districtId }: Props) {
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useDistrictReport(districtId);

  if (isPending) return <ChartSkeleton />;
  if (isError) return <div className="p-6 text-sm text-destructive">Error: {(error as Error).message}</div>;

  const covered = data.items.filter((r) => r.respondents > 0).length;
  const totalResp = data.items.reduce((s, r) => s + r.respondents, 0);
  const avgLevel = totalResp > 0
    ? data.items.reduce((s, r) => s + (r.avg_level ?? 0) * r.respondents, 0) / totalResp
    : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <UnassignedBanner level="district" count={data.meta.unassigned_respondents} />
      <ReportKpiCards
        totalRespondents={data.meta.total_respondents}
        avgLevel={avgLevel}
        bucketsCovered={covered}
        bucketsLabel="facilities"
      />
      <div className="rounded-sm border bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Facilities in {data.district.name}</h2>
          <MaturityLegend />
        </div>
        <div id="report-bar-chart" className="p-3">
          <MaturityStackedBar
            data={data.items.map((r) => ({ key: String(r.facility_id), label: r.facility_name, ...r }))}
            onBarClick={(key) => navigate(`${baseUrl}reports/facilities/${key}`)}
            emptyText="No facilities in this district"
          />
        </div>
      </div>
      <MaturityBreakdownTable
        rows={data.items.map((r) => ({ key: String(r.facility_id), label: r.facility_name, ...r }))}
        onRowClick={(key) => navigate(`${baseUrl}reports/facilities/${key}`)}
        labelHeader="Facility"
      />
    </div>
  );
}
```

- [ ] **Step 4: `RegionReport.tsx` shows districts** — change the router import to `import { Link, useNavigate } from 'react-router-dom';` and replace everything from `return (` to the end of the component with:

```tsx
  return (
    <div className="flex flex-col gap-4 p-4">
      <UnassignedBanner level="region" count={data.meta.unassigned_respondents} />
      <ReportKpiCards
        totalRespondents={data.meta.total_respondents}
        avgLevel={avgLevel}
        bucketsCovered={covered}
        bucketsLabel="districts"
      />
      <div className="rounded-sm border bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Districts in {data.region.name}</h2>
          <MaturityLegend />
        </div>
        <div id="report-bar-chart" className="p-3">
          <MaturityStackedBar
            data={data.items.map((r) => ({ key: String(r.district_id), label: r.district_name, ...r }))}
            onBarClick={(key) => navigate(`${baseUrl}reports/districts/${key}`)}
            emptyText="No districts in this region"
          />
        </div>
      </div>
      <MaturityBreakdownTable
        rows={data.items.map((r) => ({ key: String(r.district_id), label: r.district_name, ...r }))}
        onRowClick={(key) => navigate(`${baseUrl}reports/districts/${key}`)}
        labelHeader="District"
      />
      {data.undistricted_facilities.length > 0 && (
        <div className="rounded-sm border bg-background">
          <div className="border-b px-3 py-2">
            <h2 className="text-sm font-semibold">Facilities without a district</h2>
            <p className="text-xs text-muted-foreground">
              Not yet counted in the district breakdown above. Assign a district in Setup › Facilities.
            </p>
          </div>
          <ul className="flex flex-col divide-y">
            {data.undistricted_facilities.map((f) => (
              <li key={f.id}>
                <Link
                  to={`${baseUrl}reports/facilities/${f.id}`}
                  className="block px-3 py-2 text-sm hover:bg-[rgba(70,130,180,0.08)]"
                >
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
```

- [ ] **Step 5: Banner messages** — in `UnassignedBanner.tsx`, replace the `region:` entry and add `district:` right after it:

```ts
  region: {
    title: "respondents aren't attributed to a district",
    body:  "Their facility has no district yet (or they have no facility), so they don't appear in the district breakdown. Assign each facility a district in Setup.",
    cta:   'Open Setup',
    to:    `${baseUrl}setup`,
  },
  district: {
    title: 'respondents have no facility in this district',
    body:  "These respondents report at the district level but haven't been placed in a facility. They don't roll up into the facility breakdown.",
    cta:   'Open Users',
    to:    `${baseUrl}users`,
  },
```

- [ ] **Step 6: `ReportsPage.tsx`**

- Imports: add `import { DistrictReport } from '@/components/reports/levels/DistrictReport';` and add `useDistrictReport` to the hooks import.
- After `const regionId = …`, add:

```ts
  const districtId   = params.districtId   ? Number(params.districtId)   : null;
```

- Level detection: insert the district branch between facility and region so it reads:

```ts
    : facilityId != null   ? 'facility'
    : districtId != null   ? 'district'
    : regionId != null     ? 'region'
```

- After `const region = useRegionReport(regionId);` add `const district = useDistrictReport(districtId);`.
- Replace the existing `if (level === 'facility' && facility.data) { … }` block, and add a district block before it:

```ts
  if (level === 'district' && district.data) {
    const d = district.data.district;
    crumbs.push({ label: d.region_name ?? 'Region', to: `${baseUrl}reports/regions/${d.region_id}` });
    crumbs.push({ label: d.name });
  }
  if (level === 'facility' && facility.data) {
    const fac = facility.data.facility;
    if (fac.region_id) {
      crumbs.push({ label: fac.region_name ?? 'Region', to: `${baseUrl}reports/regions/${fac.region_id}` });
    }
    if (fac.district_id) {
      crumbs.push({ label: fac.district_name ?? 'District', to: `${baseUrl}reports/districts/${fac.district_id}` });
    }
    crumbs.push({ label: fac.name });
  }
```

- In `exportPayload`, add `level === 'district'   ? district.data :` after the region line.
- In the render block, add after the region line:

```tsx
          {level === 'district'   && districtId   != null && <DistrictReport   districtId={districtId}   />}
```

- [ ] **Step 7: Typecheck + tests**

Run: `pnpm --filter @workforce-competency/web typecheck` and `pnpm --filter @workforce-competency/web test`
Expected: clean; PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): district report level, region drill-down by district, breadcrumbs"
```

---

### Task 8: Web Setup — Districts tab, facility district select, import errors

**Files:**
- Create: `apps/web/src/lib/setup/districts.ts`, `apps/web/src/lib/setup/districts.test.ts`, `apps/web/src/components/setup/ImportDialog.tsx`, `apps/web/src/components/setup/DistrictsTab.tsx`, `apps/web/public/data/districts.csv`
- Modify: `apps/web/src/pages/SetupPage.tsx`, `apps/web/public/data/facilities.csv`

**Interfaces:**
- Consumes: Task 3/4 endpoints and response shapes.
- Produces (in `lib/setup/districts.ts`): `interface District { id: number; code: string; name: string; region_id: number; region_name: string | null; facility_count: number }`, `groupDistrictsByRegion(ds: District[]): { region: string; districts: District[] }[]`, `interface ImportResult { imported: number; updated?: number; skipped?: number; errors?: { row: number; reason: string }[] }`, `formatImportResult(r: ImportResult, maxErrors?: number): { summary: string; details: string[] }`.

- [ ] **Step 1: Write the failing test** — `apps/web/src/lib/setup/districts.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { groupDistrictsByRegion, formatImportResult, type District } from "./districts";

const d = (id: number, name: string, region_name: string | null): District => ({
  id, code: name.slice(0, 3).toUpperCase(), name, region_id: 1, region_name, facility_count: 0,
});

describe("groupDistrictsByRegion", () => {
  it("groups by region name, both sorted alphabetically", () => {
    const groups = groupDistrictsByRegion([
      d(1, "Temeke", "Dar es Salaam"), d(2, "Nyamagana", "Mwanza"), d(3, "Ilala", "Dar es Salaam"),
    ]);
    expect(groups.map((g) => [g.region, g.districts.map((x) => x.name)])).toEqual([
      ["Dar es Salaam", ["Ilala", "Temeke"]],
      ["Mwanza", ["Nyamagana"]],
    ]);
  });

  it("puts districts with no region name under '—'", () => {
    expect(groupDistrictsByRegion([d(1, "Orphan", null)])[0].region).toBe("—");
  });
});

describe("formatImportResult", () => {
  it("summarises counts and lists the first errors", () => {
    const r = formatImportResult({
      imported: 2, updated: 1, skipped: 4,
      errors: [1, 2, 3, 4].map((n) => ({ row: n + 1, reason: `bad ${n}` })),
    }, 3);
    expect(r.summary).toBe("Imported 2, updated 1, skipped 4.");
    expect(r.details).toEqual(["Row 2: bad 1", "Row 3: bad 2", "Row 4: bad 3", "…and 1 more"]);
  });

  it("omits parts that are absent", () => {
    expect(formatImportResult({ imported: 5 })).toEqual({ summary: "Imported 5.", details: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workforce-competency/web test -- districts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/web/src/lib/setup/districts.ts`**

```ts
// Pure helpers for the Setup page's district handling (unit-tested).

export interface District {
  id: number;
  code: string;
  name: string;
  region_id: number;
  region_name: string | null;
  facility_count: number;
}

/** Districts grouped under their region for grouped <Select>s. */
export function groupDistrictsByRegion(ds: District[]): { region: string; districts: District[] }[] {
  const byRegion = new Map<string, District[]>();
  for (const d of ds) {
    const key = d.region_name ?? "—";
    byRegion.set(key, [...(byRegion.get(key) ?? []), d]);
  }
  return [...byRegion.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([region, districts]) => ({
      region,
      districts: [...districts].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export interface ImportResult {
  imported: number;
  updated?: number;
  skipped?: number;
  errors?: { row: number; reason: string }[];
}

/** Toast text for a CSV import response. */
export function formatImportResult(r: ImportResult, maxErrors = 5): { summary: string; details: string[] } {
  const parts = [`Imported ${r.imported}`];
  if (r.updated !== undefined) parts.push(`updated ${r.updated}`);
  if (r.skipped !== undefined) parts.push(`skipped ${r.skipped}`);
  const errors = r.errors ?? [];
  const details = errors.slice(0, maxErrors).map((e) => `Row ${e.row}: ${e.reason}`);
  if (errors.length > maxErrors) details.push(`…and ${errors.length - maxErrors} more`);
  return { summary: `${parts.join(", ")}.`, details };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @workforce-competency/web test`
Expected: PASS.

- [ ] **Step 5: Move `ImportDialog` out of SetupPage** — create `apps/web/src/components/setup/ImportDialog.tsx`:

```tsx
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { formatImportResult, type ImportResult } from "@/lib/setup/districts";

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  endpoint: string;
  hint: string;
  onImported: () => void;
}

export function ImportDialog({ open, onClose, endpoint, hint, onImported }: ImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error("Select a CSV file first."); return; }
    setLoading(true);
    const csv = await readFileAsText(file);
    const res = await api.post<ImportResult>(endpoint, { csv });
    setLoading(false);
    if (res.error !== null) { toast.error(res.error); return; }
    const { summary, details } = formatImportResult(res.data);
    if (details.length) toast.warning(summary, { description: details.join("\n"), duration: 15000 });
    else toast.success(summary);
    onImported();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Import from CSV</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <p className="text-sm text-muted-foreground">{hint}</p>
          <Input ref={fileRef} type="file" accept=".csv" required />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Importing…" : "Import"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

In `SetupPage.tsx`, delete the local `readFileAsText`, `ImportDialogProps` and `ImportDialog` (the "Helpers" and "Generic CSV import dialog" sections) and add `import { ImportDialog } from "@/components/setup/ImportDialog";`. Remove imports that become unused (`useRef`; the `Dialog*` imports if nothing else in the file uses them) — typecheck/lint will flag them.

- [ ] **Step 6: Create `apps/web/src/components/setup/DistrictsTab.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, FileUp, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { TableFillerRow } from "@/components/ui/table-filler";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { District } from "@/lib/setup/districts";
import { ImportDialog } from "./ImportDialog";

interface Region { id: number; code: string; name: string; }

export function DistrictsTab() {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<District | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [regionId, setRegionId] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: districts = [] } = useQuery({
    queryKey: ["admin", "districts"],
    queryFn: async () => {
      const res = await api.get<{ districts: District[] }>("/admin/districts");
      if (res.error !== null) throw new Error(res.error);
      return res.data.districts;
    },
  });

  const { data: regions = [] } = useQuery({
    queryKey: ["admin", "regions"],
    queryFn: async () => {
      const res = await api.get<{ regions: Region[] }>("/admin/regions");
      if (res.error !== null) throw new Error(res.error);
      return res.data.regions;
    },
  });

  // Facilities show district/region names, so refresh them too.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "districts"] });
    qc.invalidateQueries({ queryKey: ["admin", "facilities"] });
  };

  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const filtered = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return districts;
    return districts.filter((d) =>
      d.code.toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q) ||
      (d.region_name ?? "").toLowerCase().includes(q),
    );
  }, [districts, searchInput]);
  const paged = useMemo(() => filtered.slice(page * pageSize, (page + 1) * pageSize), [filtered, page, pageSize]);
  useEffect(() => { setPage(0); }, [searchInput, districts.length]);

  function openSheet(d: District | null) {
    setEditing(d);
    setCode(d?.code ?? "");
    setName(d?.name ?? "");
    setRegionId(d ? String(d.region_id) : "");
    setSheetOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!regionId) { toast.error("Select a region."); return; }
    setLoading(true);
    const body = { code: code.trim().toUpperCase(), name: name.trim(), region_id: Number(regionId) };
    const res = editing
      ? await api.put(`/admin/districts/${editing.id}`, body)
      : await api.post("/admin/districts", body);
    setLoading(false);
    if (res.error !== null) { toast.error(res.error); return; }
    toast.success(editing ? "District updated." : "District created.");
    invalidate();
    setSheetOpen(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b">
        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search code, name, region…"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setImportOpen(true)}>
          <FileUp className="h-3.5 w-3.5" /> Import CSV
        </Button>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openSheet(null)}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-24 text-xs uppercase tracking-wide">Code</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Name</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Region</TableHead>
              <TableHead className="w-24 text-xs uppercase tracking-wide">Facilities</TableHead>
              <TableHead className="w-20 text-right text-xs uppercase tracking-wide">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {districts.length === 0 ? "No districts yet." : "No districts match your search."}
                </TableCell>
              </TableRow>
            ) : paged.map((d) => (
              <TableRow
                key={d.id}
                className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                onClick={() => openSheet(d)}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">{d.code}</TableCell>
                <TableCell className="text-sm">{d.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{d.region_name ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{d.facility_count}</TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openSheet(d)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(d.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            <TableFillerRow colSpan={5} show={paged.length > 0} />
          </TableBody>
        </Table>
      </div>
      <TablePagination
        page={page}
        pageSize={pageSize}
        total={filtered.length}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        leftSlot={
          <span className="text-muted-foreground">
            {filtered.length} district{filtered.length === 1 ? "" : "s"}
            {searchInput && ` · filtered from ${districts.length}`}
          </span>
        }
      />

      <Sheet open={sheetOpen} onOpenChange={(v) => !v && setSheetOpen(false)}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          <SheetHeader className="px-6 py-4 border-b">
            <SheetTitle>{editing ? "Edit District" : "New District"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-y-auto">
            <div className="px-6 py-6">
              <div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-5">
                <Label className="text-right text-sm">Code</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. TMK" required />
                <Label className="text-right text-sm">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Temeke" required />
                <Label className="text-right text-sm">Region</Label>
                <Select value={regionId} onValueChange={setRegionId}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Select region…" /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {regions.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)} description={r.code}>{r.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <SheetFooter className="mt-auto px-6 py-4 border-t">
              <Button type="button" variant="outline" onClick={() => setSheetOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Save"}</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/admin/districts/import"
        hint="Required columns: district_code, district_name, region_code."
        onImported={invalidate}
      />

      <AlertDialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this district?</AlertDialogTitle>
            <AlertDialogDescription>Districts that still have facilities can't be deleted — reassign the facilities first.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const res = await api.delete(`/admin/districts/${deleteId}`);
                if (res.error !== null) { toast.error(res.error); return; }
                toast.success("District deleted.");
                invalidate();
                setDeleteId(null);
              }}
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 7: Wire the tab into `SetupPage.tsx`**

Add `import { DistrictsTab } from "@/components/setup/DistrictsTab";`. Change the tab list array to `["regions", "districts", "facilities", "departments", "roles", "titles"]`. Add between the regions and facilities `TabsContent` blocks:

```tsx
            <TabsContent value="districts" className="h-full mt-0">
              <DistrictsTab />
            </TabsContent>
```

- [ ] **Step 8: Facility form uses District** — in `SetupPage.tsx` `FacilitiesTab`:

1. Types: add `district_id: number | null; district_name: string | null;` to `interface Facility`. Delete `interface Region` if nothing else in the file uses it after step 4 below.
2. Imports: add `SelectLabel` to the `@/components/ui/select` import; add `import { groupDistrictsByRegion, type District } from "@/lib/setup/districts";`.
3. State: rename `regionId`/`setRegionId` to `districtId`/`setDistrictId`.
4. Replace the regions `useQuery` with:

```tsx
  const { data: districts = [] } = useQuery({
    queryKey: ["admin", "districts"],
    queryFn: async () => {
      const res = await api.get<{ districts: District[] }>("/admin/districts");
      if (res.error !== null) throw new Error(res.error);
      return res.data.districts;
    },
  });
  const districtGroups = useMemo(() => groupDistrictsByRegion(districts), [districts]);
```

5. Search filter: add `(f.district_name ?? "").toLowerCase().includes(q) ||` before the region clause; placeholder `"Search code, name, type, district, region…"`.
6. `openSheet`: `setDistrictId(facility?.district_id ? String(facility.district_id) : "");`
7. `handleSubmit`: add as the first line after `e.preventDefault();` — `if (!districtId) { toast.error("Select a district."); return; }` — and in `body` replace `region_id: …` with `district_id: Number(districtId),`.
8. Invalidate districts too (facility counts change):

```tsx
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "facilities"] });
    qc.invalidateQueries({ queryKey: ["admin", "districts"] });
  };
```

9. Table: add `<TableHead className="text-xs uppercase tracking-wide">District</TableHead>` before the Region header and `<TableCell className="text-xs text-muted-foreground">{f.district_name ?? "—"}</TableCell>` before the region cell; change every `colSpan={6}` in this tab to `colSpan={7}`.
10. Replace the Region `<Label>` + `<Select>` in the sheet with:

```tsx
                <Label className="text-right text-sm">District</Label>
                <Select value={districtId} onValueChange={setDistrictId}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Select district…" />
                  </SelectTrigger>
                  <SelectContent>
                    {districtGroups.map((g) => (
                      <SelectGroup key={g.region}>
                        <SelectLabel>{g.region}</SelectLabel>
                        {g.districts.map((d) => (
                          <SelectItem key={d.id} value={String(d.id)} description={d.code}>{d.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>

                <Label className="text-right text-sm text-muted-foreground">Region</Label>
                <span className="text-sm text-muted-foreground">
                  {districts.find((d) => String(d.id) === districtId)?.region_name ?? "Set by district"}
                </span>
```

11. Facilities import hint: `"Required columns: facility_code, facility_name, district_code. Optional: facility_type, region_code (must match the district). Existing codes get their district updated."`

- [ ] **Step 9: Sample CSVs**

Read `apps/web/public/data/regions.csv` and `facilities.csv` in full. Create `apps/web/public/data/districts.csv` (header `district_code,district_name,region_code`) with at least one real district for every region used by a facility, e.g.:

```csv
district_code,district_name,region_code
TMK,Temeke,DSM
ILA,Ilala,DSM
KIN,Kinondoni,DSM
NYA,Nyamagana,MWZ
ARC,Arusha City,ARU
DDC,Dodoma City,DOD
```

Change `facilities.csv`'s header to `facility_code,facility_name,facility_type,district_code,region_code` and give every row a `district_code` from `districts.csv` whose region matches that row's `region_code` (e.g. `MNH,Muhimbili National Hospital,National Referral Hospital,ILA,DSM`; `TMJ,Temeke Municipal Hospital,Regional Hospital,TMK,DSM`). Check every code resolves:

```bash
cd apps/web/public/data && tail -n +2 facilities.csv | cut -d, -f4 | sort -u
```

Each printed code must appear in `districts.csv`. (If any facility name contains a comma, the `cut` check is unreliable for that row — check it by eye.)

- [ ] **Step 10: Typecheck, lint, tests**

Run: `pnpm --filter @workforce-competency/web typecheck`, `pnpm --filter @workforce-competency/web lint`, `pnpm --filter @workforce-competency/web test`
Expected: clean; PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src apps/web/public/data
git commit -m "feat(web): Districts setup tab; facilities pick a district; import shows row errors"
```

---

### Task 9: Documentation

**Files:**
- Modify: `apps/web/src/docs/1.0.0/setup.md`, `reports.md`, `getting-started.md`, `users.md`, `README.md`, `apps/web/README.md`

- [ ] **Step 1: `setup.md`** — after the `## Regions` section add:

```md
## Districts

Sit between regions and facilities. Each district belongs to exactly one region, and every facility belongs to exactly one district — the facility's region is taken from its district.

- A district with facilities can't be deleted; reassign the facilities first.
- A region with districts can't be deleted.
- Moving a district to another region moves its facilities with it (historical responses keep the region they were submitted under).

CSV import columns: `district_code,district_name,region_code`.
```

In `## Facilities`, change "Belongs to a **region**" to "Belongs to a **district** (required; the region is derived from it)" and replace the CSV line with:

```md
CSV import columns: `facility_code,facility_name,facility_type,district_code,region_code` — `district_code` is required; `region_code` is optional and must match the district's region. Importing a code that already exists updates only that facility's district, which is the quickest way to assign districts to existing facilities.
```

In the recommended-order list make it: 1. **Regions** (nothing depends on this), 2. **Districts** (needs regions), 3. **Facilities** (needs districts), renumbering the rest.

- [ ] **Step 2: `reports.md`** — in the level table, change the Region row to `| Region        | Every district inside the region (plus facilities not yet assigned a district) | District |` and insert `| District      | Every facility inside the district                                   | Facility     |` below it. Add `/reports/districts/:id` to the URL example. Change the KPI bullet to "**Regions / Districts / Facilities / Departments covered**". After the unassigned-banner paragraph add:

```md
On a **Region** report, the banner counts respondents whose facility has no district yet. Those facilities are listed under **Facilities without a district** so you can still open them. Assigning a district (Setup › Facilities, or a facilities CSV import) also attributes that facility's earlier responses to the district.
```

In the staff-scoping paragraph add: "They can also open the report for their own district."

- [ ] **Step 3: Remaining mentions**
  - `getting-started.md`: "National → Region → Facility → Department → Individual" → "National → Region → District → Facility → Department → Individual"; in the setup list insert `   - Districts (belong to a region)` after Regions and change Facilities to `(belong to a district)`; "by region/facility/department/individual" → "by region/district/facility/department/individual".
  - `users.md`: "which region/facility" → "which region/district/facility".
  - `README.md` line 3: "facilities, regions" → "facilities, districts, regions"; line 166: "facility / department / region" → "facility / department / district / region".
  - `apps/web/README.md`: hierarchy string as above; `/setup` row → "Regions, districts, facilities, departments, org roles, titles"; drill-down routes line gains `/reports/districts/:id`; snapshot sentence → "`region_id` / `district_id` / `facility_id` / `department_id`".

- [ ] **Step 4: Verify no stale hierarchy strings remain**

Run: `grep -rn "Region → Facility" README.md apps/web/README.md apps/web/src/docs`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add README.md apps/web/README.md apps/web/src/docs
git commit -m "docs: districts in setup, reports and hierarchy docs"
```

---

### Task 10: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full checks**

```bash
pnpm --filter @workforce-competency/api test
pnpm typecheck
pnpm --filter @workforce-competency/web test
pnpm --filter @workforce-competency/web lint
```

Expected: all green. Keep the output for the report.

- [ ] **Step 2: Migration against a copy of real data** — if `apps/api/data/workforce.db` exists, copy it to the scratchpad and start the API with `DB_PATH=<copy>`; confirm the log shows `[db] migration 9 applied` and startup completes. Existing facilities must still appear on region reports under "Facilities without a district". Never point this at the original file.

- [ ] **Step 3: Manual walkthrough in the running app** (`pnpm dev`, local admin):
  1. Setup › Districts: import `apps/web/public/data/districts.csv`; add one by hand; try deleting a region that has districts (expect the 409 message as a toast).
  2. Setup › Facilities: import `facilities.csv` — existing codes count as "updated"; edit a facility: District select is grouped by region, Region shows read-only.
  3. Reports: National → region → districts chart → district → facilities → facility → department. Breadcrumbs read `Region › District › Facility` with working links.
  4. Export PDF, Excel and CSV on a region report (District column) and on a district report (Facility column, PDF title "District · …").
  5. As a staff user: own district report opens; another district's URL shows the 403 message.

- [ ] **Step 4: Report** — summarise results (quote any failures verbatim) to the user, then hand off with superpowers:finishing-a-development-branch. Do not merge or deploy.
