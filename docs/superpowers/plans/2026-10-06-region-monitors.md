# Region Monitors (Partner Users) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins create partner ("monitor") users assigned to one or more regions, who see aggregated region/district/facility reports for those regions and nothing else.

**Architecture:** New system role value `monitor` plus a `user_regions` link table. Report access is decided in one place (`denyReason` in `lib/report-scope.ts`), which gains a monitor branch; survey write routes reject monitors via a `denyMonitor` middleware. The web app reads `regions` off the auth user to pick a landing page, hides survey menu items and department drill-down, and the Users form gets a role-dependent Regions checklist.

**Tech Stack:** Express 5 + sql.js (SQLite) API in TypeScript (CommonJS), vitest + supertest; React + Vite + TanStack Query + zustand + shadcn/ui web app, vitest (node env, pure-logic tests only).

**Spec:** `docs/superpowers/specs/2026-10-06-region-monitors-design.md`

## Global Constraints

- Branch: `feat/region-monitors` (already created; spec committed there).
- New migration id is **10** (last existing is 9). Never edit earlier migrations.
- `PRAGMA foreign_keys` stays OFF — every referential rule is enforced in API code.
- Role string is exactly `'monitor'`. UI label is exactly **"Partner (monitor)"**; table badge text **"Partner"**.
- Monitors: `facility_id`, `department_id`, `org_role_id`, `title_id` all NULL; ≥1 region; only monitors have `user_regions` rows.
- A region cannot be deleted while a `user_regions` row references it (409).
- Monitor report access: national 403, department 403, individual 403 (incl. own), region/district/facility allowed only when the entity's **current** region is assigned.
- User objects from `/auth/me`, `/auth/login`, and `/admin/users*` carry `region_ids: number[]` and `regions: { id: number; name: string }[]` (empty for non-monitors).
- API tests live in `apps/api/test/`; web tests are `apps/web/src/**/*.test.ts`, node environment, no DOM — UI logic under test must be extracted into pure functions.
- Match surrounding style: section banners `// ── Name ───`, `try { … } catch (err) { next(err); }`, `createError(msg, status)`. Web Users/Reports pages are English-only literals (no `t()`), keep it that way.
- Run commands from the repo root with pnpm filters: `pnpm --filter @workforce-competency/api test`, `pnpm --filter @workforce-competency/web test`.

---

## File Map

**API**
- Modify `apps/api/src/db/migrations.ts` — migration 10 (`user_regions`).
- Modify `apps/api/src/lib/org.ts` — `getUserRegions`, `withRegions`.
- Modify `apps/api/src/lib/report-scope.ts` — `monitor` role, `regionIds`, monitor branch, null-facility fix.
- Modify `apps/api/src/middleware/auth.ts` — `denyMonitor`.
- Modify `apps/api/src/routes/survey.ts` — apply `denyMonitor` to write routes.
- Modify `apps/api/src/routes/admin.ts` — user placement validation, `user_regions` writes, region-delete guard, regions on user payloads.
- Modify `apps/api/src/routes/auth.ts` — regions on login and `/me` payloads.
- Modify `apps/api/test/helpers.ts` — reset `user_regions`, monitor users, `assignRegions`, `createDepartment`, mount survey/my-assessments/auth routers.
- Create `apps/api/test/reports-monitors.test.ts`, `apps/api/test/survey-monitors.test.ts`, `apps/api/test/admin-users-monitors.test.ts`; modify `apps/api/test/migration.test.ts`.

**Web**
- Modify `apps/web/src/store/auth.ts` — `AuthUser.regions`, `region_ids`.
- Create `apps/web/src/lib/reports/landing.ts` + `landing.test.ts` — report landing decision.
- Create `apps/web/src/components/reports/MonitorRegions.tsx` — "Your regions" cards.
- Modify `apps/web/src/pages/ReportsPage.tsx` — use landing helper, render `MonitorRegions`.
- Modify `apps/web/src/components/reports/levels/FacilityReport.tsx` — no department drill-down for monitors.
- Modify `apps/web/src/main.tsx` — `HomeRoute` redirect for monitors.
- Modify `apps/web/src/lib/menu-list.ts` + create `menu-list.test.ts`; modify `apps/web/src/components/admin-panel/menu.tsx` — `roles` allow-list.
- Create `apps/web/src/lib/users/placement.ts` + `placement.test.ts` — form → request body.
- Modify `apps/web/src/pages/UsersPage.tsx` — role option, Regions checklist, table display.

**Docs**
- Modify `apps/web/src/docs/1.0.0/users.md`, `apps/web/src/docs/1.0.0/reports.md`.

---

### Task 1: Migration 10 + test harness

**Files:**
- Modify: `apps/api/src/db/migrations.ts` (append after the `id: 9` entry, before the closing `];`)
- Modify: `apps/api/test/helpers.ts`
- Test: `apps/api/test/migration.test.ts`

**Interfaces:**
- Produces: table `user_regions(user_id, region_id)`; helpers `createUser({ role?: 'admin' | 'staff' | 'monitor'; facilityId? })`, `assignRegions(userId: number, regionIds: number[]): void`, `createDepartment(code: string, name: string, facilityId?: number): number`; `testApp()` additionally mounts `/survey`, `/my-assessments`, `/auth`.

- [ ] **Step 1: Write the failing migration test**

Append to `apps/api/test/migration.test.ts`:

```ts
describe('migration 10 — user_regions', () => {
  beforeAll(initTestDb);

  it('creates the user_regions link table', () => {
    expect(columns('user_regions')).toEqual(['user_id', 'region_id']);
  });

  it('indexes user_regions by region', () => {
    const idx = query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_user_regions_region'",
    );
    expect(idx).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workforce-competency/api test -- migration`
Expected: FAIL — `user_regions` columns are `[]`.

- [ ] **Step 3: Add migration 10**

In `apps/api/src/db/migrations.ts`, after the `id: 9` object:

```ts
  {
    id: 10,
    sql: `
      -- Partner (monitor) users are scoped to one or more regions instead of a
      -- facility. Foreign keys are not enforced — the admin API keeps this
      -- table consistent (monitor-only rows, no dangling regions).

      CREATE TABLE IF NOT EXISTS user_regions (
        user_id   INTEGER NOT NULL REFERENCES users(id),
        region_id INTEGER NOT NULL REFERENCES regions(id),
        PRIMARY KEY (user_id, region_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_regions_region ON user_regions(region_id);
    `,
  },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @workforce-competency/api test -- migration`
Expected: PASS (all migration tests).

- [ ] **Step 5: Extend test helpers**

In `apps/api/test/helpers.ts`:

Add imports next to the existing router imports:

```ts
import surveyRouter from '../src/routes/survey';
import myAssessmentsRouter from '../src/routes/my-assessments';
import authRouter from '../src/routes/auth';
```

Replace `TABLES` with (child tables first):

```ts
const TABLES = [
  'user_regions', 'user_assessment_responses', 'user_assessments', 'facility_departments',
  'facilities', 'districts', 'regions', 'departments', 'users',
];
```

In `testApp()`, after `app.use('/reports', reportsRouter);`:

```ts
  app.use('/survey', surveyRouter);
  app.use('/my-assessments', myAssessmentsRouter);
  app.use('/auth', authRouter);
```

Change the `createUser` signature's role type to `'admin' | 'staff' | 'monitor'`.

Append:

```ts
export function assignRegions(userId: number, regionIds: number[]): void {
  for (const rid of regionIds) {
    execute('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)', [userId, rid]);
  }
}

export function createDepartment(code: string, name: string, facilityId?: number): number {
  execute('INSERT INTO departments (code, name) VALUES (?, ?)', [code, name]);
  const [row] = query<{ id: number }>('SELECT id FROM departments WHERE code = ? COLLATE NOCASE', [code]);
  const id = row?.id ?? 0;
  if (facilityId) {
    execute('INSERT INTO facility_departments (facility_id, department_id) VALUES (?, ?)', [facilityId, id]);
  }
  return id;
}
```

- [ ] **Step 6: Run the full API suite**

Run: `pnpm --filter @workforce-competency/api test`
Expected: PASS — existing tests unaffected by the extra routers and reset table.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/migrations.ts apps/api/test/migration.test.ts apps/api/test/helpers.ts
git commit -m "feat(api): user_regions table for partner users"
```

---

### Task 2: Monitor report scoping + null-facility fix

**Files:**
- Modify: `apps/api/src/lib/report-scope.ts`
- Test: `apps/api/test/reports-monitors.test.ts` (create)

**Interfaces:**
- Consumes: `user_regions` (Task 1); helpers `createUser`, `assignRegions`, `createDepartment` (Task 1), `createRegion`, `createDistrict`, `createFacility` (existing).
- Produces: `Scope { role: 'staff' | 'admin' | 'monitor'; …; regionIds: number[] }`. `denyReason` signature unchanged for callers.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/reports-monitors.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { execute } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createRegion, createDistrict, createFacility,
  createUser, assignRegions, createDepartment,
} from './helpers';

const app = testApp();
const get = (path: string, userId: number) => request(app).get(path).set(asUser(userId));

describe('monitor report scope', () => {
  let monitor: number, staffDsm: number;
  let dsm: number, mwz: number, aru: number;
  let tmk: number, ard: number;
  let fDsm: number, fMwz: number, fAru: number, dept: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    dsm = createRegion('DSM', 'Dar es Salaam');
    mwz = createRegion('MWZ', 'Mwanza');
    aru = createRegion('ARU', 'Arusha');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    const nya = createDistrict('NYA', 'Nyamagana', mwz);
    ard = createDistrict('ARD', 'Arusha DC', aru);
    fDsm = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    fMwz = createFacility('F2', 'Nyamagana Clinic', { regionId: mwz, districtId: nya });
    fAru = createFacility('F3', 'Arusha Lab', { regionId: aru, districtId: ard });
    dept = createDepartment('LAB', 'Laboratory', fDsm);
    staffDsm = createUser({ facilityId: fDsm });
    monitor = createUser({ role: 'monitor' });
    assignRegions(monitor, [dsm, mwz]);
  });

  it('can view every assigned region', async () => {
    expect((await get(`/reports/regions/${dsm}`, monitor)).status).toBe(200);
    expect((await get(`/reports/regions/${mwz}`, monitor)).status).toBe(200);
  });

  it('cannot view an unassigned region', async () => {
    expect((await get(`/reports/regions/${aru}`, monitor)).status).toBe(403);
  });

  it('can view districts and facilities inside assigned regions only', async () => {
    expect((await get(`/reports/districts/${tmk}`, monitor)).status).toBe(200);
    expect((await get(`/reports/districts/${ard}`, monitor)).status).toBe(403);
    expect((await get(`/reports/facilities/${fDsm}`, monitor)).status).toBe(200);
    expect((await get(`/reports/facilities/${fMwz}`, monitor)).status).toBe(200);
    expect((await get(`/reports/facilities/${fAru}`, monitor)).status).toBe(403);
  });

  it('cannot view the national report', async () => {
    expect((await get('/reports/national', monitor)).status).toBe(403);
  });

  it('cannot view department reports, even inside an assigned region', async () => {
    expect((await get(`/reports/departments/${dept}`, monitor)).status).toBe(403);
  });

  it('cannot view individual reports, including their own', async () => {
    expect((await get(`/reports/users/${staffDsm}`, monitor)).status).toBe(403);
    expect((await get(`/reports/users/${monitor}`, monitor)).status).toBe(403);
  });

  it('follows the facility when it moves to an unassigned region', async () => {
    execute('UPDATE facilities SET region_id = ? WHERE id = ?', [aru, fDsm]);
    expect((await get(`/reports/facilities/${fDsm}`, monitor)).status).toBe(403);
  });

  it('a monitor with no regions sees nothing', async () => {
    const empty = createUser({ role: 'monitor' });
    expect((await get(`/reports/regions/${dsm}`, empty)).status).toBe(403);
  });
});

describe('staff individual-report scope without a facility', () => {
  beforeAll(initTestDb);
  beforeEach(resetDb);

  it('a facility-less staff user cannot view another facility-less user', async () => {
    const a = createUser();
    const b = createUser();
    expect((await get(`/reports/users/${b}`, a)).status).toBe(403);
  });

  it('a facility-less staff user can still view their own report', async () => {
    const a = createUser();
    expect((await get(`/reports/users/${a}`, a)).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @workforce-competency/api test -- reports-monitors`
Expected: FAIL — monitors are treated as facility-less staff (403 for assigned regions; facility-less staff can view each other's reports).

- [ ] **Step 3: Implement the monitor branch and the fix**

In `apps/api/src/lib/report-scope.ts`:

Add to the header comment's policy list:

```ts
//   - monitor → partner user scoped to the regions in user_regions. May view
//               region / district / facility reports inside those regions only
//               (by the entity's current region). Never national, department
//               (per-person grid) or individual reports.
```

Replace the `Scope` interface and `getScope`:

```ts
export interface Scope {
  role: 'staff' | 'admin' | 'monitor';
  userId: number;
  facilityId: number | null;
  departmentId: number | null;
  regionId: number | null;
  districtId: number | null;
  /** Assigned regions — monitors only; empty for everyone else. */
  regionIds: number[];
}

export function getScope(userId: number): Scope {
  const [row] = query<{
    role: 'staff' | 'admin' | 'monitor';
    facility_id: number | null;
    department_id: number | null;
    region_id: number | null;
    district_id: number | null;
  }>(
    `SELECT u.role, u.facility_id, u.department_id, f.region_id, f.district_id
     FROM users u LEFT JOIN facilities f ON f.id = u.facility_id
     WHERE u.id = ?`,
    [userId],
  );
  const role = row?.role ?? 'staff';
  const regionIds = role === 'monitor'
    ? query<{ region_id: number }>('SELECT region_id FROM user_regions WHERE user_id = ?', [userId])
        .map((r) => r.region_id)
    : [];
  return {
    role,
    userId,
    facilityId: row?.facility_id ?? null,
    departmentId: row?.department_id ?? null,
    regionId: row?.region_id ?? null,
    districtId: row?.district_id ?? null,
    regionIds,
  };
}
```

Extract the request union into a named type above `denyReason`, and add the monitor rules:

```ts
type ReportRequest =
  | { level: 'national' }
  | { level: 'region'; regionId: number }
  | { level: 'district'; districtId: number }
  | { level: 'facility'; facilityId: number }
  | { level: 'department'; departmentId: number }
  | { level: 'user'; targetUserId: number };

const OUT_OF_REGION = 'Partner users may only view reports for their assigned regions';

function monitorDenyReason(scope: Scope, requested: ReportRequest): string | null {
  const assigned = (regionId: number | null | undefined) =>
    regionId != null && scope.regionIds.includes(regionId);

  switch (requested.level) {
    case 'national':
      return 'Partner users may not view the national report';
    case 'region':
      return assigned(requested.regionId) ? null : OUT_OF_REGION;
    case 'district': {
      const [d] = query<{ region_id: number | null }>(
        'SELECT region_id FROM districts WHERE id = ?', [requested.districtId],
      );
      return assigned(d?.region_id) ? null : OUT_OF_REGION;
    }
    case 'facility': {
      const [f] = query<{ region_id: number | null }>(
        'SELECT region_id FROM facilities WHERE id = ?', [requested.facilityId],
      );
      return assigned(f?.region_id) ? null : OUT_OF_REGION;
    }
    case 'department':
      return 'Partner users may not view department reports';
    case 'user':
      return 'Partner users may not view individual reports';
  }
}
```

Change `denyReason`'s second parameter type to `requested: ReportRequest`, and right after `if (scope.role === 'admin') return null;` add:

```ts
  if (scope.role === 'monitor') return monitorDenyReason(scope, requested);
```

In the staff `case 'user':` branch, after `if (requested.targetUserId === scope.userId) return null;` add:

```ts
      // NULL === NULL would otherwise let facility-less users see each other.
      if (scope.facilityId == null) return 'Staff users may only view reports for users in their facility';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workforce-competency/api test`
Expected: PASS — new file green, `reports-districts` staff tests still green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @workforce-competency/api typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/report-scope.ts apps/api/test/reports-monitors.test.ts
git commit -m "feat(api): region-scoped report access for partner users" -m "Also deny individual reports between facility-less staff users (NULL facility ids compared equal)."
```

---

### Task 3: Block monitors from taking assessments

**Files:**
- Modify: `apps/api/src/middleware/auth.ts`
- Modify: `apps/api/src/routes/survey.ts` — import (line 3), routes at lines 33, 96, 135
- Test: `apps/api/test/survey-monitors.test.ts` (create)

**Interfaces:**
- Consumes: helpers from Task 1.
- Produces: `denyMonitor(req, res, next)` exported from `middleware/auth.ts`; responds 403 `"Partner users do not take assessments"`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/survey-monitors.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { initTestDb, resetDb, testApp, asUser, createUser, createRegion, assignRegions } from './helpers';

const app = testApp();
const session = { domain_code: 'LAB', domain_name: 'Lab' };

describe('monitors and the survey', () => {
  let monitor: number, staff: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    monitor = createUser({ role: 'monitor' });
    assignRegions(monitor, [createRegion('DSM', 'Dar es Salaam')]);
    staff = createUser();
  });

  it('a monitor cannot start a session', async () => {
    const res = await request(app).post('/survey/sessions').set(asUser(monitor)).send(session);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/do not take assessments/);
  });

  it('a monitor cannot save or complete a session', async () => {
    const created = await request(app).post('/survey/sessions').set(asUser(staff)).send(session);
    const id = created.body.session.id;
    expect((await request(app).put(`/survey/sessions/${id}`).set(asUser(monitor)).send({ survey_data: '{}' })).status).toBe(403);
    expect((await request(app).post(`/survey/sessions/${id}/complete`).set(asUser(monitor)).send({ survey_data: '{}' })).status).toBe(403);
  });

  it('staff can still start a session', async () => {
    const res = await request(app).post('/survey/sessions').set(asUser(staff)).send(session);
    expect(res.status).toBe(201);
  });

  it('a monitor gets empty lists', async () => {
    const sessions = await request(app).get('/survey/sessions').set(asUser(monitor));
    expect(sessions.status).toBe(200);
    expect(sessions.body.sessions).toEqual([]);
    const mine = await request(app).get('/my-assessments').set(asUser(monitor));
    expect(mine.status).toBe(200);
    expect(mine.body.assessments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @workforce-competency/api test -- survey-monitors`
Expected: FAIL — monitor POST returns 201.

- [ ] **Step 3: Add `denyMonitor`**

Append to `apps/api/src/middleware/auth.ts`:

```ts
/**
 * Rejects partner (monitor) users — they observe reports and never take
 * assessments. Must be used after requireAuth.
 */
export function denyMonitor(req: Request, _res: Response, next: NextFunction): void {
  const rows = query<{ role: string }>('SELECT role FROM users WHERE id = ?', [req.session.userId!]);
  if (rows[0]?.role === 'monitor') {
    return next(createError('Partner users do not take assessments', 403));
  }
  next();
}
```

- [ ] **Step 4: Apply it to survey write routes**

In `apps/api/src/routes/survey.ts`, change the import to:

```ts
import { requireAuth, requirePasswordChanged, denyMonitor } from '../middleware/auth';
```

and insert `denyMonitor,` as the first handler on these three routes only:

```ts
router.post('/sessions', denyMonitor, (req: Request, res: Response, next: NextFunction) => {
router.put('/sessions/:id', denyMonitor, (req: Request, res: Response, next: NextFunction) => {
router.post('/sessions/:id/complete', denyMonitor, (req: Request, res: Response, next: NextFunction) => {
```

GET routes stay open (they return a monitor's empty lists). DELETE stays as-is: a monitor has no sessions to abandon.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @workforce-competency/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/middleware/auth.ts apps/api/src/routes/survey.ts apps/api/test/survey-monitors.test.ts
git commit -m "feat(api): partner users cannot take assessments"
```

---

### Task 4: Admin users API — regions, validation, region-delete guard

**Files:**
- Modify: `apps/api/src/lib/org.ts` (append)
- Modify: `apps/api/src/routes/admin.ts` — org import (line 10), `regionsRouter.beforeDelete` (lines 143–147), `sanitiseUser` (~line 426), users `POST /` (~438–463), `PUT /:id` (~465–494)
- Test: `apps/api/test/admin-users-monitors.test.ts` (create)

**Interfaces:**
- Consumes: helpers from Task 1.
- Produces (in `lib/org.ts`):
  - `getUserRegions(userId: number): { id: number; name: string }[]` — ordered by name.
  - `withRegions<T extends { id: number }>(user: T): T & { regions: { id: number; name: string }[]; region_ids: number[] }`
- Produces (HTTP): `POST/PUT /admin/users` accept `region_ids: number[]`; every admin user payload includes `regions` and `region_ids`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/admin-users-monitors.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { query } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createUser, createRegion, createDistrict, createFacility, assignRegions,
} from './helpers';

const app = testApp();

let n = 0;
const person = () => {
  n++;
  return { first_name: 'Pat', last_name: `Partner${n}`, national_id: `P${n}`, id_type: 'NIN', email: `p${n}@ngo.test` };
};

describe('admin: partner (monitor) users', () => {
  let admin: number, dsm: number, mwz: number, fac: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
    dsm = createRegion('DSM', 'Dar es Salaam');
    mwz = createRegion('MWZ', 'Mwanza');
    fac = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: createDistrict('TMK', 'Temeke', dsm) });
  });

  const post = (body: object) => request(app).post('/admin/users').set(asUser(admin)).send(body);
  const put = (id: number, body: object) => request(app).put(`/admin/users/${id}`).set(asUser(admin)).send(body);

  it('creates a monitor with regions', async () => {
    const res = await post({ ...person(), role: 'monitor', region_ids: [mwz, dsm] });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('monitor');
    expect(res.body.user.region_ids).toEqual([dsm, mwz]);
    expect(res.body.user.regions).toEqual([{ id: dsm, name: 'Dar es Salaam' }, { id: mwz, name: 'Mwanza' }]);
  });

  it('rejects a monitor without regions', async () => {
    expect((await post({ ...person(), role: 'monitor', region_ids: [] })).status).toBe(400);
    expect((await post({ ...person(), role: 'monitor' })).status).toBe(400);
  });

  it('rejects a monitor with a facility', async () => {
    expect((await post({ ...person(), role: 'monitor', region_ids: [dsm], facility_id: fac })).status).toBe(400);
  });

  it('rejects an unknown region', async () => {
    expect((await post({ ...person(), role: 'monitor', region_ids: [99999] })).status).toBe(400);
  });

  it('rejects regions on a staff user', async () => {
    expect((await post({ ...person(), role: 'staff', region_ids: [dsm] })).status).toBe(400);
  });

  it('does not create the user when validation fails', async () => {
    const p = person();
    await post({ ...p, role: 'monitor', region_ids: [99999] });
    expect(query('SELECT id FROM users WHERE email = ?', [p.email])).toHaveLength(0);
  });

  it('replaces regions on update and keeps them when omitted', async () => {
    const created = await post({ ...person(), role: 'monitor', region_ids: [dsm] });
    const id = created.body.user.id;
    const updated = await put(id, { region_ids: [mwz] });
    expect(updated.status).toBe(200);
    expect(updated.body.user.region_ids).toEqual([mwz]);
    const renamed = await put(id, { first_name: 'Renamed' });
    expect(renamed.body.user.region_ids).toEqual([mwz]);
  });

  it('clears regions when a monitor becomes staff', async () => {
    const created = await post({ ...person(), role: 'monitor', region_ids: [dsm] });
    const id = created.body.user.id;
    const res = await put(id, { role: 'staff', facility_id: fac });
    expect(res.status).toBe(200);
    expect(res.body.user.region_ids).toEqual([]);
    expect(query('SELECT * FROM user_regions WHERE user_id = ?', [id])).toHaveLength(0);
  });

  it('requires clearing the facility when a staff user becomes a monitor', async () => {
    const staff = createUser({ facilityId: fac });
    expect((await put(staff, { role: 'monitor', region_ids: [dsm] })).status).toBe(400);
    expect((await put(staff, { role: 'monitor', region_ids: [dsm], facility_id: null })).status).toBe(200);
  });

  it('lists users with their regions', async () => {
    const m = createUser({ role: 'monitor' });
    assignRegions(m, [dsm]);
    const res = await request(app).get('/admin/users').set(asUser(admin));
    const row = res.body.users.find((u: { id: number }) => u.id === m);
    expect(row.regions).toEqual([{ id: dsm, name: 'Dar es Salaam' }]);
    const adminRow = res.body.users.find((u: { id: number }) => u.id === admin);
    expect(adminRow.region_ids).toEqual([]);
  });

  it('blocks deleting a region assigned to a partner user', async () => {
    const bare = createRegion('ARU', 'Arusha');
    const m = createUser({ role: 'monitor' });
    assignRegions(m, [bare]);
    const res = await request(app).delete(`/admin/regions/${bare}`).set(asUser(admin));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/partner user is still assigned/);
  });
});

describe('auth: /me exposes regions', () => {
  beforeAll(initTestDb);
  beforeEach(resetDb);

  it('returns regions for a monitor', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    const m = createUser({ role: 'monitor' });
    assignRegions(m, [dsm]);
    const res = await request(app).get('/auth/me').set(asUser(m));
    expect(res.status).toBe(200);
    expect(res.body.user.region_ids).toEqual([dsm]);
    expect(res.body.user.regions).toEqual([{ id: dsm, name: 'Dar es Salaam' }]);
  });

  it('returns empty regions for staff', async () => {
    const s = createUser();
    const res = await request(app).get('/auth/me').set(asUser(s));
    expect(res.body.user.region_ids).toEqual([]);
  });
});
```

(The `auth: /me` block is satisfied by Task 5; it lives here so all user-payload assertions sit together. This task runs only the `admin:` block.)

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @workforce-competency/api test -- admin-users-monitors -t "admin: partner"`
Expected: FAIL — `region_ids` undefined, no validation.

- [ ] **Step 3: Add region helpers to `lib/org.ts`**

Append to `apps/api/src/lib/org.ts`:

```ts
/** Regions assigned to a partner (monitor) user — empty for everyone else. */
export function getUserRegions(userId: number): { id: number; name: string }[] {
  return query<{ id: number; name: string }>(
    `SELECT r.id, r.name FROM user_regions ur JOIN regions r ON r.id = ur.region_id
     WHERE ur.user_id = ? ORDER BY r.name`,
    [userId],
  );
}

/** Attach `regions` and `region_ids` to a user payload sent to the client. */
export function withRegions<T extends { id: number }>(
  user: T,
): T & { regions: { id: number; name: string }[]; region_ids: number[] } {
  const regions = getUserRegions(user.id);
  return { ...user, regions, region_ids: regions.map((r) => r.id) };
}
```

- [ ] **Step 4: Implement in `admin.ts`**

Change the org import (line 10) to:

```ts
import { resolveDistrict, backfillResponseDistrict, withRegions } from '../lib/org';
```

Replace the regions `beforeDelete` (lines 143–147) with:

```ts
  // Invariant 4 — FKs aren't enforced, so check here. Partner users count too.
  beforeDelete: (id) => {
    const [{ n }] = query<{ n: number }>('SELECT COUNT(*) AS n FROM districts WHERE region_id = ?', [id]);
    if (n > 0) return `${n} ${n === 1 ? 'district is' : 'districts are'} still assigned to this region`;
    const [{ m }] = query<{ m: number }>('SELECT COUNT(*) AS m FROM user_regions WHERE region_id = ?', [id]);
    return m > 0 ? `${m} partner ${m === 1 ? 'user is' : 'users are'} still assigned to this region` : null;
  },
```

In the Users section, change `sanitiseUser` to attach regions:

```ts
function sanitiseUser(u: UserRow & Record<string, unknown>) {
  const { password: _, ...safe } = u;
  return withRegions({ ...safe, id: u.id, is_first_login: Boolean(u.is_first_login), is_enabled: Boolean(u.is_enabled) });
}
```

Directly after `sanitiseUser`, add:

```ts
// ── Partner (monitor) placement ───────────────────────────────────────────────
// Monitors have no facility placement; they see reports for the regions in
// user_regions. Only monitors may have rows there (FKs aren't enforced).

type Placement = { facility_id: unknown; department_id: unknown; org_role_id: unknown; title_id: unknown };

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
```

Replace the body of `usersRouter.post('/', …)` with:

```ts
  try {
    const { first_name, last_name, national_id, id_type, email,
            facility_id, department_id, org_role_id, title_id, role = 'staff' } = req.body as Partial<UserRow>;
    if (!first_name || !last_name || !national_id || !id_type || !email)
      return next(createError('first_name, last_name, national_id, id_type, email are required', 400));
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
```

Replace the body of `usersRouter.put('/:id', …)` with:

```ts
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
```

Note: when a staff user becomes a monitor, `facility_id` etc. default to the existing values unless the client sends `null` — deliberate (see the "requires clearing the facility" test). The Users form sends explicit nulls (Task 8).

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @workforce-competency/api test -- admin-users-monitors -t "admin: partner"`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/api test`
Expected: only the two `auth: /me exposes regions` tests fail (fixed in Task 5); everything else passes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/org.ts apps/api/src/routes/admin.ts apps/api/test/admin-users-monitors.test.ts
git commit -m "feat(api): assign regions to partner users in the admin users API"
```

---

### Task 5: Regions on the auth user payload

**Files:**
- Modify: `apps/api/src/routes/auth.ts` (imports; `sanitiseUser` lines 23–30)
- Test: `apps/api/test/admin-users-monitors.test.ts` (`auth: /me exposes regions` block, written in Task 4)

**Interfaces:**
- Consumes: `withRegions` from `lib/org.ts` (Task 4).
- Produces: `/auth/login` and `/auth/me` `user` objects include `regions` and `region_ids`.

- [ ] **Step 1: Confirm the failing tests**

Run: `pnpm --filter @workforce-competency/api test -- admin-users-monitors -t "auth: /me"`
Expected: FAIL — `region_ids` undefined.

- [ ] **Step 2: Implement**

In `apps/api/src/routes/auth.ts`, add the import:

```ts
import { withRegions } from '../lib/org';
```

Replace `sanitiseUser`:

```ts
/** Strip sensitive fields before sending to the client. */
function sanitiseUser(user: UserRow) {
  const { password: _, ...safe } = user;
  return withRegions({
    ...safe,
    is_first_login: Boolean(user.is_first_login),
    is_enabled: Boolean(user.is_enabled),
  });
}
```

`/login` and `/me` already call `sanitiseUser`; nothing else changes.

- [ ] **Step 3: Run the full suite and typecheck**

Run: `pnpm --filter @workforce-competency/api test`
Expected: PASS (all files).
Run: `pnpm --filter @workforce-competency/api typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/auth.ts
git commit -m "feat(api): include assigned regions on the session user"
```

---

### Task 6: Web — monitor landing, "Your regions", no department drill-down

**Files:**
- Modify: `apps/web/src/store/auth.ts` (`AuthUser`)
- Create: `apps/web/src/lib/reports/landing.ts`, `apps/web/src/lib/reports/landing.test.ts`
- Create: `apps/web/src/components/reports/MonitorRegions.tsx`
- Modify: `apps/web/src/pages/ReportsPage.tsx` (redirect block ~lines 43–53; national render line)
- Modify: `apps/web/src/components/reports/levels/FacilityReport.tsx`
- Modify: `apps/web/src/main.tsx` (home route)

**Interfaces:**
- Consumes: `/auth/me` user `regions`, `region_ids` (Task 5).
- Produces:
  - `AuthUser.regions: { id: number; name: string }[]`, `AuthUser.region_ids: number[]`.
  - `type LandingUser = Pick<AuthUser, 'id' | 'role' | 'facility_id' | 'regions'>`
  - `reportsLanding(user: LandingUser | null, level: ReportLevel, baseUrl: string): { redirect: string | null; showRegionPicker: boolean }`
  - `<MonitorRegions regions={{ id, name }[]} />`

- [ ] **Step 1: Extend `AuthUser`**

In `apps/web/src/store/auth.ts`, add to `AuthUser` after `department_id`:

```ts
  /** Assigned regions — partner (monitor) users only; empty otherwise. */
  regions: { id: number; name: string }[];
  region_ids: number[];
```

- [ ] **Step 2: Write the failing landing tests**

Create `apps/web/src/lib/reports/landing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reportsLanding, type LandingUser } from "./landing";

const base = "/";
const u = (over: Partial<LandingUser>): LandingUser => ({
  id: 7, role: "staff", facility_id: null, regions: [], ...over,
});

describe("reportsLanding", () => {
  it("admins stay on the national report", () => {
    expect(reportsLanding(u({ role: "admin" }), "national", base))
      .toEqual({ redirect: null, showRegionPicker: false });
  });

  it("staff with a facility go to their facility", () => {
    expect(reportsLanding(u({ facility_id: 3 }), "national", base).redirect).toBe("/reports/facilities/3");
  });

  it("staff without a facility go to their own report", () => {
    expect(reportsLanding(u({}), "national", base).redirect).toBe("/reports/users/7");
  });

  it("a single-region monitor goes straight to that region", () => {
    const r = reportsLanding(u({ role: "monitor", regions: [{ id: 4, name: "Mwanza" }] }), "national", base);
    expect(r).toEqual({ redirect: "/reports/regions/4", showRegionPicker: false });
  });

  it("a multi-region monitor gets the region picker", () => {
    const regions = [{ id: 4, name: "Mwanza" }, { id: 5, name: "Arusha" }];
    expect(reportsLanding(u({ role: "monitor", regions }), "national", base))
      .toEqual({ redirect: null, showRegionPicker: true });
  });

  it("a monitor with no regions gets the (empty) picker, not a redirect", () => {
    expect(reportsLanding(u({ role: "monitor" }), "national", base))
      .toEqual({ redirect: null, showRegionPicker: true });
  });

  it("does nothing below the national level", () => {
    expect(reportsLanding(u({ role: "monitor", regions: [{ id: 4, name: "Mwanza" }] }), "region", base))
      .toEqual({ redirect: null, showRegionPicker: false });
  });

  it("does nothing before the user has loaded", () => {
    expect(reportsLanding(null, "national", base)).toEqual({ redirect: null, showRegionPicker: false });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @workforce-competency/web test -- landing`
Expected: FAIL — cannot resolve `./landing`.

- [ ] **Step 4: Implement `landing.ts`**

Create `apps/web/src/lib/reports/landing.ts`:

```ts
import type { AuthUser } from "@/store/auth";
import type { ReportLevel } from "@/types/reports";

export type LandingUser = Pick<AuthUser, "id" | "role" | "facility_id" | "regions">;

/**
 * Where a user lands when they open /reports (the national level).
 * Only admins may view the national report; everyone else is redirected:
 *   - monitor, one region   → that region
 *   - monitor, many / none  → stay, and show the "Your regions" picker
 *   - staff                 → their facility, or their own report if they have none
 */
export function reportsLanding(
  user: LandingUser | null,
  level: ReportLevel,
  baseUrl: string,
): { redirect: string | null; showRegionPicker: boolean } {
  const none = { redirect: null, showRegionPicker: false };
  if (!user || level !== "national" || user.role === "admin") return none;

  if (user.role === "monitor") {
    return user.regions.length === 1
      ? { redirect: `${baseUrl}reports/regions/${user.regions[0].id}`, showRegionPicker: false }
      : { redirect: null, showRegionPicker: true };
  }

  return {
    redirect: user.facility_id != null
      ? `${baseUrl}reports/facilities/${user.facility_id}`
      : `${baseUrl}reports/users/${user.id}`,
    showRegionPicker: false,
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @workforce-competency/web test -- landing`
Expected: PASS.

- [ ] **Step 6: Create `MonitorRegions.tsx`**

Create `apps/web/src/components/reports/MonitorRegions.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || '/';

interface Props { regions: { id: number; name: string }[] }

// Landing view for partner users assigned to several regions.
export function MonitorRegions({ regions }: Props) {
  if (regions.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No regions are assigned to your account yet. Ask an administrator to assign one.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">Your regions</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {regions.map((r) => (
          <Link
            key={r.id}
            to={`${baseUrl}reports/regions/${r.id}`}
            className="flex items-center gap-2 rounded-sm border bg-background px-4 py-3 text-sm transition-colors hover:bg-[rgba(70,130,180,0.08)]"
          >
            <MapPin className="h-4 w-4 text-muted-foreground" />
            {r.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Wire `ReportsPage.tsx`**

Add imports:

```ts
import { MonitorRegions } from '@/components/reports/MonitorRegions';
import { reportsLanding } from '@/lib/reports/landing';
```

Replace the block from the comment `// Staff cannot view the national report …` through the `: null;` that ends `redirectTarget`, plus the `useNationalReport(...)` line, with:

```ts
  // Only admins may view the national report (enforced by report-scope on the
  // API). Everyone else is redirected, or — partner users with several
  // regions — shown a region picker.
  const user = useAuthStore((s) => s.user);
  const { redirect: redirectTarget, showRegionPicker } = reportsLanding(user, level, baseUrl);

  // Fetch only the active level's data — other hooks stay disabled via null ids.
  const national   = useNationalReport(redirectTarget == null && !showRegionPicker);
```

Keep the existing comment line above the remaining hooks out (it now sits above `national`). Replace the national render line with:

```tsx
          {level === 'national'   && !showRegionPicker && <NationalReport />}
          {level === 'national'   && showRegionPicker  && <MonitorRegions regions={user?.regions ?? []} />}
```

- [ ] **Step 8: Disable department drill-down in `FacilityReport.tsx`**

Add the import:

```ts
import { useAuthStore } from '@/store/auth';
```

After `const navigate = useNavigate();` add:

```ts
  // Partner users can't open department reports (they list named people).
  const isMonitor = useAuthStore((s) => s.user?.role === 'monitor');
  const openDepartment = isMonitor
    ? undefined
    : (key: string) => navigate(`${baseUrl}reports/departments/${key}`);
```

Replace both department callbacks:

```tsx
            onBarClick={openDepartment}
```
```tsx
        onRowClick={openDepartment}
```

(`MaturityStackedBar.onBarClick` and `MaturityBreakdownTable.onRowClick` are already optional; the table drops its pointer cursor and drill-down column when `onRowClick` is undefined.)

- [ ] **Step 9: Redirect monitors away from the Survey home page**

In `apps/web/src/main.tsx`, change the router import to include `Navigate`:

```ts
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
```

and add:

```ts
import { useAuthStore } from "@/store/auth";
```

After the `const baseUrl = …` line (it is declared before `router`), add:

```tsx
// Partner (monitor) users never take assessments — their home is Reports.
function HomeRoute() {
  const isMonitor = useAuthStore((s) => s.user?.role === "monitor");
  return isMonitor ? <Navigate to={`${baseUrl}reports`} replace /> : <SurveyPage />;
}
```

Change the home child route to:

```tsx
      { path: baseUrl, element: <HomeRoute />, errorElement: <ErrorPage /> },
```

- [ ] **Step 10: Test and build**

Run: `pnpm --filter @workforce-competency/web test`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/web typecheck`
Expected: no errors.
Run: `pnpm --filter @workforce-competency/web build`
Expected: build succeeds.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/store/auth.ts apps/web/src/lib/reports/landing.ts apps/web/src/lib/reports/landing.test.ts apps/web/src/components/reports/MonitorRegions.tsx apps/web/src/pages/ReportsPage.tsx apps/web/src/components/reports/levels/FacilityReport.tsx apps/web/src/main.tsx
git commit -m "feat(web): partner users land on their regions in Reports"
```

---

### Task 7: Web — role-filtered menu

**Files:**
- Modify: `apps/web/src/lib/menu-list.ts` (`Menu` type ~lines 19–26, `Role` line 36, survey + my-assessments items, filter ~lines 110–115)
- Modify: `apps/web/src/components/admin-panel/menu.tsx:29-31`
- Test: `apps/web/src/lib/menu-list.test.ts` (create)

**Interfaces:**
- Produces: `Role = "admin" | "staff" | "monitor" | null`; `Menu.roles?: Exclude<Role, null>[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/menu-list.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getMenuList, type Role } from "./menu-list";

const labels = (role: Role) =>
  getMenuList("/", role).flatMap((g) => g.menus.map((m) => m.label));

describe("getMenuList", () => {
  it("monitors see only Reports and Docs", () => {
    expect(labels("monitor")).toEqual(["navigation.reports", "navigation.docs"]);
  });

  it("staff keep Survey and My Assessments", () => {
    expect(labels("staff")).toEqual([
      "navigation.survey", "navigation.my_assessments", "navigation.reports", "navigation.docs",
    ]);
  });

  it("admins see everything", () => {
    expect(labels("admin")).toEqual(expect.arrayContaining(["navigation.users", "navigation.survey"]));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workforce-competency/web test -- menu-list`
Expected: FAIL — the monitor list still contains survey and my_assessments.

- [ ] **Step 3: Implement**

In `apps/web/src/lib/menu-list.ts`:

```ts
export type Role = "admin" | "staff" | "monitor" | null;
```

Add to the `Menu` type, after `adminOnly?: boolean;`:

```ts
  /** If set, only these roles see the item. */
  roles?: Exclude<Role, null>[];
```

Add `roles: ["admin", "staff"],` to the `navigation.survey` and `navigation.my_assessments` menu objects.

Replace the filter comment and `menus:` line with:

```ts
  // Filter admin-only and role-restricted items, and drop groups that become
  // empty afterwards.
  return groups
    .map((g) => ({
      ...g,
      menus: g.menus.filter(
        (m) =>
          (!m.adminOnly || role === "admin") &&
          // Unknown role (still loading) keeps the default non-admin menu.
          (!m.roles || role === null || m.roles.includes(role)),
      ),
    }))
```

In `apps/web/src/components/admin-panel/menu.tsx`, add `type Role` to the existing `@/lib/menu-list` import and change the selector:

```ts
    (s) => (s.user?.role as Role | undefined) ?? null,
```

- [ ] **Step 4: Run tests and build**

Run: `pnpm --filter @workforce-competency/web test`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/web typecheck`
Expected: no errors.
Run: `pnpm --filter @workforce-competency/web build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/menu-list.ts apps/web/src/lib/menu-list.test.ts apps/web/src/components/admin-panel/menu.tsx
git commit -m "feat(web): hide survey menu items from partner users"
```

---

### Task 8: Web — Users page: Partner role and Regions checklist

**Files:**
- Create: `apps/web/src/lib/users/placement.ts`, `apps/web/src/lib/users/placement.test.ts`
- Modify: `apps/web/src/pages/UsersPage.tsx` — `User` interface (~line 89), `UserFormSheet` props/state/submit/JSX (~165–420), page queries (~630), search filter (~690), table cells (~830)

**Interfaces:**
- Consumes: `GET /admin/regions` → `{ regions: { id, code, name }[] }`; user payload `regions`, `region_ids` (Task 4).
- Produces: `type UserForm`, `type UserBody`, `buildUserBody(form: UserForm): UserBody` from `lib/users/placement.ts`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/users/placement.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildUserBody, type UserForm } from "./placement";

const form = (over: Partial<UserForm>): UserForm => ({
  first_name: "Pat", last_name: "Partner", national_id: "P1", id_type: "NRC", email: "p@ngo.test",
  role: "staff", facility_id: "3", department_id: "4", org_role_id: "5", title_id: "6",
  region_ids: [], is_enabled: true, ...over,
});

describe("buildUserBody", () => {
  it("staff keep their placement and send no regions", () => {
    const body = buildUserBody(form({ region_ids: [9] }));
    expect(body).toMatchObject({ facility_id: 3, department_id: 4, org_role_id: 5, title_id: 6, region_ids: [] });
  });

  it("monitors send regions and explicitly null placement", () => {
    const body = buildUserBody(form({ role: "monitor", region_ids: [2, 1] }));
    expect(body).toMatchObject({
      role: "monitor", facility_id: null, department_id: null, org_role_id: null, title_id: null, region_ids: [2, 1],
    });
  });

  it("empty selects become null", () => {
    const body = buildUserBody(form({ facility_id: "", department_id: "" }));
    expect(body.facility_id).toBeNull();
    expect(body.department_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workforce-competency/web test -- placement`
Expected: FAIL — cannot resolve `./placement`.

- [ ] **Step 3: Implement `placement.ts`**

Create `apps/web/src/lib/users/placement.ts`:

```ts
// Users form → admin API body. Partner (monitor) users have no facility
// placement; they are scoped by region_ids instead. Placement fields are sent
// as explicit nulls so the API clears them when a staff user becomes a monitor.

export interface UserForm {
  first_name: string;
  last_name: string;
  national_id: string;
  id_type: string;
  email: string;
  role: string;
  facility_id: string;
  department_id: string;
  org_role_id: string;
  title_id: string;
  region_ids: number[];
  is_enabled: boolean;
}

export type UserBody = Omit<UserForm, "facility_id" | "department_id" | "org_role_id" | "title_id"> & {
  facility_id: number | null;
  department_id: number | null;
  org_role_id: number | null;
  title_id: number | null;
};

const toId = (v: string) => (v ? Number(v) : null);

export function buildUserBody(form: UserForm): UserBody {
  const isMonitor = form.role === "monitor";
  return {
    ...form,
    facility_id: isMonitor ? null : toId(form.facility_id),
    department_id: isMonitor ? null : toId(form.department_id),
    org_role_id: isMonitor ? null : toId(form.org_role_id),
    title_id: isMonitor ? null : toId(form.title_id),
    region_ids: isMonitor ? form.region_ids : [],
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @workforce-competency/web test -- placement`
Expected: PASS.

- [ ] **Step 5: Update `UsersPage.tsx` — types and data**

Add imports:

```ts
import { Checkbox } from "@/components/ui/checkbox";
import { buildUserBody, type UserForm } from "@/lib/users/placement";
```

Add an interface next to `Facility`:

```ts
interface Region {
  id: number;
  code: string;
  name: string;
}
```

Add to the `User` interface after `title_name`:

```ts
  regions: { id: number; name: string }[];
  region_ids: number[];
```

In `UsersPage`, after the `titles` query, add:

```ts
  const { data: regions = [] } = useQuery({
    queryKey: ["admin", "regions"],
    queryFn: async () => {
      const r = await api.get<{ regions: Region[] }>("/admin/regions");
      if (r.error !== null) throw new Error(r.error);
      return r.data.regions;
    },
  });
```

and pass `regions={regions}` to `<UserFormSheet … />`.

In the search `filtered` memo, add a clause so partners are findable by region name:

```ts
        u.regions.some((r) => r.name.toLowerCase().includes(q)) ||
```

- [ ] **Step 6: Update `UserFormSheet`**

Add `regions: Region[];` to `UserFormSheetProps` and destructure `regions` in the function parameters.

Type the state with the shared form type and add `region_ids`:

```ts
  const [form, setForm] = useState<UserForm>({
    first_name: "",
    last_name: "",
    national_id: "",
    id_type: "NRC",
    email: "",
    role: "staff",
    facility_id: "",
    department_id: "",
    org_role_id: "",
    title_id: "",
    region_ids: [],
    is_enabled: true,
  });
```

In the `useEffect` reset object, add `region_ids: initial?.region_ids ?? [],` before `is_enabled`.

The existing `set` and `selProps` helpers use `keyof typeof form`; with `region_ids: number[]` in the type, `selProps("region_ids")` would be meaningless but isn't called — leave both helpers as they are.

Replace the start of `handleSubmit` (from `setLoading(true);` through the end of the `const body = { … };` literal) with:

```ts
    if (form.role === "monitor" && form.region_ids.length === 0) {
      toast.error("Select at least one region for a partner user.");
      return;
    }
    setLoading(true);
    const body = buildUserBody(form);
```

Add after `selProps`:

```ts
  const isMonitor = form.role === "monitor";
  const toggleRegion = (rid: number, on: boolean) =>
    setForm((f) => ({
      ...f,
      region_ids: on ? [...f.region_ids, rid] : f.region_ids.filter((x) => x !== rid),
    }));
```

In the System Role `<SelectContent>`, add after the Admin item:

```tsx
                  <SelectItem value="monitor">Partner (monitor)</SelectItem>
```

Wrap the four placement field pairs (Facility, Department, Org Role, Job Title — each a `<Label>` + `<Select>`) in `{!isMonitor && (<> … </>)}`, and directly before that block add:

```tsx
              {isMonitor && (
                <>
                  <Label className="self-start pt-1 text-right text-sm">Regions</Label>
                  <div className="flex flex-col gap-2">
                    {regions.length === 0 && (
                      <span className="text-xs text-muted-foreground">No regions set up yet.</span>
                    )}
                    {regions.map((r) => (
                      <label key={r.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={form.region_ids.includes(r.id)}
                          onCheckedChange={(v) => toggleRegion(r.id, v === true)}
                        />
                        {r.name}
                      </label>
                    ))}
                    <span className="text-xs text-muted-foreground">
                      Partners see summary reports for these regions only.
                    </span>
                  </div>
                </>
              )}
```

Switching role needs no extra clearing in state: `buildUserBody` drops placement for monitors and regions for everyone else at submit time.

- [ ] **Step 7: Update the users table cells**

Replace the facility cell:

```tsx
                        <TableCell className="text-xs text-muted-foreground">
                          {u.role === "monitor"
                            ? u.regions.map((r) => r.name).join(", ") || "—"
                            : u.facility_name ?? "—"}
                        </TableCell>
```

Replace the org role / title cell so partners carry a badge:

```tsx
                        <TableCell className="text-xs text-muted-foreground">
                          {u.role === "monitor" ? (
                            <Badge variant="outline" className="whitespace-nowrap text-[10px] uppercase">
                              Partner
                            </Badge>
                          ) : (
                            u.org_role_name ?? u.title_name ?? "—"
                          )}
                        </TableCell>
```

Find the matching `<TableHead>` for the facility column; if it reads "Facility", change it to "Facility / Regions".

- [ ] **Step 8: Test and build**

Run: `pnpm --filter @workforce-competency/web test`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/web typecheck`
Expected: no errors.
Run: `pnpm --filter @workforce-competency/web build`
Expected: succeeds.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/users/placement.ts apps/web/src/lib/users/placement.test.ts apps/web/src/pages/UsersPage.tsx
git commit -m "feat(web): create and edit partner users with assigned regions"
```

---

### Task 9: Docs

**Files:**
- Modify: `apps/web/src/docs/1.0.0/users.md` (line 19; new section after "Adding a user")
- Modify: `apps/web/src/docs/1.0.0/reports.md` (the passage on who can see which level)

- [ ] **Step 1: Update `users.md`**

Replace line 19 with:

```markdown
System role (`staff`, `admin` or `monitor`) gates access to Reviews, the national-level report and the survey — see **Partner (monitor) users** below.
```

Add after the "Adding a user" section (before `## Importing users from CSV`):

```markdown
## Partner (monitor) users

Use the **Partner (monitor)** role for people who monitor results but are not
assessed themselves — for example an NGO partner supporting a project.

- Pick one or more **Regions** instead of a facility. Facility, department, org
  role and title are not used for partners.
- Partners see summary reports for their regions: the region, its districts and
  its facilities (including per-department totals).
- Partners never see the national report, department reports or any
  individual's results, and cannot take assessments.
- A region can't be deleted while a partner is assigned to it — remove it from
  the partner first.
- CSV import creates staff only; add partners from the form.
```

- [ ] **Step 2: Update `reports.md`**

Find the passage describing which roles see which report levels (search for "staff" or "national"). Add:

```markdown
- **Partner (monitor)** users land on their region (or a "Your regions" list if
  they have several) and can drill down to districts and facilities in those
  regions. Department and individual reports are not available to them.
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/docs/1.0.0/users.md apps/web/src/docs/1.0.0/reports.md
git commit -m "docs: partner (monitor) users"
```

---

### Task 10: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full automated checks**

```bash
pnpm --filter @workforce-competency/api test
```
```bash
pnpm --filter @workforce-competency/api typecheck
```
```bash
pnpm --filter @workforce-competency/web test
```
```bash
pnpm --filter @workforce-competency/web typecheck
```
```bash
pnpm --filter @workforce-competency/web build
```

All must succeed.

- [ ] **Step 2: Manual check on a local build**

Start the app locally (see `README.md` for the dev command). As admin:
1. Ensure three regions exist, each with a district and a facility.
2. Create a partner user with two of the regions; note the temp password.
3. Try saving a partner with no regions — expect the toast error.
4. Try deleting an assigned region in Setup — expect the 409 message.

As the partner (after the first-login password change):
1. `/` redirects to `/reports`, which shows "Your regions" with two cards.
2. The menu shows only Reports and Docs.
3. Open a region → district → facility; department rows are not clickable.
4. Directly visit `/reports/regions/<third region id>`, `/reports/departments/<id>` and `/reports/users/<id>` — each shows the error state (403).
5. As admin, edit the partner down to one region; log in again as the partner → lands directly on that region.

- [ ] **Step 3: Report**

Summarise test counts and the manual results, and list anything that diverged from the spec.
