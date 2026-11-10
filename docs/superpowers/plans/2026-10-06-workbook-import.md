# Workbook Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-entity CSV imports with one previewed, atomic Excel workbook import for country setup (full sync with archiving) and a bundled, re-importable assessment catalogue workbook.

**Architecture:** The API parses uploaded `.xlsx` files with ExcelJS into typed rows (`lib/workbook/reader.ts`), a pure planner compares them with a database snapshot and returns an `ImportPlan` (changes, errors, warnings, sha256 fingerprint) plus internal operations, and an apply step re-plans, checks the fingerprint and writes everything in one sql.js transaction. Exports reuse the same tab specs, so an export is also the template. The web app uploads/downloads raw binaries and renders the plan in one shared `ImportWorkbookDialog` used by the Setup and Assessments pages.

**Tech Stack:** Express 5 + sql.js API (TypeScript, CommonJS), ExcelJS (new), vitest + supertest; React + Vite + TanStack Query + shadcn/ui web app, SheetJS (`xlsx`, already present) for the credentials download, vitest (node env, pure-logic tests).

**Spec:** docs/superpowers/specs/2026-10-06-workbook-import-design.md

## Global Constraints

- Scope: spec §1–§4, §6, §7 (except §5 partner complementary suppression, which is a separate plan already merged to `main` before this one runs — rebase/merge `main` into this branch first).
- Branch: `feat/workbook-import` (exists; holds the spec commit).
- Country setup tabs, in this order: `Read me`, `Regions`, `Districts`, `Departments`, `Facilities`, `Org Roles`, `Job Titles`, `Users`. Tab names and header names are matched case-insensitively (trimmed); `Read me` and unknown tabs/columns are ignored on import.
- Regions: **region_code**, **region_name** · Districts: **district_code**, **district_name**, **region_code** · Departments: **department_code**, **department_name** · Facilities: **facility_code**, **facility_name**, facility_type, **district_code**, department_codes · Org Roles: **role_code**, **role_name** · Job Titles: **title_code**, **title_name** · Users: **email**, **first_name**, **last_name**, **national_id**, **id_type**, system_role, facility_code, department_code, org_role_code, title_code, region_codes, status, username (bold = required).
- Catalogue tabs: `Read me`, `Domains` (**domain_code**, **domain_name**, **version**, purpose, introduction; key code), `Items` (**domain_code**, **competency_value**, competency_text, **subcompetency_value**, **subcompetency_text**, **beginner**, **competent**, **proficient**, **expert**, na; key domain + subcompetency), `Footnotes` (**domain_code**, **symbol**, **definition**, sort_order; key domain + symbol).
- Codes and emails match case-insensitively; codes are stored upper-case. `department_codes` / `region_codes` are `;`-separated (trimmed, empty entries ignored). Blank rows are skipped. `username` is written on export and ignored on import.
- Allowed values: `id_type` ∈ {NRC, Passport, Other} (case-insensitive, stored in this spelling; an existing user's unchanged legacy value is accepted); `system_role` ∈ {staff, admin, monitor}, default `staff`; `status` ∈ {active, disabled}, default `active`.
- Full sync per present tab; a missing tab = no change. Code change = remove(old) + add(new). A code matching an archived entity restores it (clears `archived_at`) and applies the row. Users matched by email keep username + password; new users get `generateUsername` + `generateTempPassword` and `is_first_login = 1`.
- Removal: with history → set `archived_at`; without → delete (plus `facility_departments` links, `user_regions` rows, and NULLing pointers on users). Users are never deleted — absent users are disabled (`is_enabled = 0`). History = any `user_assessment_responses` row (regions, districts, facilities, departments) or any user, enabled or not (org roles, titles).
- Errors block apply; warnings do not. Warning when more than 50% of a tab's existing active entities would be archived/deleted (users: disabled); the text always contains `this usually means the wrong file`.
- Lock-out guards: the importing admin (`req.session.userId`) may not be disabled, left out, or demoted; at least one active admin must remain.
- Migration id **11** adds `archived_at TEXT` to `regions`, `districts`, `facilities`, `departments`, `org_roles`, `user_titles`. Never edit migrations 1–10. `PRAGMA foreign_keys` stays OFF; referential rules live in code.
- Upload body: raw `.xlsx`, `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, ≤ 10 MB, parsed by `express.raw({ type: XLSX_MIME, limit: 10 MB })` on those routes only (`app.ts` JSON limit stays `1mb`). Wrong/missing body → 415; oversize → 413.
- Endpoints (admin only): `GET /admin/setup/export`, `POST /admin/setup/import/preview` → `{ plan }`, `POST /admin/setup/import/apply?fingerprint=…` → `{ plan, credentials }` (409 when the fingerprint differs, 422 when the plan has errors), `GET /assessments/catalogue/export`, `POST /assessments/catalogue/import/preview`, `POST /assessments/catalogue/import/apply?fingerprint=…` (add + update only).
- Admin list endpoints return active rows unless `?include_archived=1`; reports list an archived child only when it has respondents in the view, with `archived: true`; the web labels it "(archived)".
- Run commands from the repo root: `pnpm --filter @workforce-competency/api test`, `pnpm --filter @workforce-competency/api typecheck`, `pnpm --filter @workforce-competency/web test`, `pnpm --filter @workforce-competency/web typecheck`, `pnpm --filter @workforce-competency/web build` (build does NOT typecheck — always run typecheck too). Single test file: append `-- <name>`.
- Style: section banners `// ── Name ───…`, route handlers `try { … } catch (err) { next(err); }`, errors via `createError(msg, status)`. Web Setup/Users/Assessments pages use English literals (no `t()`). API tests live in `apps/api/test/` (only `src/` is typechecked); web tests are `apps/web/src/**/*.test.ts`, node env, no DOM.
- Commits: conventional (`feat(api): …`, `feat(web): …`, `chore: …`, `docs: …`), no attribution lines.

---

## File Map

**API — new**
- `apps/api/src/lib/workbook/xlsx.ts` — `XLSX_MIME`, `MAX_WORKBOOK_BYTES`, `loadWorkbook`, `workbookToBuffer`, `cellText`.
- `apps/api/src/lib/workbook/reader.ts` — tab specs, `readTab`, `readTabs`, `splitList`.
- `apps/api/src/lib/workbook/setup-format.ts` — country setup tab specs, allowed values, `readSetupWorkbook`.
- `apps/api/src/lib/workbook/plan.ts` — `ImportPlan` types, `newTab`, `diffFields`, `finalisePlan`, `fingerprintOf`.
- `apps/api/src/lib/workbook/setup-snapshot.ts` — `loadSetupSnapshot`.
- `apps/api/src/lib/workbook/setup-org.ts` — organisation-tab planner.
- `apps/api/src/lib/workbook/setup-users.ts` — Users-tab planner.
- `apps/api/src/lib/workbook/setup-planner.ts` — `planSetupImport`.
- `apps/api/src/lib/workbook/setup-apply.ts` — `applySetupOps`.
- `apps/api/src/lib/workbook/writer.ts` — `writeTab`, `writeReadme`, `appVersion`.
- `apps/api/src/lib/workbook/setup-export.ts` — `writeSetupWorkbook`.
- `apps/api/src/lib/workbook/http.ts` — `xlsxBody`, `workbookBody`, `sendWorkbook`.
- `apps/api/src/lib/workbook/catalogue.ts` — catalogue format, snapshot, planner, apply, writer.
- `apps/api/src/lib/credentials.ts` — `generateTempPassword`, `generateUsername` (moved from `admin.ts`).
- `apps/api/src/routes/admin-setup.ts`, `apps/api/src/routes/assessments-catalogue.ts`.
- `apps/api/seed-data/assessment-catalogue.xlsx` (generated once by a script that is then deleted).
- Tests: `workbook-reader`, `setup-plan-org`, `setup-plan-users`, `setup-import`, `setup-export`, `catalogue-import`, `seed-assessments`, `archived`, `csv-import-removed` (`apps/api/test/*.test.ts`).

**API — modified**
- `apps/api/package.json` (+ `exceljs`), `apps/api/src/db/migrations.ts` (migration 11), `apps/api/src/db/seed-assessments.ts` (workbook loader), `apps/api/src/server.ts` (await seeding), `apps/api/Dockerfile` (comment), `apps/api/src/routes/admin.ts`, `apps/api/src/routes/admin-districts.ts`, `apps/api/src/routes/assessments.ts`, `apps/api/src/routes/reports.ts`, `apps/api/test/helpers.ts`, `apps/api/test/migration.test.ts`, `apps/api/test/admin-districts.test.ts`, `apps/api/test/admin-facilities.test.ts`.

**API — deleted**
- `apps/api/seed-data/assessment_data.csv`, `apps/api/seed-data/footnotes.csv`, `apps/api/seed-data/assessments/*.csv` (19 files; `appendix_b.csv` stays), `apps/api/src/lib/csv.ts`.

**Web — new**
- `apps/web/src/lib/import/plan.ts` + `plan.test.ts`, `apps/web/src/components/import/ImportWorkbookDialog.tsx`, `apps/web/src/lib/setup/archived.ts` + `archived.test.ts`, `apps/web/src/lib/reports/archived.ts` + `archived.test.ts`, `apps/web/public/data/sample-country-setup.xlsx`.

**Web — modified**
- `apps/web/src/lib/api.ts`, `apps/web/src/pages/SetupPage.tsx`, `apps/web/src/components/setup/DistrictsTab.tsx`, `apps/web/src/lib/setup/districts.ts` + test, `apps/web/src/pages/UsersPage.tsx`, `apps/web/src/pages/AssessmentsPage.tsx`, `apps/web/src/types/reports.ts`, `apps/web/src/components/reports/levels/{National,Region,District,Facility}Report.tsx`, `apps/web/src/lib/reports/export-excel.ts`, `apps/web/src/lib/reports/export-pdf.ts`, docs `apps/web/src/docs/1.0.0/{setup,users,assessments,getting-started,reports}.md`.

**Web — deleted**
- `apps/web/src/components/setup/ImportDialog.tsx`, `apps/web/public/data/{departments,districts,facilities,org_roles,regions,user_titles,users}.csv`.

---

### Task 1: ExcelJS, workbook reader and test fixtures

**Files:**
- Modify: `apps/api/package.json` (dependency via pnpm)
- Create: `apps/api/src/lib/workbook/xlsx.ts`, `apps/api/src/lib/workbook/reader.ts`, `apps/api/src/lib/workbook/setup-format.ts`
- Modify: `apps/api/test/helpers.ts`
- Test: `apps/api/test/workbook-reader.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `xlsx.ts`: `XLSX_MIME: string`, `MAX_WORKBOOK_BYTES = 10 * 1024 * 1024`, `loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook>` (throws `createError(…, 400)` on unreadable input), `workbookToBuffer(wb: ExcelJS.Workbook): Promise<Buffer>`, `cellText(value: ExcelJS.CellValue): string`.
  - `reader.ts`: `interface ColumnSpec { name: string; required: boolean }`, `interface TabSpec { name: string; columns: ColumnSpec[] }`, `interface RowError { row: number; column: string | null; message: string }`, `interface SheetRow { row: number; values: Record<string, string> }`, `interface ParsedTab { headerOk: boolean; rows: SheetRow[]; errors: RowError[]; badRows: Set<number> }`, `req(name)`, `opt(name)`, `findSheet(wb, name)`, `readTab(ws, spec): ParsedTab`, `readTabs(wb, specs): Record<string, ParsedTab | null>`, `splitList(value: string): string[]`.
  - `setup-format.ts`: `TAB` (const object of the seven tab names), `type SetupTabName`, `README_TAB = 'Read me'`, `SETUP_TABS: TabSpec[]`, `USERS_COLUMNS: string[]`, `USERNAME_COLUMN = 'username'`, `ID_TYPES`, `SYSTEM_ROLES`, `STATUSES` (readonly tuples), `type ParsedSetup = Record<SetupTabName, ParsedTab | null>`, `readSetupWorkbook(buffer: Buffer): Promise<ParsedSetup>`.
  - `test/helpers.ts`: `testApp()` also mounts `/assessments`; `resetDb()` also clears `org_roles`, `user_titles`; `createUser(opts)` gains `departmentId, orgRoleId, titleId, email, firstName, lastName, nationalId, idType, enabled`; new `createOrgRole(code, name): number`, `createTitle(code, name): number`, `type SheetData = Record<string, (string | number | null)[][]>`, `buildWorkbook(sheets: SheetData): Promise<Buffer>`, `binaryParser` (supertest `.parse()`), `USERS_HEADER: string[]`, `userSheetRow(id: number): string[]`.

- [ ] **Step 1: Add ExcelJS**

```bash
pnpm --filter @workforce-competency/api add exceljs@^4.4.0
```

Expected: `apps/api/package.json` gains `"exceljs": "^4.4.0"` under `dependencies`; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Extend the test helpers**

In `apps/api/test/helpers.ts`:

Add after the existing `import express from 'express';` line:

```ts
import * as ExcelJS from 'exceljs';
```

Add after `import authRouter from '../src/routes/auth';`:

```ts
import assessmentsRouter from '../src/routes/assessments';
import { workbookToBuffer } from '../src/lib/workbook/xlsx';
```

Replace the `TABLES` constant with:

```ts
const TABLES = [
  'user_regions', 'user_assessment_responses', 'user_assessments', 'facility_departments',
  'facilities', 'districts', 'regions', 'departments', 'users', 'org_roles', 'user_titles',
];
```

In `testApp()`, after `app.use('/auth', authRouter);` add:

```ts
  app.use('/assessments', assessmentsRouter);
```

Replace the whole `createUser` function with:

```ts
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
```

Append to the end of the file:

```ts
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
```

- [ ] **Step 3: Write the failing reader tests**

Create `apps/api/test/workbook-reader.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cellText, loadWorkbook } from '../src/lib/workbook/xlsx';
import { readTab, splitList, req, opt, TabSpec } from '../src/lib/workbook/reader';
import { readSetupWorkbook } from '../src/lib/workbook/setup-format';
import { buildWorkbook, USERS_HEADER } from './helpers';

const REGIONS: TabSpec = { name: 'Regions', columns: [req('region_code'), req('region_name'), opt('note')] };

async function sheet(rows: (string | number | null)[][]) {
  const wb = await loadWorkbook(await buildWorkbook({ Regions: rows }));
  return wb.worksheets[0];
}

describe('cellText', () => {
  it('turns every kind of cell value into trimmed text', () => {
    expect(cellText('  DSM ')).toBe('DSM');
    expect(cellText(3830)).toBe('3830');
    expect(cellText(1.01)).toBe('1.01');
    expect(cellText(true)).toBe('true');
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
    expect(cellText({ richText: [{ text: 'Dar ' }, { text: 'es Salaam ' }] } as never)).toBe('Dar es Salaam');
    expect(cellText({ text: ' mail ', hyperlink: 'mailto:a@b.c' } as never)).toBe('mail');
    expect(cellText({ formula: 'A1', result: 'X' } as never)).toBe('X');
    expect(cellText(new Date('2026-10-06T00:00:00Z'))).toBe('2026-10-06');
  });
});

describe('loadWorkbook', () => {
  it('rejects a file that is not an .xlsx workbook with 400', async () => {
    await expect(loadWorkbook(Buffer.from('not a workbook'))).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('readTab', () => {
  it('reads rows by header name, case-insensitively, with spreadsheet row numbers', async () => {
    const t = readTab(await sheet([
      ['Region_Code', ' REGION_NAME '],
      ['DSM', 'Dar es Salaam'],
      [null, null],
      ['mwz', ' Mwanza '],
    ]), REGIONS);
    expect(t.headerOk).toBe(true);
    expect(t.errors).toEqual([]);
    expect(t.rows).toEqual([
      { row: 2, values: { region_code: 'DSM', region_name: 'Dar es Salaam', note: '' } },
      { row: 4, values: { region_code: 'mwz', region_name: 'Mwanza', note: '' } },
    ]);
  });

  it('reports missing required columns and reads no rows', async () => {
    const t = readTab(await sheet([['region_code'], ['DSM']]), REGIONS);
    expect(t.headerOk).toBe(false);
    expect(t.rows).toEqual([]);
    expect(t.errors).toEqual([{ row: 1, column: 'region_name', message: 'Missing required column "region_name"' }]);
  });

  it('treats an empty sheet as missing every required column', async () => {
    const t = readTab(await sheet([]), REGIONS);
    expect(t.headerOk).toBe(false);
    expect(t.errors.map((e) => e.column)).toEqual(['region_code', 'region_name']);
  });

  it('flags empty required cells and marks the row bad', async () => {
    const t = readTab(await sheet([['region_code', 'region_name'], ['DSM', ''], ['MWZ', 'Mwanza']]), REGIONS);
    expect(t.errors).toEqual([{ row: 2, column: 'region_name', message: 'region_name is required' }]);
    expect([...t.badRows]).toEqual([2]);
    expect(t.rows).toHaveLength(2);
  });

  it('ignores columns that are not in the spec', async () => {
    const t = readTab(await sheet([['region_code', 'region_name', 'username'], ['DSM', 'Dar', 'someone']]), REGIONS);
    expect(t.rows[0].values).toEqual({ region_code: 'DSM', region_name: 'Dar', note: '' });
  });
});

describe('readSetupWorkbook', () => {
  it('finds tabs case-insensitively, ignores Read me and returns null for absent tabs', async () => {
    const parsed = await readSetupWorkbook(await buildWorkbook({
      'Read me': [['anything']],
      regions: [['region_code', 'region_name'], ['DSM', 'Dar es Salaam']],
    }));
    expect(parsed.Regions?.rows).toHaveLength(1);
    expect(parsed.Districts).toBeNull();
    expect(parsed.Users).toBeNull();
  });

  it('does not read the username column of the Users tab', async () => {
    const parsed = await readSetupWorkbook(await buildWorkbook({
      Users: [[...USERS_HEADER, 'username'], ['a@b.test', 'A', 'B', '1', 'NRC', '', '', '', '', '', '', '', 'a.b']],
    }));
    expect(parsed.Users?.rows[0].values).not.toHaveProperty('username');
    expect(parsed.Users?.rows[0].values.email).toBe('a@b.test');
  });
});

describe('splitList', () => {
  it('splits on ";", trims and drops empty entries', () => {
    expect(splitList(' LAB; PHARM ;;MED; ')).toEqual(['LAB', 'PHARM', 'MED']);
    expect(splitList('')).toEqual([]);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @workforce-competency/api test -- workbook-reader`
Expected: FAIL — `Cannot find module '../src/lib/workbook/xlsx'` (helpers import it too).

- [ ] **Step 5: Implement the xlsx primitives**

Create `apps/api/src/lib/workbook/xlsx.ts`:

```ts
// Low-level .xlsx helpers shared by the workbook import/export modules.
// Uploaded workbooks are parsed on the server with ExcelJS; nothing here
// knows about tabs or columns.

import * as ExcelJS from 'exceljs';
import { createError } from '../../middleware/errorHandler';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;

// ExcelJS declares its own Buffer type; accept whatever `load` takes.
type XlsxInput = Parameters<ExcelJS.Workbook['xlsx']['load']>[0];

/** Parse an uploaded workbook. Anything that is not a readable .xlsx is a 400. */
export async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as XlsxInput);
  } catch {
    throw createError('The file is not a valid .xlsx workbook', 400);
  }
  return wb;
}

export async function workbookToBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * A cell's value as trimmed text: rich text is flattened, hyperlinks give
 * their text, formulas their cached result, dates their ISO day; empty → ''.
 */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const obj = value as unknown as Record<string, unknown>;
  if (Array.isArray(obj.richText)) {
    return (obj.richText as { text?: string }[]).map((r) => r.text ?? '').join('').trim();
  }
  if (typeof obj.text === 'string') return obj.text.trim();
  if ('result' in obj) return cellText(obj.result as ExcelJS.CellValue);
  return '';
}
```

- [ ] **Step 6: Implement the tab reader**

Create `apps/api/src/lib/workbook/reader.ts`:

```ts
// Reads worksheets into typed rows. Generic over a tab spec: header names are
// matched case-insensitively, unknown columns are ignored, blank rows skipped,
// and row numbers are spreadsheet row numbers (header = row 1).

import * as ExcelJS from 'exceljs';
import { cellText } from './xlsx';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ColumnSpec { name: string; required: boolean }
export interface TabSpec { name: string; columns: ColumnSpec[] }
export interface RowError { row: number; column: string | null; message: string }
export interface SheetRow { row: number; values: Record<string, string> }
export interface ParsedTab {
  /** false when a required column is missing — no rows are read then. */
  headerOk: boolean;
  rows: SheetRow[];
  errors: RowError[];
  /** Spreadsheet rows that already carry an error (e.g. an empty required cell). */
  badRows: Set<number>;
}

export const req = (name: string): ColumnSpec => ({ name, required: true });
export const opt = (name: string): ColumnSpec => ({ name, required: false });

const norm = (s: string) => s.trim().toLowerCase();

// ── Reading ───────────────────────────────────────────────────────────────────

export function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  return wb.worksheets.find((ws) => norm(ws.name) === norm(name));
}

export function readTab(ws: ExcelJS.Worksheet, spec: TabSpec): ParsedTab {
  const errors: RowError[] = [];
  const badRows = new Set<number>();

  const colIndex = new Map<string, number>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const header = norm(cellText(cell.value));
    if (header && !colIndex.has(header)) colIndex.set(header, col);
  });

  const missing = spec.columns.filter((c) => c.required && !colIndex.has(c.name));
  if (missing.length) {
    for (const c of missing) errors.push({ row: 1, column: c.name, message: `Missing required column "${c.name}"` });
    return { headerOk: false, rows: [], errors, badRows };
  }

  const rows: SheetRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: Record<string, string> = {};
    for (const c of spec.columns) {
      const idx = colIndex.get(c.name);
      values[c.name] = idx === undefined ? '' : cellText(row.getCell(idx).value);
    }
    if (Object.values(values).every((v) => v === '')) return; // blank row
    for (const c of spec.columns) {
      if (c.required && values[c.name] === '') {
        errors.push({ row: rowNumber, column: c.name, message: `${c.name} is required` });
        badRows.add(rowNumber);
      }
    }
    rows.push({ row: rowNumber, values });
  });
  return { headerOk: true, rows, errors, badRows };
}

/** Every spec'd tab, or null when the workbook has no such tab. */
export function readTabs(wb: ExcelJS.Workbook, specs: TabSpec[]): Record<string, ParsedTab | null> {
  const out: Record<string, ParsedTab | null> = {};
  for (const spec of specs) {
    const ws = findSheet(wb, spec.name);
    out[spec.name] = ws ? readTab(ws, spec) : null;
  }
  return out;
}

/** `;`-separated list → trimmed, non-empty entries. */
export function splitList(value: string): string[] {
  return value.split(';').map((v) => v.trim()).filter(Boolean);
}
```

- [ ] **Step 7: Implement the country setup format**

Create `apps/api/src/lib/workbook/setup-format.ts`:

```ts
// The country setup workbook (country-setup.xlsx): tab names, columns and
// allowed values. Spec: docs/superpowers/specs/2026-10-06-workbook-import-design.md §1.

import { loadWorkbook } from './xlsx';
import { ParsedTab, TabSpec, readTabs, req, opt } from './reader';

export const TAB = {
  regions: 'Regions',
  districts: 'Districts',
  departments: 'Departments',
  facilities: 'Facilities',
  orgRoles: 'Org Roles',
  titles: 'Job Titles',
  users: 'Users',
} as const;
export type SetupTabName = typeof TAB[keyof typeof TAB];

export const README_TAB = 'Read me';
export const USERNAME_COLUMN = 'username';

export const ID_TYPES = ['NRC', 'Passport', 'Other'] as const;
export const SYSTEM_ROLES = ['staff', 'admin', 'monitor'] as const;
export const STATUSES = ['active', 'disabled'] as const;

export const USERS_COLUMNS = [
  'email', 'first_name', 'last_name', 'national_id', 'id_type', 'system_role', 'facility_code',
  'department_code', 'org_role_code', 'title_code', 'region_codes', 'status',
];
const USERS_REQUIRED = new Set(['email', 'first_name', 'last_name', 'national_id', 'id_type']);

// `username` is deliberately not listed: it is written on export and ignored on import.
export const SETUP_TABS: TabSpec[] = [
  { name: TAB.regions, columns: [req('region_code'), req('region_name')] },
  { name: TAB.districts, columns: [req('district_code'), req('district_name'), req('region_code')] },
  { name: TAB.departments, columns: [req('department_code'), req('department_name')] },
  {
    name: TAB.facilities,
    columns: [req('facility_code'), req('facility_name'), opt('facility_type'), req('district_code'), opt('department_codes')],
  },
  { name: TAB.orgRoles, columns: [req('role_code'), req('role_name')] },
  { name: TAB.titles, columns: [req('title_code'), req('title_name')] },
  { name: TAB.users, columns: USERS_COLUMNS.map((c) => (USERS_REQUIRED.has(c) ? req(c) : opt(c))) },
];

export type ParsedSetup = Record<SetupTabName, ParsedTab | null>;

export async function readSetupWorkbook(buffer: Buffer): Promise<ParsedSetup> {
  return readTabs(await loadWorkbook(buffer), SETUP_TABS) as ParsedSetup;
}
```

- [ ] **Step 8: Run the tests and typecheck**

Run: `pnpm --filter @workforce-competency/api test -- workbook-reader`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/api test`
Expected: PASS (existing suites unaffected by the helper changes).
Run: `pnpm --filter @workforce-competency/api typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/lib/workbook apps/api/test/helpers.ts apps/api/test/workbook-reader.test.ts
git commit -m "feat(api): workbook reader for xlsx imports"
```

---

### Task 2: Migration 11, setup snapshot and organisation-tab planner

**Files:**
- Modify: `apps/api/src/db/migrations.ts` (append after the `id: 10` entry, before the closing `];`)
- Create: `apps/api/src/lib/workbook/plan.ts`, `apps/api/src/lib/workbook/setup-snapshot.ts`, `apps/api/src/lib/workbook/setup-org.ts`
- Test: `apps/api/test/migration.test.ts` (append), `apps/api/test/setup-plan-org.test.ts` (create)

**Interfaces:**
- Consumes (Task 1): `ParsedTab`, `RowError`, `splitList` from `reader.ts`; `TAB`, `SetupTabName`, `ParsedSetup`, `readSetupWorkbook` from `setup-format.ts`; helpers `buildWorkbook`, `SheetData`, `createUser({ … enabled, orgRoleId })`, `createOrgRole`.
- Produces:
  - `plan.ts`: `type ChangeKind = 'add' | 'update' | 'restore' | 'archive' | 'delete' | 'disable'`, `interface FieldChange { field: string; from: unknown; to: unknown }`, `interface Change { row: number | null; key: string; kind: ChangeKind; fields?: FieldChange[] }`, `interface TabCounts { added; updated; restored; archived; deleted; disabled; unchanged: number }`, `interface TabPlan { tab: string; present: boolean; counts: TabCounts; changes: Change[]; errors: RowError[]; warnings: string[] }`, `interface ImportPlan { fingerprint: string; tabs: TabPlan[]; canApply: boolean; confirmations: { archived: number; deleted: number; disabledUsers: number } }`, `newTab(tab, present): TabPlan`, `diffFields(from: Record<string,string>, to: Record<string,string>, fields: readonly string[]): FieldChange[]`, `fingerprintOf(tabs): string`, `finalisePlan(tabs: TabPlan[]): ImportPlan`. Re-exports `RowError`.
  - `setup-snapshot.ts`: `interface SnapEntity { id: number; code: string; name: string; archived: boolean; hasHistory: boolean }`, `SnapDistrict extends SnapEntity { regionCode: string }`, `SnapFacility extends SnapEntity { facilityType: string; districtCode: string; departmentCodes: string[] }`, `interface SnapUser { id: number; email: string; userName: string; firstName: string; lastName: string; nationalId: string; idType: string; role: string; enabled: boolean; facilityCode: string; departmentCode: string; orgRoleCode: string; titleCode: string; regionCodes: string[] }`, `interface SetupSnapshot { regions: SnapEntity[]; districts: SnapDistrict[]; departments: SnapEntity[]; facilities: SnapFacility[]; orgRoles: SnapEntity[]; titles: SnapEntity[]; users: SnapUser[] }`, `loadSetupSnapshot(): SetupSnapshot` (codes upper-case, code lists sorted).
  - `setup-org.ts`: `type OrgTab` (the six org tab names), `ORG_TABS: OrgTab[]` (Regions, Districts, Departments, Facilities, Org Roles, Job Titles), `type OrgOpKind = 'add' | 'update' | 'restore' | 'archive' | 'delete'`, `interface OrgOp { kind: OrgOpKind; id: number | null; code: string; attrs: Record<string, string> }` — `attrs` keys per tab: Regions `region_name`; Districts `district_name, region_code`; Departments `department_name`; Facilities `facility_name, facility_type, district_code, department_codes` (sorted, `;`-joined); Org Roles `role_name`; Job Titles `title_name`. Also `interface StateEntry { code; active; fromWorkbook; row: number | null; valid; attrs }`, `interface OrgTabResult { plan: TabPlan; ops: OrgOp[]; state: Map<string, StateEntry>; fromWorkbook: boolean }`, `type OrgState = Record<OrgTab, OrgTabResult>`, `interface UserState { email: string; active: boolean; fromWorkbook: boolean; role: string; facility: string; department: string; orgRole: string; title: string; regions: string[] }`, `MAJORITY_WARNING = 'this usually means the wrong file'`, `canonical(field: string, raw: string): string`, `refError(column: string, code: string, target: OrgTab, org: OrgState): string`, `isActive(org: OrgState, tab: OrgTab, code: string): boolean`, `planOrgTabs(parsed: ParsedSetup, snap: SetupSnapshot): OrgState`, `checkOrgRemovals(org: OrgState, users: Map<string, UserState>): void`, `usersFromSnapshot(snap: SetupSnapshot): Map<string, UserState>` (keyed by lower-case email).

- [ ] **Step 1: Write the failing migration test**

Append to `apps/api/test/migration.test.ts`:

```ts
describe('migration 11 — archived_at', () => {
  beforeAll(initTestDb);

  it('adds archived_at to every organisation table', () => {
    for (const table of ['regions', 'districts', 'facilities', 'departments', 'org_roles', 'user_titles']) {
      expect(columns(table)).toContain('archived_at');
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workforce-competency/api test -- migration`
Expected: FAIL — `archived_at` missing from `regions`.

- [ ] **Step 3: Add migration 11**

In `apps/api/src/db/migrations.ts`, after the `id: 10` object:

```ts
  {
    id: 11,
    sql: `
      -- Workbook import: an organisation entity removed from the country setup
      -- workbook is archived (kept for history) instead of deleted when
      -- responses or users still reference it. NULL = active.
      ALTER TABLE regions     ADD COLUMN archived_at TEXT;
      ALTER TABLE districts   ADD COLUMN archived_at TEXT;
      ALTER TABLE facilities  ADD COLUMN archived_at TEXT;
      ALTER TABLE departments ADD COLUMN archived_at TEXT;
      ALTER TABLE org_roles   ADD COLUMN archived_at TEXT;
      ALTER TABLE user_titles ADD COLUMN archived_at TEXT;
    `,
  },
```

Run: `pnpm --filter @workforce-competency/api test -- migration`
Expected: PASS.

- [ ] **Step 4: Write the failing planner tests**

Create `apps/api/test/setup-plan-org.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execute } from '../src/db/database';
import { readSetupWorkbook } from '../src/lib/workbook/setup-format';
import { loadSetupSnapshot } from '../src/lib/workbook/setup-snapshot';
import { planOrgTabs, checkOrgRemovals, usersFromSnapshot, ORG_TABS } from '../src/lib/workbook/setup-org';
import { finalisePlan, ImportPlan, TabPlan } from '../src/lib/workbook/plan';
import {
  initTestDb, resetDb, buildWorkbook, SheetData, createRegion, createDistrict, createFacility, createDepartment,
  createUser, addResponse, assignRegions, createOrgRole,
} from './helpers';

async function planFor(sheets: SheetData): Promise<ImportPlan> {
  const parsed = await readSetupWorkbook(await buildWorkbook(sheets));
  const snap = loadSetupSnapshot();
  const org = planOrgTabs(parsed, snap);
  checkOrgRemovals(org, usersFromSnapshot(snap));
  return finalisePlan(ORG_TABS.map((t) => org[t].plan));
}
const tab = (plan: ImportPlan, name: string): TabPlan => plan.tabs.find((t) => t.tab === name) as TabPlan;

const REGIONS = ['region_code', 'region_name'];
const DISTRICTS = ['district_code', 'district_name', 'region_code'];
const DEPARTMENTS = ['department_code', 'department_name'];
const FACILITIES = ['facility_code', 'facility_name', 'facility_type', 'district_code', 'department_codes'];
const ROLES = ['role_code', 'role_name'];

describe('country setup plan — organisation tabs', () => {
  let dsm: number, mwz: number, tmk: number, f1: number, lab: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    dsm = createRegion('DSM', 'Dar es Salaam');
    mwz = createRegion('MWZ', 'Mwanza');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    createFacility('F2', 'Temeke Clinic', { regionId: dsm, districtId: tmk });
    lab = createDepartment('LAB', 'Laboratory', [f1]);
    // F1, TMK, DSM and LAB have history; the respondent is disabled so they block nothing.
    const respondent = createUser({ facilityId: f1, departmentId: lab, enabled: false });
    addResponse({ userId: respondent, facilityId: f1, regionId: dsm, districtId: tmk, departmentId: lab });
  });

  it('snapshots codes in upper case with history flags, links and user codes', () => {
    const partner = createUser({ role: 'monitor' });
    assignRegions(partner, [mwz]);
    const snap = loadSetupSnapshot();
    expect(snap.facilities.find((f) => f.code === 'F1')).toMatchObject({
      districtCode: 'TMK', departmentCodes: ['LAB'], hasHistory: true, archived: false,
    });
    expect(snap.facilities.find((f) => f.code === 'F2')).toMatchObject({ hasHistory: false, departmentCodes: [] });
    expect(snap.districts[0]).toMatchObject({ code: 'TMK', regionCode: 'DSM', hasHistory: true });
    expect(snap.regions.find((r) => r.code === 'MWZ')).toMatchObject({ hasHistory: false });
    expect(snap.users.find((u) => u.role === 'monitor')).toMatchObject({ regionCodes: ['MWZ'], enabled: true });
    expect(snap.users.find((u) => u.facilityCode === 'F1')).toMatchObject({ departmentCode: 'LAB', enabled: false });
  });

  it('adds, updates and counts unchanged rows; absent tabs change nothing', async () => {
    const plan = await planFor({ Regions: [REGIONS, ['dsm', 'Dar es Salaam City'], ['MWZ', 'Mwanza'], ['ARU', 'Arusha']] });
    const regions = tab(plan, 'Regions');
    expect(regions.counts).toMatchObject({ added: 1, updated: 1, unchanged: 1, archived: 0, deleted: 0 });
    expect(regions.changes).toEqual([
      { row: 2, key: 'DSM', kind: 'update', fields: [{ field: 'region_name', from: 'Dar es Salaam', to: 'Dar es Salaam City' }] },
      { row: 4, key: 'ARU', kind: 'add', fields: [{ field: 'region_name', from: '', to: 'Arusha' }] },
    ]);
    expect(tab(plan, 'Districts')).toMatchObject({ present: false, changes: [], errors: [] });
    expect(plan.canApply).toBe(true);
  });

  it('archives removed rows with history, deletes those without, and warns above 50%', async () => {
    const plan = await planFor({ Facilities: [FACILITIES, ['F3', 'New Clinic', '', 'TMK', '']] });
    const facilities = tab(plan, 'Facilities');
    expect(facilities.changes).toEqual([
      {
        row: 2, key: 'F3', kind: 'add',
        fields: [{ field: 'facility_name', from: '', to: 'New Clinic' }, { field: 'district_code', from: '', to: 'TMK' }],
      },
      { row: null, key: 'F1', kind: 'archive' },
      { row: null, key: 'F2', kind: 'delete' },
    ]);
    expect(facilities.warnings).toEqual([
      '2 of 2 existing facilities would be archived or deleted — this usually means the wrong file.',
    ]);
    expect(plan.confirmations).toEqual({ archived: 1, deleted: 1, disabledUsers: 0 });
    expect(plan.canApply).toBe(true);
  });

  it('does not warn when at most half is removed', async () => {
    const regions = tab(await planFor({ Regions: [REGIONS, ['DSM', 'Dar es Salaam']] }), 'Regions');
    expect(regions.changes).toEqual([{ row: null, key: 'MWZ', kind: 'delete' }]);
    expect(regions.warnings).toEqual([]);
  });

  it('restores an archived entity whose code is back, and leaves archived ones that stay out alone', async () => {
    execute("UPDATE regions SET archived_at = datetime('now') WHERE id = ?", [mwz]);
    const back = await planFor({ Regions: [REGIONS, ['DSM', 'Dar es Salaam'], ['MWZ', 'Mwanza Region']] });
    expect(tab(back, 'Regions').changes).toEqual([
      { row: 3, key: 'MWZ', kind: 'restore', fields: [{ field: 'region_name', from: 'Mwanza', to: 'Mwanza Region' }] },
    ]);
    const out = await planFor({ Regions: [REGIONS, ['DSM', 'Dar es Salaam']] });
    expect(tab(out, 'Regions').changes).toEqual([]);
  });

  it('rejects references to codes that are not active in the workbook or the database', async () => {
    const plan = await planFor({
      Regions: [REGIONS, ['DSM', 'Dar es Salaam']],
      Districts: [DISTRICTS, ['TMK', 'Temeke', 'DSM'], ['NYA', 'Nyamagana', 'mwz']],
      Facilities: [FACILITIES, ['F1', 'Temeke Hospital', '', 'tmk', 'LAB;XRAY'], ['F2', 'Temeke Clinic', '', 'ZZZ', '']],
    });
    expect(tab(plan, 'Districts').errors).toEqual([
      { row: 3, column: 'region_code', message: 'region_code "MWZ" is not an active region in the Regions tab' },
    ]);
    expect(tab(plan, 'Facilities').errors).toEqual([
      {
        row: 2, column: 'department_codes',
        message: 'department_codes "XRAY" is not an active department in the database (no Departments tab in this workbook)',
      },
      { row: 3, column: 'district_code', message: 'district_code "ZZZ" is not an active district in the Districts tab' },
    ]);
    expect(plan.canApply).toBe(false);
  });

  it('blocks removing an entity still used by an unchanged active entity or an active user', async () => {
    const partner = createUser({ role: 'monitor' });
    assignRegions(partner, [mwz]);
    createUser({ facilityId: createFacility('F9', 'Busy Clinic', { regionId: dsm, districtId: tmk }) });
    const plan = await planFor({
      Regions: [REGIONS, ['ARU', 'Arusha']],
      Facilities: [FACILITIES, ['F1', 'Temeke Hospital', '', 'TMK', 'LAB'], ['F2', 'Temeke Clinic', '', 'TMK', '']],
    });
    expect(tab(plan, 'Regions').errors).toEqual([
      {
        row: 0, column: null,
        message: 'Region "DSM" would be archived, but district "TMK" still uses it — keep it in the workbook or remove those too',
      },
      {
        row: 0, column: null,
        message: expect.stringMatching(/^Region "MWZ" would be deleted, but user u\d+@example\.test still uses it/),
      },
    ]);
    expect(tab(plan, 'Facilities').errors).toEqual([
      {
        row: 0, column: null,
        message: expect.stringMatching(/^Facility "F9" would be deleted, but user u\d+@example\.test still uses it/),
      },
    ]);
    expect(plan.canApply).toBe(false);
  });

  it('rejects duplicate codes and department names', async () => {
    const plan = await planFor({
      Departments: [DEPARTMENTS, ['LAB', 'Laboratory'], ['lab', 'Lab again'], ['MIC', 'Laboratory']],
    });
    expect(tab(plan, 'Departments').errors).toEqual([
      { row: 3, column: 'department_code', message: 'Duplicate department_code "LAB" — first used on row 2' },
      { row: 4, column: 'department_name', message: 'department_name "Laboratory" is already used by department "LAB"' },
    ]);
  });

  it('archives an org role used by any user and deletes an unused one', async () => {
    createUser({ orgRoleId: createOrgRole('MLS', 'Scientist'), enabled: false });
    createOrgRole('TECH', 'Technician');
    const plan = await planFor({ 'Org Roles': [ROLES, ['DIR', 'Director']] });
    expect(tab(plan, 'Org Roles').changes).toEqual([
      { row: 2, key: 'DIR', kind: 'add', fields: [{ field: 'role_name', from: '', to: 'Director' }] },
      { row: null, key: 'MLS', kind: 'archive' },
      { row: null, key: 'TECH', kind: 'delete' },
    ]);
  });

  it('reports a tab with a missing required column and plans no changes for it', async () => {
    const plan = await planFor({ Regions: [['region_code'], ['DSM']] });
    expect(tab(plan, 'Regions')).toMatchObject({
      present: true,
      changes: [],
      errors: [{ row: 1, column: 'region_name', message: 'Missing required column "region_name"' }],
    });
  });

  it('fingerprints the change list deterministically', async () => {
    const a = await planFor({ Regions: [REGIONS, ['DSM', 'X'], ['MWZ', 'Mwanza']] });
    const b = await planFor({ Regions: [REGIONS, ['DSM', 'X'], ['MWZ', 'Mwanza']] });
    const c = await planFor({ Regions: [REGIONS, ['DSM', 'Y'], ['MWZ', 'Mwanza']] });
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm --filter @workforce-competency/api test -- setup-plan-org`
Expected: FAIL — `Cannot find module '../src/lib/workbook/setup-snapshot'`.

- [ ] **Step 6: Implement the plan types**

Create `apps/api/src/lib/workbook/plan.ts`:

```ts
// The import plan returned by every workbook preview (country setup and
// catalogue). Spec §3 "Plan shape"; `counts.disabled` is added for Users.

import crypto from 'crypto';
import type { RowError } from './reader';

export type { RowError } from './reader';

export type ChangeKind = 'add' | 'update' | 'restore' | 'archive' | 'delete' | 'disable';

export interface FieldChange { field: string; from: unknown; to: unknown }

export interface Change {
  row: number | null;          // spreadsheet row; null for rows the workbook no longer has
  key: string;
  kind: ChangeKind;
  fields?: FieldChange[];
}

export interface TabCounts {
  added: number; updated: number; restored: number; archived: number;
  deleted: number; disabled: number; unchanged: number;
}

export interface TabPlan {
  tab: string;
  present: boolean;            // false → tab absent, no changes
  counts: TabCounts;
  changes: Change[];
  errors: RowError[];          // row 0 = not tied to one spreadsheet row
  warnings: string[];
}

export interface ImportPlan {
  fingerprint: string;         // sha256 of the canonical change list
  tabs: TabPlan[];
  canApply: boolean;           // false when any error exists
  confirmations: { archived: number; deleted: number; disabledUsers: number };
}

const COUNT_KEY: Record<ChangeKind, keyof TabCounts> = {
  add: 'added', update: 'updated', restore: 'restored', archive: 'archived', delete: 'deleted', disable: 'disabled',
};

export function newTab(tab: string, present: boolean): TabPlan {
  return {
    tab,
    present,
    counts: { added: 0, updated: 0, restored: 0, archived: 0, deleted: 0, disabled: 0, unchanged: 0 },
    changes: [],
    errors: [],
    warnings: [],
  };
}

/** Fields whose values differ ('' stands for empty on both sides). */
export function diffFields(
  from: Record<string, string>,
  to: Record<string, string>,
  fields: readonly string[],
): FieldChange[] {
  return fields
    .filter((f) => (from[f] ?? '') !== (to[f] ?? ''))
    .map((f) => ({ field: f, from: from[f] ?? '', to: to[f] ?? '' }));
}

export function fingerprintOf(tabs: TabPlan[]): string {
  const canonical = tabs.map((t) => ({ tab: t.tab, present: t.present, changes: t.changes }));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Counts from the change lists, errors sorted by row, fingerprint and totals. */
export function finalisePlan(tabs: TabPlan[]): ImportPlan {
  for (const t of tabs) {
    const unchanged = t.counts.unchanged;
    t.counts = { ...newTab(t.tab, t.present).counts, unchanged };
    for (const c of t.changes) t.counts[COUNT_KEY[c.kind]]++;
    t.errors.sort((a, b) => a.row - b.row);
  }
  const all = tabs.flatMap((t) => t.changes);
  return {
    fingerprint: fingerprintOf(tabs),
    tabs,
    canApply: tabs.every((t) => t.errors.length === 0),
    confirmations: {
      archived: all.filter((c) => c.kind === 'archive').length,
      deleted: all.filter((c) => c.kind === 'delete').length,
      disabledUsers: all.filter((c) => c.kind === 'disable').length,
    },
  };
}
```

- [ ] **Step 7: Implement the snapshot**

Create `apps/api/src/lib/workbook/setup-snapshot.ts`:

```ts
// The current organisation + user data, in the workbook's terms (codes rather
// than ids), for planning and exporting the country setup workbook.

import { query } from '../../db/database';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SnapEntity { id: number; code: string; name: string; archived: boolean; hasHistory: boolean }
export interface SnapDistrict extends SnapEntity { regionCode: string }
export interface SnapFacility extends SnapEntity { facilityType: string; districtCode: string; departmentCodes: string[] }
export interface SnapUser {
  id: number; email: string; userName: string; firstName: string; lastName: string;
  nationalId: string; idType: string; role: string; enabled: boolean;
  facilityCode: string; departmentCode: string; orgRoleCode: string; titleCode: string; regionCodes: string[];
}
export interface SetupSnapshot {
  regions: SnapEntity[];
  districts: SnapDistrict[];
  departments: SnapEntity[];
  facilities: SnapFacility[];
  orgRoles: SnapEntity[];
  titles: SnapEntity[];
  users: SnapUser[];
}

const up = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim().toUpperCase());
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

// ── Loading ───────────────────────────────────────────────────────────────────

// History = referenced by a response (regions … departments) or by any user,
// enabled or not (org roles, titles). An entity with history is archived, not
// deleted, when the workbook drops it.
const responseHistory = (col: string) => `EXISTS (SELECT 1 FROM user_assessment_responses x WHERE x.${col} = t.id)`;
const userHistory = (col: string) => `EXISTS (SELECT 1 FROM users x WHERE x.${col} = t.id)`;

function entities(table: string, historySql: string): SnapEntity[] {
  return query<{ id: number; code: string; name: string; archived_at: string | null; has_history: number }>(
    `SELECT t.id, t.code, t.name, t.archived_at, (${historySql}) AS has_history FROM ${table} t ORDER BY t.code`,
  ).map((r) => ({
    id: r.id, code: up(r.code), name: txt(r.name), archived: r.archived_at !== null, hasHistory: Number(r.has_history) > 0,
  }));
}

function groupCodes(rows: { owner: number; code: string }[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const r of rows) out.set(r.owner, [...(out.get(r.owner) ?? []), up(r.code)]);
  for (const [k, v] of out) out.set(k, [...new Set(v)].sort());
  return out;
}

export function loadSetupSnapshot(): SetupSnapshot {
  const regions = entities('regions', responseHistory('region_id'));
  const departments = entities('departments', responseHistory('department_id'));
  const orgRoles = entities('org_roles', userHistory('org_role_id'));
  const titles = entities('user_titles', userHistory('title_id'));

  const districtRegion = new Map(
    query<{ id: number; region_code: string | null }>(
      'SELECT d.id, r.code AS region_code FROM districts d LEFT JOIN regions r ON r.id = d.region_id',
    ).map((r) => [r.id, up(r.region_code)]),
  );
  const districts = entities('districts', responseHistory('district_id'))
    .map((e) => ({ ...e, regionCode: districtRegion.get(e.id) ?? '' }));

  const facilityInfo = new Map(
    query<{ id: number; facility_type: string | null; district_code: string | null }>(
      'SELECT f.id, f.facility_type, d.code AS district_code FROM facilities f LEFT JOIN districts d ON d.id = f.district_id',
    ).map((r) => [r.id, r]),
  );
  const facilityDepts = groupCodes(query<{ owner: number; code: string }>(
    `SELECT fd.facility_id AS owner, dp.code
     FROM facility_departments fd JOIN departments dp ON dp.id = fd.department_id`,
  ));
  const facilities = entities('facilities', responseHistory('facility_id')).map((e) => ({
    ...e,
    facilityType: txt(facilityInfo.get(e.id)?.facility_type),
    districtCode: up(facilityInfo.get(e.id)?.district_code),
    departmentCodes: facilityDepts.get(e.id) ?? [],
  }));

  const userRegions = groupCodes(query<{ owner: number; code: string }>(
    'SELECT ur.user_id AS owner, rg.code FROM user_regions ur JOIN regions rg ON rg.id = ur.region_id',
  ));
  const users = query<{
    id: number; email: string; user_name: string; first_name: string; last_name: string;
    national_id: string; id_type: string; role: string; is_enabled: number;
    facility_code: string | null; department_code: string | null; org_role_code: string | null; title_code: string | null;
  }>(
    `SELECT u.id, u.email, u.user_name, u.first_name, u.last_name, u.national_id, u.id_type, u.role, u.is_enabled,
            f.code AS facility_code, d.code AS department_code, r.code AS org_role_code, t.code AS title_code
     FROM users u
     LEFT JOIN facilities  f ON f.id = u.facility_id
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN org_roles   r ON r.id = u.org_role_id
     LEFT JOIN user_titles t ON t.id = u.title_id
     ORDER BY u.last_name, u.first_name, u.id`,
  ).map((u) => ({
    id: u.id,
    email: txt(u.email),
    userName: txt(u.user_name),
    firstName: txt(u.first_name),
    lastName: txt(u.last_name),
    nationalId: txt(u.national_id),
    idType: txt(u.id_type),
    role: txt(u.role),
    enabled: Boolean(u.is_enabled),
    facilityCode: up(u.facility_code),
    departmentCode: up(u.department_code),
    orgRoleCode: up(u.org_role_code),
    titleCode: up(u.title_code),
    regionCodes: userRegions.get(u.id) ?? [],
  }));

  return { regions, districts, departments, facilities, orgRoles, titles, users };
}
```

- [ ] **Step 8: Implement the organisation planner**

Create `apps/api/src/lib/workbook/setup-org.ts`:

```ts
// Country setup import — organisation tabs (Regions … Job Titles).
//
// Pure planning: compares a parsed workbook with a database snapshot and
// returns, per tab, the changes (for the preview), the operations (for apply)
// and the resulting state (for cross-tab validation). Nothing here writes.
// A present tab is a full sync of its entity type; an absent tab changes
// nothing. Spec: docs/superpowers/specs/2026-10-06-workbook-import-design.md §1.

import { ParsedTab, splitList } from './reader';
import { TabPlan, newTab, diffFields } from './plan';
import { TAB, SetupTabName, ParsedSetup } from './setup-format';
import { SetupSnapshot, SnapEntity } from './setup-snapshot';

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrgTab = Exclude<SetupTabName, typeof TAB.users>;
export const ORG_TABS: OrgTab[] = [TAB.regions, TAB.districts, TAB.departments, TAB.facilities, TAB.orgRoles, TAB.titles];

export type OrgOpKind = 'add' | 'update' | 'restore' | 'archive' | 'delete';

/** One write for apply. `attrs` are canonical workbook values keyed by column. */
export interface OrgOp { kind: OrgOpKind; id: number | null; code: string; attrs: Record<string, string> }

/** An entity as it will be after the import. */
export interface StateEntry {
  code: string;
  active: boolean;
  fromWorkbook: boolean;   // false → an unchanged database row
  row: number | null;
  valid: boolean;          // false → the row has errors (it still claims its code)
  attrs: Record<string, string>;
}

export interface OrgTabResult { plan: TabPlan; ops: OrgOp[]; state: Map<string, StateEntry>; fromWorkbook: boolean }
export type OrgState = Record<OrgTab, OrgTabResult>;

/** A user as they will be after the import (codes upper-case). */
export interface UserState {
  email: string;
  active: boolean;
  fromWorkbook: boolean;
  role: string;
  facility: string;
  department: string;
  orgRole: string;
  title: string;
  regions: string[];
}

interface OrgTabConfig { keyCol: string; fields: string[]; label: string }

const ORG_CONFIG: Record<OrgTab, OrgTabConfig> = {
  [TAB.regions]: { keyCol: 'region_code', fields: ['region_name'], label: 'region' },
  [TAB.districts]: { keyCol: 'district_code', fields: ['district_name', 'region_code'], label: 'district' },
  [TAB.departments]: { keyCol: 'department_code', fields: ['department_name'], label: 'department' },
  [TAB.facilities]: {
    keyCol: 'facility_code', fields: ['facility_name', 'facility_type', 'district_code', 'department_codes'], label: 'facility',
  },
  [TAB.orgRoles]: { keyCol: 'role_code', fields: ['role_name'], label: 'org role' },
  [TAB.titles]: { keyCol: 'title_code', fields: ['title_name'], label: 'job title' },
};

export const MAJORITY_WARNING = 'this usually means the wrong file';

// ── Canonical values ──────────────────────────────────────────────────────────

const CODE_FIELDS = new Set(['region_code', 'district_code', 'facility_code', 'department_code', 'org_role_code', 'title_code']);
const LIST_FIELDS = new Set(['department_codes', 'region_codes']);

/** Codes upper-case; lists de-duplicated, sorted and joined with ';'. */
export function canonical(field: string, raw: string): string {
  if (LIST_FIELDS.has(field)) return [...new Set(splitList(raw).map((c) => c.toUpperCase()))].sort().join(';');
  if (CODE_FIELDS.has(field)) return raw.toUpperCase();
  return raw;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Existing rows ─────────────────────────────────────────────────────────────

interface Existing { id: number; code: string; archived: boolean; hasHistory: boolean; attrs: Record<string, string> }

const base = (e: SnapEntity) => ({ id: e.id, code: e.code, archived: e.archived, hasHistory: e.hasHistory });

function existingFor(tab: OrgTab, snap: SetupSnapshot): Existing[] {
  switch (tab) {
    case TAB.regions:
      return snap.regions.map((e) => ({ ...base(e), attrs: { region_name: e.name } }));
    case TAB.districts:
      return snap.districts.map((e) => ({ ...base(e), attrs: { district_name: e.name, region_code: e.regionCode } }));
    case TAB.departments:
      return snap.departments.map((e) => ({ ...base(e), attrs: { department_name: e.name } }));
    case TAB.facilities:
      return snap.facilities.map((e) => ({
        ...base(e),
        attrs: {
          facility_name: e.name, facility_type: e.facilityType,
          district_code: e.districtCode, department_codes: e.departmentCodes.join(';'),
        },
      }));
    case TAB.orgRoles:
      return snap.orgRoles.map((e) => ({ ...base(e), attrs: { role_name: e.name } }));
    case TAB.titles:
      return snap.titles.map((e) => ({ ...base(e), attrs: { title_name: e.name } }));
  }
}

// ── One tab ───────────────────────────────────────────────────────────────────

function planOrgTab(tab: OrgTab, parsed: ParsedTab | null, existing: Existing[]): OrgTabResult {
  const cfg = ORG_CONFIG[tab];
  const plan = newTab(tab, parsed !== null);
  const ops: OrgOp[] = [];
  const state = new Map<string, StateEntry>();
  const keep = (e: Existing) => state.set(e.code, {
    code: e.code, active: !e.archived, fromWorkbook: false, row: null, valid: true, attrs: e.attrs,
  });

  // Absent tab, or one whose header we cannot read: the database stays as it is.
  if (!parsed || !parsed.headerOk) {
    if (parsed) plan.errors.push(...parsed.errors);
    existing.forEach(keep);
    return { plan, ops, state, fromWorkbook: false };
  }
  plan.errors.push(...parsed.errors);

  const byCode = new Map(existing.map((e) => [e.code, e]));
  const firstRow = new Map<string, number>();
  for (const r of parsed.rows) {
    const code = r.values[cfg.keyCol].toUpperCase();
    if (!code) continue; // the reader already reported the empty key
    const first = firstRow.get(code);
    if (first !== undefined) {
      plan.errors.push({ row: r.row, column: cfg.keyCol, message: `Duplicate ${cfg.keyCol} "${code}" — first used on row ${first}` });
      continue;
    }
    firstRow.set(code, r.row);
    const attrs = Object.fromEntries(cfg.fields.map((f) => [f, canonical(f, r.values[f] ?? '')]));
    const valid = !parsed.badRows.has(r.row);
    state.set(code, { code, active: true, fromWorkbook: true, row: r.row, valid, attrs });
    if (!valid) continue;

    const prev = byCode.get(code);
    if (!prev) {
      ops.push({ kind: 'add', id: null, code, attrs });
      plan.changes.push({ row: r.row, key: code, kind: 'add', fields: diffFields({}, attrs, cfg.fields) });
    } else if (prev.archived) {
      ops.push({ kind: 'restore', id: prev.id, code, attrs });
      plan.changes.push({ row: r.row, key: code, kind: 'restore', fields: diffFields(prev.attrs, attrs, cfg.fields) });
    } else {
      const fields = diffFields(prev.attrs, attrs, cfg.fields);
      if (fields.length) {
        ops.push({ kind: 'update', id: prev.id, code, attrs });
        plan.changes.push({ row: r.row, key: code, kind: 'update', fields });
      } else {
        plan.counts.unchanged++;
      }
    }
  }

  // Everything the workbook no longer lists: archive (has history) or delete.
  const activeBefore = existing.filter((e) => !e.archived).length;
  let removed = 0;
  for (const e of existing) {
    if (firstRow.has(e.code)) continue;
    if (e.archived) { keep(e); continue; }
    removed++;
    const kind: OrgOpKind = e.hasHistory ? 'archive' : 'delete';
    ops.push({ kind, id: e.id, code: e.code, attrs: e.attrs });
    plan.changes.push({ row: null, key: e.code, kind });
    if (kind === 'archive') {
      state.set(e.code, { code: e.code, active: false, fromWorkbook: false, row: null, valid: true, attrs: e.attrs });
    }
  }
  if (activeBefore > 0 && removed / activeBefore > 0.5) {
    plan.warnings.push(`${removed} of ${activeBefore} existing ${tab.toLowerCase()} would be archived or deleted — ${MAJORITY_WARNING}.`);
  }
  return { plan, ops, state, fromWorkbook: true };
}

// ── Cross-tab validation ──────────────────────────────────────────────────────

export function isActive(org: OrgState, tab: OrgTab, code: string): boolean {
  return org[tab].state.get(code)?.active === true;
}

export function refError(column: string, code: string, target: OrgTab, org: OrgState): string {
  const where = org[target].fromWorkbook ? `the ${target} tab` : `the database (no ${target} tab in this workbook)`;
  return `${column} "${code}" is not an active ${ORG_CONFIG[target].label} in ${where}`;
}

function workbookRows(org: OrgState, tab: OrgTab): (StateEntry & { row: number })[] {
  return [...org[tab].state.values()]
    .filter((e): e is StateEntry & { row: number } => e.fromWorkbook && e.valid && e.row !== null);
}

function checkReferences(org: OrgState): void {
  const err = (tab: OrgTab, row: number, column: string, message: string) =>
    org[tab].plan.errors.push({ row, column, message });
  for (const d of workbookRows(org, TAB.districts)) {
    const region = d.attrs.region_code;
    if (!isActive(org, TAB.regions, region)) {
      err(TAB.districts, d.row, 'region_code', refError('region_code', region, TAB.regions, org));
    }
  }
  for (const f of workbookRows(org, TAB.facilities)) {
    const district = f.attrs.district_code;
    if (!isActive(org, TAB.districts, district)) {
      err(TAB.facilities, f.row, 'district_code', refError('district_code', district, TAB.districts, org));
    }
    for (const dep of splitList(f.attrs.department_codes)) {
      if (!isActive(org, TAB.departments, dep)) {
        err(TAB.facilities, f.row, 'department_codes', refError('department_codes', dep, TAB.departments, org));
      }
    }
  }
}

// departments.name is UNIQUE in the database.
function checkDepartmentNames(org: OrgState): void {
  const entries = [...org[TAB.departments].state.values()]
    .sort((a, b) => Number(a.fromWorkbook) - Number(b.fromWorkbook) || (a.row ?? 0) - (b.row ?? 0));
  const owner = new Map<string, string>();
  for (const e of entries) {
    const name = e.attrs.department_name;
    const taken = owner.get(name);
    if (taken === undefined) { owner.set(name, e.code); continue; }
    if (e.fromWorkbook && e.row !== null) {
      org[TAB.departments].plan.errors.push({
        row: e.row, column: 'department_name', message: `department_name "${name}" is already used by department "${taken}"`,
      });
    }
  }
}

export function planOrgTabs(parsed: ParsedSetup, snap: SetupSnapshot): OrgState {
  const org = {} as OrgState;
  for (const tab of ORG_TABS) org[tab] = planOrgTab(tab, parsed[tab], existingFor(tab, snap));
  checkReferences(org);
  checkDepartmentNames(org);
  return org;
}

// ── Removal guards ────────────────────────────────────────────────────────────
// Rows from present tabs that point at a removed entity already fail the
// reference check; here we catch unchanged database rows (absent tabs) and
// active users that would be left pointing at something archived or deleted.

const ORG_REFERRERS: Partial<Record<OrgTab, { from: OrgTab; uses: (e: StateEntry, code: string) => boolean }[]>> = {
  [TAB.regions]: [{ from: TAB.districts, uses: (e, c) => e.attrs.region_code === c }],
  [TAB.districts]: [{ from: TAB.facilities, uses: (e, c) => e.attrs.district_code === c }],
  [TAB.departments]: [{ from: TAB.facilities, uses: (e, c) => splitList(e.attrs.department_codes ?? '').includes(c) }],
};

const USER_USES: Record<OrgTab, (u: UserState, code: string) => boolean> = {
  [TAB.regions]: (u, c) => u.regions.includes(c),
  [TAB.districts]: () => false,
  [TAB.departments]: (u, c) => u.department === c,
  [TAB.facilities]: (u, c) => u.facility === c,
  [TAB.orgRoles]: (u, c) => u.orgRole === c,
  [TAB.titles]: (u, c) => u.title === c,
};

export function checkOrgRemovals(org: OrgState, users: Map<string, UserState>): void {
  for (const tab of ORG_TABS) {
    const { label } = ORG_CONFIG[tab];
    for (const op of org[tab].ops) {
      if (op.kind !== 'archive' && op.kind !== 'delete') continue;
      const blockers: string[] = [];
      for (const ref of ORG_REFERRERS[tab] ?? []) {
        for (const e of org[ref.from].state.values()) {
          if (e.active && !e.fromWorkbook && ref.uses(e, op.code)) blockers.push(`${ORG_CONFIG[ref.from].label} "${e.code}"`);
        }
      }
      for (const u of users.values()) {
        if (u.active && !u.fromWorkbook && USER_USES[tab](u, op.code)) blockers.push(`user ${u.email}`);
      }
      if (!blockers.length) continue;
      const verb = op.kind === 'archive' ? 'archived' : 'deleted';
      org[tab].plan.errors.push({
        row: 0,
        column: null,
        message: `${capitalise(label)} "${op.code}" would be ${verb}, but ${blockers.join(', ')} still `
          + `${blockers.length === 1 ? 'uses' : 'use'} it — keep it in the workbook or remove those too`,
      });
    }
  }
}

/** Users unchanged by the import (Users tab absent). */
export function usersFromSnapshot(snap: SetupSnapshot): Map<string, UserState> {
  return new Map(snap.users.map((u) => [u.email.toLowerCase(), {
    email: u.email,
    active: u.enabled,
    fromWorkbook: false,
    role: u.role,
    facility: u.facilityCode,
    department: u.departmentCode,
    orgRole: u.orgRoleCode,
    title: u.titleCode,
    regions: u.regionCodes,
  }]));
}
```

- [ ] **Step 9: Run the tests and typecheck**

Run: `pnpm --filter @workforce-competency/api test -- setup-plan-org`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/api test`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/api typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/db/migrations.ts apps/api/src/lib/workbook apps/api/test/migration.test.ts apps/api/test/setup-plan-org.test.ts
git commit -m "feat(api): archived_at and country setup planner for organisation tabs"
```

---

### Task 3: Users-tab planner and the full setup plan

**Files:**
- Create: `apps/api/src/lib/workbook/setup-users.ts`, `apps/api/src/lib/workbook/setup-planner.ts`
- Test: `apps/api/test/setup-plan-users.test.ts` (create)

**Interfaces:**
- Consumes (Task 2): `OrgState`, `OrgTab`, `OrgOp`, `UserState`, `ORG_TABS`, `MAJORITY_WARNING`, `canonical`, `refError`, `isActive`, `planOrgTabs`, `checkOrgRemovals`, `usersFromSnapshot` from `setup-org.ts`; `SetupSnapshot`, `SnapUser`, `loadSetupSnapshot`; `newTab`, `diffFields`, `finalisePlan`, `ImportPlan`, `TabPlan`; (Task 1) `ParsedTab`, `splitList`, `TAB`, `ID_TYPES`, `SYSTEM_ROLES`, `STATUSES`, `ParsedSetup`; helpers `USERS_HEADER`, `userSheetRow`.
- Produces:
  - `setup-users.ts`: `USER_FIELDS` (`first_name, last_name, national_id, id_type, system_role, facility_code, department_code, org_role_code, title_code, region_codes, status`), `type UserValues = Record<UserField, string> & { email: string }` (canonical: codes upper-case, `region_codes` sorted `;`-joined, `system_role`/`status` lower-case with defaults, `id_type` canonical spelling), `interface UserOp { kind: 'add' | 'update' | 'disable'; id: number | null; values: UserValues }`, `interface UsersResult { plan: TabPlan; ops: UserOp[]; state: Map<string, UserState> }`, `planUsersTab(parsed: ParsedTab | null, snap: SetupSnapshot, org: OrgState, actorUserId: number): UsersResult`.
  - `setup-planner.ts`: `interface SetupOps { org: Record<OrgTab, OrgOp[]>; users: UserOp[] }`, `interface SetupPlanResult { plan: ImportPlan; ops: SetupOps }`, `planSetupImport(parsed: ParsedSetup, snap: SetupSnapshot, actorUserId: number): SetupPlanResult` — tab order in `plan.tabs`: Regions, Districts, Departments, Facilities, Org Roles, Job Titles, Users.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/setup-plan-users.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execute } from '../src/db/database';
import { readSetupWorkbook } from '../src/lib/workbook/setup-format';
import { loadSetupSnapshot } from '../src/lib/workbook/setup-snapshot';
import { planSetupImport } from '../src/lib/workbook/setup-planner';
import { ImportPlan, TabPlan } from '../src/lib/workbook/plan';
import {
  initTestDb, resetDb, buildWorkbook, SheetData, createRegion, createDistrict, createFacility, createDepartment,
  createUser, USERS_HEADER, userSheetRow,
} from './helpers';

async function planFor(sheets: SheetData, actor: number): Promise<ImportPlan> {
  const parsed = await readSetupWorkbook(await buildWorkbook(sheets));
  return planSetupImport(parsed, loadSetupSnapshot(), actor).plan;
}
const tab = (plan: ImportPlan, name: string): TabPlan => plan.tabs.find((t) => t.tab === name) as TabPlan;

const FACILITIES = ['facility_code', 'facility_name', 'facility_type', 'district_code', 'department_codes'];

describe('country setup plan — users', () => {
  let admin: number, staff: number, dsm: number, tmk: number, f1: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin', email: 'boss@example.test' });
    dsm = createRegion('DSM', 'Dar es Salaam');
    tmk = createDistrict('TMK', 'Temeke', dsm);
    f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    const lab = createDepartment('LAB', 'Laboratory', [f1]);
    createDepartment('MIC', 'Microbiology'); // not offered at F1
    staff = createUser({
      email: 'Amina@Example.test', firstName: 'Amina', lastName: 'Hassan', nationalId: '123', idType: 'NRC',
      facilityId: f1, departmentId: lab,
    });
  });

  // Header, the importing admin unchanged, then the given rows (from row 3).
  const users = (...rows: string[][]): SheetData => ({ Users: [USERS_HEADER, userSheetRow(admin), ...rows] });

  it('adds new users, matches existing ones by email case-insensitively and ignores username', async () => {
    const plan = await planFor({
      Users: [
        [...USERS_HEADER, 'username'],
        [...userSheetRow(admin), 'whatever'],
        ['amina@example.test', 'Amina', 'Hassan-Juma', '123', 'nrc', '', 'f1', 'lab', '', '', '', '', 'hacker'],
        ['new@example.test', 'New', 'Person', '999', 'Passport', 'staff', 'F1', 'LAB', '', '', '', 'active', ''],
      ],
    }, admin);
    const u = tab(plan, 'Users');
    expect(u.errors).toEqual([]);
    expect(u.counts).toMatchObject({ added: 1, updated: 1, unchanged: 1, disabled: 0 });
    expect(u.changes).toEqual([
      { row: 3, key: 'Amina@Example.test', kind: 'update', fields: [{ field: 'last_name', from: 'Hassan', to: 'Hassan-Juma' }] },
      {
        row: 4, key: 'new@example.test', kind: 'add',
        fields: [
          { field: 'first_name', from: '', to: 'New' },
          { field: 'last_name', from: '', to: 'Person' },
          { field: 'national_id', from: '', to: '999' },
          { field: 'id_type', from: '', to: 'Passport' },
          { field: 'system_role', from: '', to: 'staff' },
          { field: 'facility_code', from: '', to: 'F1' },
          { field: 'department_code', from: '', to: 'LAB' },
          { field: 'status', from: '', to: 'active' },
        ],
      },
    ]);
    expect(plan.canApply).toBe(true);
  });

  it('disables enabled users missing from the tab, with a warning, and leaves disabled ones alone', async () => {
    createUser({ email: 'gone@example.test' });
    createUser({ email: 'old@example.test', enabled: false });
    const plan = await planFor(users(userSheetRow(staff)), admin);
    const u = tab(plan, 'Users');
    expect(u.changes).toEqual([{ row: null, key: 'gone@example.test', kind: 'disable' }]);
    expect(u.warnings).toEqual(['1 user is not in the Users tab and will be disabled.']);
    expect(plan.confirmations.disabledUsers).toBe(1);
    expect(plan.canApply).toBe(true);
  });

  it('re-enables a disabled user whose row has no status', async () => {
    const off = createUser({ email: 'off@example.test', enabled: false });
    const row = userSheetRow(off);
    row[11] = '';
    const u = tab(await planFor(users(userSheetRow(staff), row), admin), 'Users');
    expect(u.changes).toEqual([
      { row: 4, key: 'off@example.test', kind: 'update', fields: [{ field: 'status', from: 'disabled', to: 'active' }] },
    ]);
  });

  it('warns when more than half of the active users would be disabled', async () => {
    createUser(); createUser(); createUser();
    const u = tab(await planFor(users(), admin), 'Users');
    expect(u.warnings).toContain('4 of 5 active users would be disabled — this usually means the wrong file.');
  });

  it('rejects values outside the allowed sets but accepts an unchanged legacy id_type', async () => {
    // The admin row keeps its legacy id_type "NIN" and is accepted.
    const u = tab(await planFor(users(['a@x.test', 'A', 'A', '1', 'Licence', 'boss', '', '', '', '', '', 'gone']), admin), 'Users');
    expect(u.errors).toEqual([
      { row: 3, column: 'id_type', message: 'id_type must be one of NRC, Passport, Other' },
      { row: 3, column: 'system_role', message: 'system_role must be one of staff, admin, monitor' },
      { row: 3, column: 'status', message: 'status must be one of active, disabled' },
    ]);
  });

  it('enforces partner (monitor) placement rules', async () => {
    const u = tab(await planFor(users(
      ['m1@x.test', 'M', 'One', 'm1', 'NRC', 'monitor', '', '', '', '', '', ''],
      ['m2@x.test', 'M', 'Two', 'm2', 'NRC', 'monitor', 'F1', '', '', '', 'DSM', ''],
      ['s1@x.test', 'S', 'One', 's1', 'NRC', 'staff', '', '', '', '', 'DSM', ''],
      ['m3@x.test', 'M', 'Three', 'm3', 'NRC', 'monitor', '', '', '', '', 'dsm;ZZZ', ''],
    ), admin), 'Users');
    expect(u.errors).toEqual([
      { row: 3, column: 'region_codes', message: 'A partner (monitor) user needs at least one region in region_codes' },
      { row: 4, column: null, message: 'Partner (monitor) users cannot have a facility, department, org role or title' },
      { row: 5, column: 'region_codes', message: 'Only partner (monitor) users can have region_codes' },
      {
        row: 6, column: 'region_codes',
        message: 'region_codes "ZZZ" is not an active region in the database (no Regions tab in this workbook)',
      },
    ]);
  });

  it('checks references and that the department belongs to the facility', async () => {
    createFacility('F9', 'Old Clinic', { regionId: dsm, districtId: tmk });
    execute("UPDATE facilities SET archived_at = datetime('now') WHERE code = 'F9'");
    const u = tab(await planFor(users(
      ['a@x.test', 'A', 'A', 'a1', 'NRC', 'staff', 'F1', 'MIC', '', '', '', ''],
      ['b@x.test', 'B', 'B', 'b1', 'NRC', 'staff', '', 'LAB', '', '', '', ''],
      ['c@x.test', 'C', 'C', 'c1', 'NRC', 'staff', 'F9', '', '', '', '', ''],
      ['d@x.test', 'D', 'D', 'd1', 'NRC', 'staff', 'F9', '', '', '', '', 'disabled'],
      ['e@x.test', 'E', 'E', 'e1', 'NRC', 'staff', 'F1', '', 'NOPE', '', '', ''],
    ), admin), 'Users');
    expect(u.errors).toEqual([
      { row: 3, column: 'department_code', message: 'Department "MIC" is not one of facility "F1"\'s departments' },
      { row: 4, column: 'department_code', message: 'department_code needs a facility_code' },
      {
        row: 5, column: 'facility_code',
        message: 'facility_code "F9" is not an active facility in the database (no Facilities tab in this workbook)',
      },
      {
        row: 7, column: 'org_role_code',
        message: 'org_role_code "NOPE" is not an active org role in the database (no Org Roles tab in this workbook)',
      },
    ]);
  });

  it('keeps national_id + id_type unique, including against users outside the workbook', async () => {
    createUser({ email: 'keep@example.test', nationalId: '555', idType: 'NRC', enabled: false });
    const u = tab(await planFor(users(
      ['a@x.test', 'A', 'A', '777', 'NRC', '', '', '', '', '', '', ''],
      ['b@x.test', 'B', 'B', '777', 'nrc', '', '', '', '', '', '', ''],
      ['c@x.test', 'C', 'C', '555', 'NRC', '', '', '', '', '', '', ''],
      ['d@x.test', 'D', 'D', '777', 'Passport', '', '', '', '', '', '', ''],
    ), admin), 'Users');
    expect(u.errors).toEqual([
      { row: 4, column: 'national_id', message: 'national_id "777" with id_type "NRC" is already used by row 3 (a@x.test)' },
      { row: 5, column: 'national_id', message: 'national_id "555" with id_type "NRC" is already used by existing user keep@example.test' },
    ]);
  });

  it('rejects duplicate emails', async () => {
    const u = tab(await planFor(users(
      ['a@x.test', 'A', 'A', 'a1', 'NRC', '', '', '', '', '', '', ''],
      ['A@X.test', 'A', 'B', 'a2', 'NRC', '', '', '', '', '', '', ''],
    ), admin), 'Users');
    expect(u.errors).toEqual([{ row: 4, column: 'email', message: 'Duplicate email "A@X.test" — first used on row 3' }]);
  });

  it('will not disable, drop or demote the importing admin', async () => {
    const missing = tab(await planFor({ Users: [USERS_HEADER, userSheetRow(staff)] }, admin), 'Users');
    expect(missing.errors).toContainEqual({
      row: 0, column: 'email',
      message: 'Your own account (boss@example.test) is not in the Users tab — the import would disable you',
    });

    const demotedRow = userSheetRow(admin);
    demotedRow[5] = 'staff';
    const demoted = tab(await planFor({ Users: [USERS_HEADER, demotedRow] }, admin), 'Users');
    expect(demoted.errors).toContainEqual({ row: 2, column: 'system_role', message: 'You cannot remove your own admin role' });

    const disabledRow = userSheetRow(admin);
    disabledRow[11] = 'disabled';
    const disabled = tab(await planFor({ Users: [USERS_HEADER, disabledRow] }, admin), 'Users');
    expect(disabled.errors).toContainEqual({ row: 2, column: 'status', message: 'You cannot disable your own account' });
  });

  it('must leave at least one active admin', async () => {
    const u = tab(await planFor({ Users: [USERS_HEADER, userSheetRow(staff)] }, 999999), 'Users');
    expect(u.errors).toContainEqual({ row: 0, column: 'system_role', message: 'The import must leave at least one active admin' });
  });

  it('lets the Users tab decide whether a removed facility is still in use', async () => {
    const sheets = { Facilities: [FACILITIES, ['F2', 'New Clinic', '', 'TMK', '']] };
    // Without a Users tab, Amina (active, at F1) blocks removing F1.
    const blocked = await planFor(sheets, admin);
    expect(tab(blocked, 'Facilities').errors).toEqual([{
      row: 0, column: null,
      message: 'Facility "F1" would be deleted, but user Amina@Example.test still uses it — keep it in the workbook or remove those too',
    }]);
    // With a Users tab that leaves Amina out she is disabled, so F1 can go.
    const allowed = await planFor({ ...sheets, ...users() }, admin);
    expect(allowed.canApply).toBe(true);
    expect(tab(allowed, 'Users').changes).toEqual([{ row: null, key: 'Amina@Example.test', kind: 'disable' }]);
  });

  it('returns the operations apply needs', async () => {
    const parsed = await readSetupWorkbook(await buildWorkbook(users(
      ['new@example.test', 'New', 'Person', '999', 'Passport', '', '', '', '', '', '', ''],
    )));
    const { ops } = planSetupImport(parsed, loadSetupSnapshot(), admin);
    expect(ops.users).toEqual([
      {
        kind: 'add', id: null,
        values: {
          email: 'new@example.test', first_name: 'New', last_name: 'Person', national_id: '999', id_type: 'Passport',
          system_role: 'staff', status: 'active', facility_code: '', department_code: '', org_role_code: '', title_code: '',
          region_codes: '',
        },
      },
      expect.objectContaining({ kind: 'disable', id: staff }),
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workforce-competency/api test -- setup-plan-users`
Expected: FAIL — `Cannot find module '../src/lib/workbook/setup-planner'`.

- [ ] **Step 3: Implement the Users planner**

Create `apps/api/src/lib/workbook/setup-users.ts`:

```ts
// Country setup import — the Users tab. Users are matched by email
// (case-insensitive), keep their username and password, and are never
// deleted: users missing from a present Users tab are disabled.

import { ParsedTab, splitList } from './reader';
import { TabPlan, newTab, diffFields } from './plan';
import { TAB, ID_TYPES, SYSTEM_ROLES, STATUSES } from './setup-format';
import { SetupSnapshot, SnapUser } from './setup-snapshot';
import {
  OrgState, OrgTab, UserState, MAJORITY_WARNING, canonical, refError, isActive, usersFromSnapshot,
} from './setup-org';

// ── Types ─────────────────────────────────────────────────────────────────────

export const USER_FIELDS = [
  'first_name', 'last_name', 'national_id', 'id_type', 'system_role', 'facility_code',
  'department_code', 'org_role_code', 'title_code', 'region_codes', 'status',
] as const;
export type UserField = typeof USER_FIELDS[number];
export type UserValues = Record<UserField, string> & { email: string };

export interface UserOp { kind: 'add' | 'update' | 'disable'; id: number | null; values: UserValues }
export interface UsersResult { plan: TabPlan; ops: UserOp[]; state: Map<string, UserState> }

interface Problem { column: string | null; message: string }
interface WorkbookUser { row: number; key: string; values: UserValues; prev: SnapUser | undefined; valid: boolean }

// ── Values ────────────────────────────────────────────────────────────────────

function snapValues(u: SnapUser): UserValues {
  return {
    email: u.email,
    first_name: u.firstName,
    last_name: u.lastName,
    national_id: u.nationalId,
    id_type: u.idType,
    system_role: u.role,
    facility_code: u.facilityCode,
    department_code: u.departmentCode,
    org_role_code: u.orgRoleCode,
    title_code: u.titleCode,
    region_codes: u.regionCodes.join(';'),
    status: u.enabled ? 'active' : 'disabled',
  };
}

function toState(v: UserValues, fromWorkbook: boolean): UserState {
  return {
    email: v.email,
    active: v.status === 'active',
    fromWorkbook,
    role: v.system_role,
    facility: v.facility_code,
    department: v.department_code,
    orgRole: v.org_role_code,
    title: v.title_code,
    regions: splitList(v.region_codes),
  };
}

/** Canonical values plus problems with allowed-value columns. */
function normalise(raw: Record<string, string>, prev: SnapUser | undefined): { values: UserValues; problems: Problem[] } {
  const problems: Problem[] = [];
  // An existing user's legacy id_type (e.g. the seed admin's) is fine while it is unchanged.
  const idType = ID_TYPES.find((t) => t.toLowerCase() === raw.id_type.toLowerCase())
    ?? (prev && prev.idType === raw.id_type ? raw.id_type : null);
  if (raw.id_type && idType === null) {
    problems.push({ column: 'id_type', message: `id_type must be one of ${ID_TYPES.join(', ')}` });
  }
  const role = (raw.system_role || 'staff').toLowerCase();
  if (!(SYSTEM_ROLES as readonly string[]).includes(role)) {
    problems.push({ column: 'system_role', message: `system_role must be one of ${SYSTEM_ROLES.join(', ')}` });
  }
  const status = (raw.status || 'active').toLowerCase();
  if (!(STATUSES as readonly string[]).includes(status)) {
    problems.push({ column: 'status', message: `status must be one of ${STATUSES.join(', ')}` });
  }
  return {
    problems,
    values: {
      email: raw.email,
      first_name: raw.first_name,
      last_name: raw.last_name,
      national_id: raw.national_id,
      id_type: idType ?? raw.id_type,
      system_role: role,
      status,
      facility_code: canonical('facility_code', raw.facility_code),
      department_code: canonical('department_code', raw.department_code),
      org_role_code: canonical('org_role_code', raw.org_role_code),
      title_code: canonical('title_code', raw.title_code),
      region_codes: canonical('region_codes', raw.region_codes),
    },
  };
}

/** Placement rules and references for one (already normalised) row. */
function checkUser(v: UserValues, org: OrgState): Problem[] {
  const out: Problem[] = [];
  const disabled = v.status === 'disabled';
  const ref = (column: string, code: string, tab: OrgTab) => {
    if (!code) return;
    // Disabled users may keep pointing at archived entities (their history).
    const ok = isActive(org, tab, code) || (disabled && org[tab].state.has(code));
    if (!ok) out.push({ column, message: refError(column, code, tab, org) });
  };

  if (v.system_role === 'monitor') {
    if (!v.region_codes) {
      out.push({ column: 'region_codes', message: 'A partner (monitor) user needs at least one region in region_codes' });
    }
    if (v.facility_code || v.department_code || v.org_role_code || v.title_code) {
      out.push({ column: null, message: 'Partner (monitor) users cannot have a facility, department, org role or title' });
    }
  } else if (v.region_codes) {
    out.push({ column: 'region_codes', message: 'Only partner (monitor) users can have region_codes' });
  }

  ref('facility_code', v.facility_code, TAB.facilities);
  ref('department_code', v.department_code, TAB.departments);
  ref('org_role_code', v.org_role_code, TAB.orgRoles);
  ref('title_code', v.title_code, TAB.titles);
  for (const code of splitList(v.region_codes)) ref('region_codes', code, TAB.regions);

  if (v.department_code && !disabled) {
    if (!v.facility_code) {
      out.push({ column: 'department_code', message: 'department_code needs a facility_code' });
    } else {
      const facility = org[TAB.facilities].state.get(v.facility_code);
      if (facility && !splitList(facility.attrs.department_codes ?? '').includes(v.department_code)) {
        out.push({
          column: 'department_code',
          message: `Department "${v.department_code}" is not one of facility "${v.facility_code}"'s departments`,
        });
      }
    }
  }
  return out;
}

// ── Planning ──────────────────────────────────────────────────────────────────

export function planUsersTab(
  parsed: ParsedTab | null, snap: SetupSnapshot, org: OrgState, actorUserId: number,
): UsersResult {
  const plan = newTab(TAB.users, parsed !== null);
  const ops: UserOp[] = [];
  if (!parsed || !parsed.headerOk) {
    if (parsed) plan.errors.push(...parsed.errors);
    return { plan, ops, state: usersFromSnapshot(snap) };
  }
  plan.errors.push(...parsed.errors);
  const err = (row: number, column: string | null, message: string) => plan.errors.push({ row, column, message });

  const existing = new Map(snap.users.map((u) => [u.email.toLowerCase(), u]));
  const firstRow = new Map<string, number>();
  const rows: WorkbookUser[] = [];
  const state = new Map<string, UserState>();

  // 1. Each row on its own.
  for (const r of parsed.rows) {
    const key = r.values.email.toLowerCase();
    if (!key) continue; // the reader already reported the empty email
    const first = firstRow.get(key);
    if (first !== undefined) {
      err(r.row, 'email', `Duplicate email "${r.values.email}" — first used on row ${first}`);
      continue;
    }
    firstRow.set(key, r.row);
    const prev = existing.get(key);
    const { values, problems } = normalise(r.values, prev);
    const readerBad = parsed.badRows.has(r.row);
    if (!problems.length && !readerBad) problems.push(...checkUser(values, org));
    for (const p of problems) err(r.row, p.column, p.message);
    rows.push({ row: r.row, key, values, prev, valid: problems.length === 0 && !readerBad });
    state.set(key, toState(values, true));
  }

  // 2. national_id + id_type is unique across every user that will exist.
  const pair = (id: string, type: string) => `${id}\u0000${type}`;
  const holder = new Map<string, string>();
  for (const u of snap.users) {
    if (!firstRow.has(u.email.toLowerCase())) holder.set(pair(u.nationalId, u.idType), `existing user ${u.email}`);
  }
  for (const r of rows) {
    if (!r.valid) continue;
    const p = pair(r.values.national_id, r.values.id_type);
    const other = holder.get(p);
    if (other !== undefined) {
      err(r.row, 'national_id',
        `national_id "${r.values.national_id}" with id_type "${r.values.id_type}" is already used by ${other}`);
      r.valid = false;
    } else {
      holder.set(p, `row ${r.row} (${r.values.email})`);
    }
  }

  // 3. Changes for valid rows.
  for (const r of rows) {
    if (!r.valid) continue;
    if (!r.prev) {
      ops.push({ kind: 'add', id: null, values: r.values });
      plan.changes.push({ row: r.row, key: r.values.email, kind: 'add', fields: diffFields({}, r.values, USER_FIELDS) });
      continue;
    }
    const fields = diffFields(snapValues(r.prev), r.values, USER_FIELDS);
    if (fields.length) {
      ops.push({ kind: 'update', id: r.prev.id, values: { ...r.values, email: r.prev.email } });
      plan.changes.push({ row: r.row, key: r.prev.email, kind: 'update', fields });
    } else {
      plan.counts.unchanged++;
    }
  }

  // 4. Users missing from the tab are disabled, never deleted.
  const enabledBefore = snap.users.filter((u) => u.enabled).length;
  let disabled = 0;
  for (const u of snap.users) {
    const key = u.email.toLowerCase();
    if (firstRow.has(key)) continue;
    const values: UserValues = { ...snapValues(u), status: 'disabled' };
    if (u.enabled) {
      disabled++;
      ops.push({ kind: 'disable', id: u.id, values });
      plan.changes.push({ row: null, key: u.email, kind: 'disable' });
    }
    state.set(key, toState(values, false));
  }
  if (disabled > 0) {
    plan.warnings.push(`${disabled} ${disabled === 1 ? 'user is' : 'users are'} not in the Users tab and will be disabled.`);
  }
  if (enabledBefore > 0 && disabled / enabledBefore > 0.5) {
    plan.warnings.push(`${disabled} of ${enabledBefore} active users would be disabled — ${MAJORITY_WARNING}.`);
  }

  // 5. Lock-out guards.
  const actor = snap.users.find((u) => u.id === actorUserId);
  if (actor) {
    const mine = rows.find((r) => r.key === actor.email.toLowerCase());
    if (!mine) err(0, 'email', `Your own account (${actor.email}) is not in the Users tab — the import would disable you`);
    else if (mine.values.status !== 'active') err(mine.row, 'status', 'You cannot disable your own account');
    else if (mine.values.system_role !== 'admin') err(mine.row, 'system_role', 'You cannot remove your own admin role');
  }
  if (!rows.some((r) => r.values.system_role === 'admin' && r.values.status === 'active')) {
    err(0, 'system_role', 'The import must leave at least one active admin');
  }

  return { plan, ops, state };
}
```

- [ ] **Step 4: Implement the combined planner**

Create `apps/api/src/lib/workbook/setup-planner.ts`:

```ts
// Country setup import plan: organisation tabs, then Users, then the removal
// guards that need both. Pure — the routes call this for preview and again
// for apply (whose fingerprint must match the preview's).

import { ImportPlan, finalisePlan } from './plan';
import { TAB, ParsedSetup } from './setup-format';
import { SetupSnapshot } from './setup-snapshot';
import { ORG_TABS, OrgOp, OrgTab, planOrgTabs, checkOrgRemovals } from './setup-org';
import { UserOp, planUsersTab } from './setup-users';

export interface SetupOps { org: Record<OrgTab, OrgOp[]>; users: UserOp[] }
export interface SetupPlanResult { plan: ImportPlan; ops: SetupOps }

export function planSetupImport(parsed: ParsedSetup, snap: SetupSnapshot, actorUserId: number): SetupPlanResult {
  const org = planOrgTabs(parsed, snap);
  const users = planUsersTab(parsed[TAB.users], snap, org, actorUserId);
  checkOrgRemovals(org, users.state);

  const tabs = [...ORG_TABS.map((t) => org[t].plan), users.plan];
  const orgOps = Object.fromEntries(ORG_TABS.map((t) => [t, org[t].ops])) as Record<OrgTab, OrgOp[]>;
  return { plan: finalisePlan(tabs), ops: { org: orgOps, users: users.ops } };
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @workforce-competency/api test -- setup-plan`
Expected: PASS (both `setup-plan-org` and `setup-plan-users`).
Run: `pnpm --filter @workforce-competency/api typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/workbook/setup-users.ts apps/api/src/lib/workbook/setup-planner.ts apps/api/test/setup-plan-users.test.ts
git commit -m "feat(api): plan the Users tab with lock-out guards"
```

---

### Task 4: Country setup endpoints — preview, apply, export

**Files:**
- Create: `apps/api/src/lib/credentials.ts`, `apps/api/src/lib/workbook/http.ts`, `apps/api/src/lib/workbook/setup-apply.ts`, `apps/api/src/lib/workbook/writer.ts`, `apps/api/src/lib/workbook/setup-export.ts`, `apps/api/src/routes/admin-setup.ts`
- Modify: `apps/api/src/routes/admin.ts` (imports lines 1–10; delete `generateTempPassword` / `generateUsername` at lines ~41–52; mount block at lines ~700–706)
- Test: `apps/api/test/setup-import.test.ts`, `apps/api/test/setup-export.test.ts` (create)

**Interfaces:**
- Consumes (Tasks 1–3): `XLSX_MIME`, `MAX_WORKBOOK_BYTES`, `loadWorkbook`, `workbookToBuffer`; `TabSpec`, `splitList`; `TAB`, `SETUP_TABS`, `README_TAB`, `USERNAME_COLUMN`, `ID_TYPES`, `SYSTEM_ROLES`, `STATUSES`, `readSetupWorkbook`; `loadSetupSnapshot`, `SetupSnapshot`; `planSetupImport`, `SetupOps`; `OrgOp`, `OrgTab`; `UserOp`; `syncFacilitiesRegion`, `backfillResponseDistrict` from `lib/org.ts`; helpers `buildWorkbook`, `binaryParser`, `USERS_HEADER`, `userSheetRow`.
- Produces:
  - `credentials.ts`: `generateTempPassword(): string`, `generateUsername(firstName: string, lastName: string, reserved?: Set<string>): string`.
  - `http.ts`: `xlsxBody` (express middleware), `workbookBody(req: Request): Buffer` (415 when missing), `sendWorkbook(res: Response, buffer: Buffer, filename: string): void`.
  - `setup-apply.ts`: `interface Credential { name: string; email: string; username: string; temp_password: string }`, `applySetupOps(ops: SetupOps): Promise<Credential[]>` (one transaction).
  - `writer.ts`: `interface WriteTabOptions { readOnly?: string[]; lists?: Record<string, readonly string[]> }`, `writeTab(wb, spec: TabSpec, rows: string[][], opts?): ExcelJS.Worksheet`, `writeReadme(wb, title: string, lines: [string, string][]): void`, `appVersion(): string`.
  - `setup-export.ts`: `writeSetupWorkbook(snap: SetupSnapshot): Promise<Buffer>`.
  - HTTP: `GET /admin/setup/export` (xlsx, `country-setup.xlsx`), `POST /admin/setup/import/preview` → `{ plan: ImportPlan }`, `POST /admin/setup/import/apply?fingerprint=` → `{ plan: ImportPlan; credentials: Credential[] }`.

- [ ] **Step 1: Write the failing import tests**

Create `apps/api/test/setup-import.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { query, execute } from '../src/db/database';
import { XLSX_MIME, MAX_WORKBOOK_BYTES } from '../src/lib/workbook/xlsx';
import { applySetupOps } from '../src/lib/workbook/setup-apply';
import {
  initTestDb, resetDb, testApp, asUser, createUser, createRegion, createDistrict, createFacility, createDepartment,
  addResponse, buildWorkbook, USERS_HEADER, userSheetRow,
} from './helpers';

const app = testApp();

const REGIONS = ['region_code', 'region_name'];
const DISTRICTS = ['district_code', 'district_name', 'region_code'];
const FACILITIES = ['facility_code', 'facility_name', 'facility_type', 'district_code', 'department_codes'];

describe('country setup import endpoints', () => {
  let admin: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin', email: 'boss@example.test' });
  });

  const preview = (buf: Buffer, user = admin) =>
    request(app).post('/admin/setup/import/preview').set(asUser(user)).set('Content-Type', XLSX_MIME).send(buf);
  const apply = (buf: Buffer, fingerprint: string, user = admin) =>
    request(app).post(`/admin/setup/import/apply?fingerprint=${fingerprint}`).set(asUser(user))
      .set('Content-Type', XLSX_MIME).send(buf);

  const country = () => buildWorkbook({
    Regions: [REGIONS, ['DSM', 'Dar es Salaam'], ['MWZ', 'Mwanza']],
    Districts: [DISTRICTS, ['TMK', 'Temeke', 'DSM'], ['NYA', 'Nyamagana', 'MWZ']],
    Departments: [['department_code', 'department_name'], ['LAB', 'Laboratory'], ['MIC', 'Microbiology']],
    Facilities: [FACILITIES, ['F1', 'Temeke Hospital', 'Hospital', 'TMK', 'LAB; MIC'], ['F2', 'Mwanza Clinic', '', 'NYA', 'LAB']],
    'Org Roles': [['role_code', 'role_name'], ['MLS', 'Medical Laboratory Scientist']],
    'Job Titles': [['title_code', 'title_name'], ['DR', 'Dr.']],
    Users: [
      USERS_HEADER,
      userSheetRow(admin),
      ['amina@example.test', 'Amina', 'Hassan', '111', 'NRC', 'staff', 'F1', 'MIC', 'MLS', 'DR', '', ''],
      ['pat@ngo.test', 'Pat', 'Partner', '222', 'Passport', 'monitor', '', '', '', '', 'DSM;MWZ', ''],
    ],
  });

  it('previews without changing anything', async () => {
    const res = await preview(await country());
    expect(res.status).toBe(200);
    expect(res.body.plan.canApply).toBe(true);
    expect(res.body.plan.tabs.map((t: { tab: string; counts: { added: number } }) => [t.tab, t.counts.added])).toEqual([
      ['Regions', 2], ['Districts', 2], ['Departments', 2], ['Facilities', 2], ['Org Roles', 1], ['Job Titles', 1], ['Users', 2],
    ]);
    expect(query('SELECT id FROM regions')).toHaveLength(0);
    expect(query('SELECT id FROM users')).toHaveLength(1);
  });

  it('applies the whole workbook and returns credentials for new users only', async () => {
    const buf = await country();
    const { body } = await preview(buf);
    const res = await apply(buf, body.plan.fingerprint);
    expect(res.status).toBe(200);

    const [f1] = query<Record<string, unknown>>(
      `SELECT f.name, f.facility_type, d.code AS district_code, r.code AS region_code
       FROM facilities f JOIN districts d ON d.id = f.district_id JOIN regions r ON r.id = f.region_id
       WHERE f.code = 'F1'`,
    );
    expect(f1).toEqual({ name: 'Temeke Hospital', facility_type: 'Hospital', district_code: 'TMK', region_code: 'DSM' });
    expect(query<{ code: string }>(
      `SELECT dp.code FROM facility_departments fd
       JOIN departments dp ON dp.id = fd.department_id JOIN facilities f ON f.id = fd.facility_id
       WHERE f.code = 'F1' ORDER BY dp.code`,
    ).map((r) => r.code)).toEqual(['LAB', 'MIC']);

    expect(res.body.credentials).toHaveLength(2);
    const amina = res.body.credentials.find((c: { email: string }) => c.email === 'amina@example.test');
    expect(amina).toMatchObject({ name: 'Amina Hassan', username: 'amina.hassan' });
    const [row] = query<Record<string, unknown>>('SELECT * FROM users WHERE email = ?', ['amina@example.test']);
    expect(bcrypt.compareSync(amina.temp_password, String(row.password))).toBe(true);
    expect(row).toMatchObject({ role: 'staff', is_first_login: 1, is_enabled: 1, temp_password: amina.temp_password });

    const [pat] = query<{ id: number }>('SELECT id FROM users WHERE email = ?', ['pat@ngo.test']);
    expect(query<{ code: string }>(
      'SELECT r.code FROM user_regions ur JOIN regions r ON r.id = ur.region_id WHERE ur.user_id = ? ORDER BY r.code',
      [pat.id],
    ).map((r) => r.code)).toEqual(['DSM', 'MWZ']);

    const [me] = query<Record<string, unknown>>('SELECT user_name, password FROM users WHERE id = ?', [admin]);
    expect(me).toEqual({ user_name: expect.stringMatching(/^user\d+$/), password: 'x' });
  });

  it('refuses a stale fingerprint with 409 and changes nothing', async () => {
    const buf = await country();
    const { body } = await preview(buf);
    createRegion('ARU', 'Arusha'); // the data moved on since the preview
    const res = await apply(buf, body.plan.fingerprint);
    expect(res.status).toBe(409);
    expect(query('SELECT code FROM regions')).toEqual([{ code: 'ARU' }]);
  });

  it('refuses a plan with errors with 422 and changes nothing', async () => {
    const buf = await buildWorkbook({ Districts: [DISTRICTS, ['TMK', 'Temeke', 'ZZZ']] });
    const { body } = await preview(buf);
    expect(body.plan.canApply).toBe(false);
    const res = await apply(buf, body.plan.fingerprint);
    expect(res.status).toBe(422);
    expect(query('SELECT id FROM districts')).toHaveLength(0);
  });

  it('applies all-or-nothing', async () => {
    await expect(applySetupOps({
      org: {
        Regions: [{ kind: 'add', id: null, code: 'DSM', attrs: { region_name: 'Dar es Salaam' } }],
        Districts: [{ kind: 'add', id: null, code: 'TMK', attrs: { district_name: 'Temeke', region_code: 'NOPE' } }],
        Departments: [], Facilities: [], 'Org Roles': [], 'Job Titles': [],
      },
      users: [],
    })).rejects.toThrow();
    expect(query('SELECT id FROM regions')).toHaveLength(0);
  });

  it('archives, deletes and restores facilities and keeps references tidy', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    const tmk = createDistrict('TMK', 'Temeke', dsm);
    const f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    const f2 = createFacility('F2', 'Temeke Clinic', { regionId: dsm, districtId: tmk });
    const lab = createDepartment('LAB', 'Laboratory', [f1, f2]);
    addResponse({ userId: createUser({ enabled: false }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: lab });
    const parked = createUser({ facilityId: f2, departmentId: lab, enabled: false });

    const drop = await buildWorkbook({ Facilities: [FACILITIES, ['F3', 'New Clinic', '', 'TMK', 'LAB']] });
    const p1 = await preview(drop);
    expect((await apply(drop, p1.body.plan.fingerprint)).status).toBe(200);
    expect(query<{ archived_at: string | null }>('SELECT archived_at FROM facilities WHERE id = ?', [f1])[0].archived_at)
      .not.toBeNull();
    expect(query('SELECT id FROM facilities WHERE id = ?', [f2])).toHaveLength(0);
    expect(query('SELECT * FROM facility_departments WHERE facility_id = ?', [f2])).toHaveLength(0);
    expect(query('SELECT facility_id, department_id FROM users WHERE id = ?', [parked]))
      .toEqual([{ facility_id: null, department_id: null }]);

    const back = await buildWorkbook({
      Facilities: [FACILITIES, ['F1', 'Temeke Hospital', '', 'TMK', 'LAB'], ['F3', 'New Clinic', '', 'TMK', 'LAB']],
    });
    const p2 = await preview(back);
    expect(p2.body.plan.tabs[3].changes).toEqual([{ row: 2, key: 'F1', kind: 'restore', fields: [] }]);
    expect((await apply(back, p2.body.plan.fingerprint)).status).toBe(200);
    expect(query('SELECT archived_at FROM facilities WHERE id = ?', [f1])).toEqual([{ archived_at: null }]);
  });

  it('moves facilities with their district when the district changes region', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    createRegion('MWZ', 'Mwanza');
    const tmk = createDistrict('TMK', 'Temeke', dsm);
    const f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    const buf = await buildWorkbook({ Districts: [DISTRICTS, ['TMK', 'Temeke', 'MWZ']] });
    const { body } = await preview(buf);
    expect((await apply(buf, body.plan.fingerprint)).status).toBe(200);
    expect(query<{ code: string }>(
      'SELECT r.code FROM facilities f JOIN regions r ON r.id = f.region_id WHERE f.id = ?', [f1],
    )).toEqual([{ code: 'MWZ' }]);
  });

  it('guards the endpoints', async () => {
    const buf = await country();
    const staff = createUser();
    expect((await preview(buf, staff)).status).toBe(403);
    expect((await request(app).post('/admin/setup/import/preview').set(asUser(admin)).send({ csv: 'x' })).status).toBe(415);
    expect((await request(app).post('/admin/setup/import/apply').set(asUser(admin))
      .set('Content-Type', XLSX_MIME).send(buf)).status).toBe(400);
    expect((await preview(Buffer.alloc(MAX_WORKBOOK_BYTES + 1))).status).toBe(413);
    expect((await preview(Buffer.from('not a workbook'))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Write the failing export tests**

Create `apps/api/test/setup-export.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { execute } from '../src/db/database';
import { XLSX_MIME, loadWorkbook } from '../src/lib/workbook/xlsx';
import {
  initTestDb, resetDb, testApp, asUser, createUser, createRegion, createDistrict, createFacility, createDepartment,
  createOrgRole, createTitle, assignRegions, addResponse, binaryParser, USERS_HEADER,
} from './helpers';
import type * as ExcelJS from 'exceljs';

const app = testApp();
const header = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as unknown[]).slice(1);

describe('country setup export', () => {
  let admin: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin', email: 'boss@example.test' });
  });

  const download = () => request(app).get('/admin/setup/export').set(asUser(admin)).buffer(true).parse(binaryParser);

  it('exports the empty template on a system without organisation data', async () => {
    const res = await download();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(XLSX_MIME);
    expect(res.headers['content-disposition']).toContain('country-setup.xlsx');

    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Read me', 'Regions', 'Districts', 'Departments', 'Facilities', 'Org Roles', 'Job Titles', 'Users',
    ]);
    const regions = wb.getWorksheet('Regions') as ExcelJS.Worksheet;
    expect(header(regions)).toEqual(['region_code', 'region_name']);
    expect(regions.actualRowCount).toBe(1);
    expect(header(wb.getWorksheet('Facilities') as ExcelJS.Worksheet))
      .toEqual(['facility_code', 'facility_name', 'facility_type', 'district_code', 'department_codes']);

    const users = wb.getWorksheet('Users') as ExcelJS.Worksheet;
    expect(header(users)).toEqual([...USERS_HEADER, 'username']);
    expect(users.getCell('A2').value).toBe('boss@example.test');
    expect(users.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect((users.getCell('A1').fill as { pattern?: string }).pattern).toBe('solid');            // required
    expect((users.getCell('F1').fill as { pattern?: string } | undefined)?.pattern).not.toBe('solid'); // optional
    expect(users.getCell('E2').dataValidation).toMatchObject({ type: 'list', formulae: ['"NRC,Passport,Other"'] });
    expect(users.getCell('F2').dataValidation).toMatchObject({ type: 'list', formulae: ['"staff,admin,monitor"'] });
    expect(users.getCell('L2').dataValidation).toMatchObject({ type: 'list', formulae: ['"active,disabled"'] });
    expect(users.getCell('M2').value).toMatch(/^user\d+$/);
    expect((users.getCell('M2').fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe('FFEDEDED');
  });

  it('exports only active organisation entities', async () => {
    createRegion('DSM', 'Dar es Salaam');
    const old = createRegion('OLD', 'Old Region');
    execute("UPDATE regions SET archived_at = datetime('now') WHERE id = ?", [old]);
    const wb = await loadWorkbook((await download()).body as Buffer);
    const regions = wb.getWorksheet('Regions') as ExcelJS.Worksheet;
    expect(regions.actualRowCount).toBe(2);
    expect(regions.getCell('A2').value).toBe('DSM');
  });

  it('re-imports its own export with no changes', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    const mwz = createRegion('MWZ', 'Mwanza');
    const tmk = createDistrict('TMK', 'Temeke', dsm);
    const f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    const f9 = createFacility('F9', 'Closed Clinic', { regionId: dsm, districtId: tmk });
    const lab = createDepartment('LAB', 'Laboratory', [f1, f9]);
    createDepartment('MIC', 'Microbiology', [f1]);
    const mls = createOrgRole('MLS', 'Medical Laboratory Scientist');
    const dr = createTitle('DR', 'Dr.');
    createUser({ facilityId: f1, departmentId: lab, orgRoleId: mls, titleId: dr, idType: 'NRC' });
    const partner = createUser({ role: 'monitor', idType: 'Passport' });
    assignRegions(partner, [dsm, mwz]);
    // A disabled user who still points at an archived facility.
    const leaver = createUser({ facilityId: f9, enabled: false });
    addResponse({ userId: leaver, facilityId: f9, regionId: dsm, districtId: tmk, departmentId: lab });
    execute("UPDATE facilities SET archived_at = datetime('now') WHERE id = ?", [f9]);

    const exported = (await download()).body as Buffer;
    const res = await request(app).post('/admin/setup/import/preview').set(asUser(admin))
      .set('Content-Type', XLSX_MIME).send(exported);
    expect(res.status).toBe(200);
    expect(res.body.plan.tabs.flatMap((t: { errors: unknown[] }) => t.errors)).toEqual([]);
    expect(res.body.plan.tabs.every((t: { present: boolean }) => t.present)).toBe(true);
    expect(res.body.plan.tabs.flatMap((t: { changes: unknown[] }) => t.changes)).toEqual([]);
    expect(res.body.plan.canApply).toBe(true);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @workforce-competency/api test -- setup-import setup-export`
Expected: FAIL — `Cannot find module '../src/lib/workbook/setup-apply'` and 404s for `/admin/setup/export`.

- [ ] **Step 4: Move the credential generators into a shared module**

Create `apps/api/src/lib/credentials.ts`:

```ts
// Usernames and temporary passwords for new accounts (admin form + workbook import).

import crypto from 'crypto';
import { query } from '../db/database';

export function generateTempPassword(): string {
  return crypto.randomBytes(8).toString('base64url').slice(0, 10);
}

/**
 * `first.last` (lower-case, a–z 0–9 and dots), or `first.last_N` when taken.
 * `reserved` holds names already handed out in the same batch.
 */
export function generateUsername(firstName: string, lastName: string, reserved: Set<string> = new Set()): string {
  const base = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`.replace(/[^a-z0-9.]/g, '') || 'user';
  const existing = new Set(
    query<{ user_name: string }>('SELECT user_name FROM users WHERE user_name LIKE ?', [`${base}%`]).map((r) => r.user_name),
  );
  const taken = (name: string) => existing.has(name) || reserved.has(name);
  if (!taken(base)) return base;
  let suffix = 2;
  while (taken(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}
```

In `apps/api/src/routes/admin.ts`:

Delete the line `import crypto from 'crypto';`.

After the line `import { resolveDistrict, backfillResponseDistrict, withRegions } from '../lib/org';` add:

```ts
import { generateTempPassword, generateUsername } from '../lib/credentials';
import setupRouter from './admin-setup';
```

Delete these two functions (under `// ── CSV helpers ───`, keep `parseCsv` there for now):

```ts
function generateTempPassword(): string {
  return crypto.randomBytes(8).toString('base64url').slice(0, 10);
}

function generateUsername(firstName: string, lastName: string): string {
  const base = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`.replace(/[^a-z0-9.]/g, '');
  const existing = query<{ user_name: string }>('SELECT user_name FROM users WHERE user_name LIKE ?', [`${base}%`]);
  if (!existing.length) return base;
  let suffix = 2;
  while (existing.some((r) => r.user_name === `${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}
```

In the `// ── Mount sub-routers ───` block, after `router.use('/users',       usersRouter);` add:

```ts
router.use('/setup',       setupRouter);
```

- [ ] **Step 5: Implement the HTTP helpers**

Create `apps/api/src/lib/workbook/http.ts`:

```ts
// Request/response plumbing for routes that take or return a raw .xlsx body.

import express, { Request, Response } from 'express';
import { createError } from '../../middleware/errorHandler';
import { XLSX_MIME, MAX_WORKBOOK_BYTES } from './xlsx';

/** Route-level body parser: the raw workbook as a Buffer (413 above 10 MB). */
export const xlsxBody = express.raw({ type: XLSX_MIME, limit: MAX_WORKBOOK_BYTES });

export function workbookBody(req: Request): Buffer {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw createError(`Upload an .xlsx workbook (Content-Type: ${XLSX_MIME})`, 415);
  }
  return req.body;
}

export function sendWorkbook(res: Response, buffer: Buffer, filename: string): void {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}
```

- [ ] **Step 6: Implement apply**

Create `apps/api/src/lib/workbook/setup-apply.ts`:

```ts
// Writes a planned country setup import in one transaction. The planner has
// validated everything; anything unexpected here throws and rolls the whole
// import back. Foreign keys are not enforced, so deletes tidy up by hand.

import bcrypt from 'bcryptjs';
import { query, execute, transaction } from '../../db/database';
import { syncFacilitiesRegion, backfillResponseDistrict } from '../org';
import { generateTempPassword, generateUsername } from '../credentials';
import { splitList } from './reader';
import { TAB } from './setup-format';
import type { OrgOp, OrgTab } from './setup-org';
import type { UserOp } from './setup-users';
import type { SetupOps } from './setup-planner';

export interface Credential { name: string; email: string; username: string; temp_password: string }

const TABLE: Record<OrgTab, string> = {
  [TAB.regions]: 'regions',
  [TAB.districts]: 'districts',
  [TAB.departments]: 'departments',
  [TAB.facilities]: 'facilities',
  [TAB.orgRoles]: 'org_roles',
  [TAB.titles]: 'user_titles',
};

// ── Lookups ───────────────────────────────────────────────────────────────────

function idByCode(table: string, code: string): number {
  const [row] = query<{ id: number }>(`SELECT id FROM ${table} WHERE code = ? COLLATE NOCASE`, [code]);
  if (!row) throw new Error(`Import apply: no ${table} row with code "${code}"`);
  return row.id;
}

const optionalId = (table: string, code: string): number | null => (code ? idByCode(table, code) : null);
const isUpsert = (op: OrgOp) => op.kind === 'add' || op.kind === 'update' || op.kind === 'restore';

// ── Organisation upserts ──────────────────────────────────────────────────────

function upsertCodeName(table: string, nameCol: string, op: OrgOp, hasUpdatedAt: boolean): void {
  const name = op.attrs[nameCol];
  if (op.kind === 'add') {
    execute(`INSERT INTO ${table} (code, name) VALUES (?, ?)`, [op.code, name]);
    return;
  }
  const touch = hasUpdatedAt ? ", updated_at = datetime('now')" : '';
  execute(`UPDATE ${table} SET name = ?, archived_at = NULL${touch} WHERE id = ?`, [name, op.id]);
}

function upsertDistrict(op: OrgOp): void {
  const regionId = idByCode('regions', op.attrs.region_code);
  if (op.kind === 'add') {
    execute('INSERT INTO districts (code, name, region_id) VALUES (?, ?, ?)', [op.code, op.attrs.district_name, regionId]);
    return;
  }
  const id = op.id as number;
  const [before] = query<{ region_id: number }>('SELECT region_id FROM districts WHERE id = ?', [id]);
  execute(
    `UPDATE districts SET name = ?, region_id = ?, archived_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    [op.attrs.district_name, regionId, id],
  );
  if (before && before.region_id !== regionId) syncFacilitiesRegion(id, regionId); // invariant 2
}

function upsertFacility(op: OrgOp): void {
  const [district] = query<{ id: number; region_id: number }>(
    'SELECT id, region_id FROM districts WHERE code = ? COLLATE NOCASE', [op.attrs.district_code],
  );
  if (!district) throw new Error(`Import apply: no district with code "${op.attrs.district_code}"`);
  const type = op.attrs.facility_type || null;
  let id: number;
  if (op.kind === 'add') {
    execute(
      'INSERT INTO facilities (code, name, facility_type, region_id, district_id) VALUES (?, ?, ?, ?, ?)',
      [op.code, op.attrs.facility_name, type, district.region_id, district.id],
    );
    id = idByCode('facilities', op.code);
  } else {
    id = op.id as number;
    execute(
      `UPDATE facilities SET name = ?, facility_type = ?, region_id = ?, district_id = ?, archived_at = NULL,
         updated_at = datetime('now') WHERE id = ?`,
      [op.attrs.facility_name, type, district.region_id, district.id, id],
    );
    backfillResponseDistrict(id, district.id);
  }
  execute('DELETE FROM facility_departments WHERE facility_id = ?', [id]);
  for (const code of splitList(op.attrs.department_codes)) {
    execute('INSERT INTO facility_departments (facility_id, department_id) VALUES (?, ?)', [id, idByCode('departments', code)]);
  }
}

// ── Removals ──────────────────────────────────────────────────────────────────

function removeEntity(tab: OrgTab, op: OrgOp): void {
  const table = TABLE[tab];
  const id = op.id as number;
  if (op.kind === 'archive') {
    execute(`UPDATE ${table} SET archived_at = datetime('now') WHERE id = ?`, [id]);
    return;
  }
  // Delete: no history, so only links and (disabled) users can still point here.
  if (tab === TAB.regions) execute('DELETE FROM user_regions WHERE region_id = ?', [id]);
  if (tab === TAB.districts) execute('UPDATE facilities SET district_id = NULL WHERE district_id = ?', [id]);
  if (tab === TAB.departments) {
    execute('DELETE FROM facility_departments WHERE department_id = ?', [id]);
    execute('UPDATE users SET department_id = NULL WHERE department_id = ?', [id]);
  }
  if (tab === TAB.facilities) {
    execute('DELETE FROM facility_departments WHERE facility_id = ?', [id]);
    execute('UPDATE users SET facility_id = NULL, department_id = NULL WHERE facility_id = ?', [id]);
  }
  execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
}

// ── Users ─────────────────────────────────────────────────────────────────────

interface PreparedUser { op: UserOp; username: string; temp: string; hash: string }

function setRegions(userId: number, codes: string): void {
  execute('DELETE FROM user_regions WHERE user_id = ?', [userId]);
  for (const code of splitList(codes)) {
    execute('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)', [userId, idByCode('regions', code)]);
  }
}

function writeUser(op: UserOp, prepared: PreparedUser | undefined): void {
  const v = op.values;
  if (op.kind === 'disable') {
    execute(`UPDATE users SET is_enabled = 0, updated_at = datetime('now') WHERE id = ?`, [op.id]);
    return;
  }
  const placement = [
    optionalId('facilities', v.facility_code),
    optionalId('departments', v.department_code),
    optionalId('org_roles', v.org_role_code),
    optionalId('user_titles', v.title_code),
  ];
  const enabled = v.status === 'active' ? 1 : 0;
  let userId: number;
  if (op.kind === 'add') {
    if (!prepared) throw new Error('Import apply: missing credentials for a new user');
    const email = v.email.toLowerCase();
    execute(
      `INSERT INTO users (first_name, last_name, national_id, id_type, email, user_name, password, role, is_enabled,
         facility_id, department_id, org_role_id, title_id, temp_password)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [v.first_name, v.last_name, v.national_id, v.id_type, email, prepared.username, prepared.hash, v.system_role,
       enabled, ...placement, prepared.temp],
    );
    userId = query<{ id: number }>('SELECT id FROM users WHERE email = ?', [email])[0].id;
  } else {
    userId = op.id as number;
    execute(
      `UPDATE users SET first_name = ?, last_name = ?, national_id = ?, id_type = ?, role = ?, is_enabled = ?,
         facility_id = ?, department_id = ?, org_role_id = ?, title_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [v.first_name, v.last_name, v.national_id, v.id_type, v.system_role, enabled, ...placement, userId],
    );
  }
  setRegions(userId, v.region_codes);
}

// ── Apply ─────────────────────────────────────────────────────────────────────

export async function applySetupOps(ops: SetupOps): Promise<Credential[]> {
  // Hash outside the transaction (bcrypt is async; transaction() is not).
  const reserved = new Set<string>();
  const prepared = new Map<UserOp, PreparedUser>();
  for (const op of ops.users) {
    if (op.kind !== 'add') continue;
    const username = generateUsername(op.values.first_name, op.values.last_name, reserved);
    reserved.add(username);
    const temp = generateTempPassword();
    prepared.set(op, { op, username, temp, hash: await bcrypt.hash(temp, 12) });
  }

  transaction(() => {
    // Parents before children, then users, then removals children-first.
    for (const op of ops.org[TAB.regions].filter(isUpsert)) upsertCodeName('regions', 'region_name', op, true);
    for (const op of ops.org[TAB.districts].filter(isUpsert)) upsertDistrict(op);
    for (const op of ops.org[TAB.departments].filter(isUpsert)) upsertCodeName('departments', 'department_name', op, true);
    for (const op of ops.org[TAB.facilities].filter(isUpsert)) upsertFacility(op);
    for (const op of ops.org[TAB.orgRoles].filter(isUpsert)) upsertCodeName('org_roles', 'role_name', op, false);
    for (const op of ops.org[TAB.titles].filter(isUpsert)) upsertCodeName('user_titles', 'title_name', op, false);
    for (const op of ops.users) writeUser(op, prepared.get(op));
    const removalOrder: OrgTab[] = [TAB.facilities, TAB.districts, TAB.regions, TAB.departments, TAB.orgRoles, TAB.titles];
    for (const tab of removalOrder) {
      for (const op of ops.org[tab].filter((o) => !isUpsert(o))) removeEntity(tab, op);
    }
  });

  return [...prepared.values()].map((p) => ({
    name: `${p.op.values.first_name} ${p.op.values.last_name}`,
    email: p.op.values.email.toLowerCase(),
    username: p.username,
    temp_password: p.temp,
  }));
}
```

- [ ] **Step 7: Implement the workbook writer and the setup export**

Create `apps/api/src/lib/workbook/writer.ts`:

```ts
// Writes tabs in the shape the reader expects: frozen header row, shaded
// required headers, text-formatted cells (so codes like 1.10 survive Excel),
// optional dropdown validation and greyed read-only columns.

import fs from 'fs';
import path from 'path';
import * as ExcelJS from 'exceljs';
import { TabSpec } from './reader';
import { README_TAB } from './setup-format';

const REQUIRED_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } };
const READONLY_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } };
const READONLY_FONT: Partial<ExcelJS.Font> = { italic: true, color: { argb: 'FF808080' } };
const VALIDATION_ROWS = 1000;

export interface WriteTabOptions {
  /** Columns appended after the spec's, greyed and ignored on import. */
  readOnly?: string[];
  /** Column → allowed values, offered as an in-cell dropdown. */
  lists?: Record<string, readonly string[]>;
}

export function writeTab(wb: ExcelJS.Workbook, spec: TabSpec, rows: string[][], opts: WriteTabOptions = {}): ExcelJS.Worksheet {
  const readOnly = opts.readOnly ?? [];
  const headers = [...spec.columns.map((c) => c.name), ...readOnly];
  const ws = wb.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(14, h.length + 4), style: { numFmt: '@' } }));
  for (const r of rows) ws.addRow(r);

  const header = ws.getRow(1);
  header.font = { bold: true };
  spec.columns.forEach((c, i) => {
    if (c.required) header.getCell(i + 1).fill = REQUIRED_FILL;
  });

  for (const name of readOnly) {
    const col = headers.indexOf(name) + 1;
    header.getCell(col).font = { bold: true, ...READONLY_FONT };
    header.getCell(col).note = 'Written on export, ignored on import';
    for (let r = 2; r <= rows.length + 1; r++) {
      const cell = ws.getCell(r, col);
      cell.fill = READONLY_FILL;
      cell.font = READONLY_FONT;
    }
  }

  for (const [name, values] of Object.entries(opts.lists ?? {})) {
    const col = headers.indexOf(name) + 1;
    if (col === 0) continue;
    for (let r = 2; r <= Math.max(VALIDATION_ROWS, rows.length + 1); r++) {
      ws.getCell(r, col).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${values.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Invalid value',
        error: `Choose one of: ${values.join(', ')}`,
      };
    }
  }
  return ws;
}

/** The "Read me" tab: a title, then label / text rows. Ignored on import. */
export function writeReadme(wb: ExcelJS.Workbook, title: string, lines: [string, string][]): void {
  const ws = wb.addWorksheet(README_TAB);
  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 100;
  ws.addRow([title]).font = { bold: true, size: 14 };
  ws.addRow([]);
  for (const [label, text] of lines) {
    const row = ws.addRow([label, text]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }
}

/** apps/api/package.json version (same relative path from src/ and dist/). */
export function appVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
```

Create `apps/api/src/lib/workbook/setup-export.ts`:

```ts
// "Export setup": the current active organisation data and all users in the
// import format. On a system without organisation data this is the template.

import * as ExcelJS from 'exceljs';
import { TabSpec } from './reader';
import { SETUP_TABS, TAB, USERNAME_COLUMN, ID_TYPES, SYSTEM_ROLES, STATUSES } from './setup-format';
import { SetupSnapshot } from './setup-snapshot';
import { workbookToBuffer } from './xlsx';
import { writeReadme, writeTab, appVersion } from './writer';

function spec(name: string): TabSpec {
  const found = SETUP_TABS.find((t) => t.name === name);
  if (!found) throw new Error(`Unknown setup tab ${name}`);
  return found;
}

const README: [string, string][] = [
  ['How to use', 'One row per item on each tab. Shaded column headers are required; leave optional cells empty.'],
  ['Matching', 'Rows are matched by code (email for users), ignoring upper/lower case. To rename something, keep its code and change the name. Changing a code removes the old item and adds a new one.'],
  ['Full sync', 'Every tab you include is the complete list. Items missing from a tab are archived (if they have history) or deleted; users missing from Users are disabled. Delete a whole tab to leave that kind of data unchanged.'],
  ['Your account', 'Keep your own admin account on the Users tab — the import will not disable or demote you.'],
  ['Lists', 'department_codes and region_codes take several codes separated by ";".'],
  ['Allowed values', 'id_type: NRC, Passport, Other · system_role: staff, admin, monitor (default staff) · status: active, disabled (default active).'],
  ['Partners', 'monitor users need region_codes and no facility, department, org role or title. Other users must not have region_codes.'],
  ['Departments', "A user's department_code must be one of their facility's department_codes."],
  ['username', 'Shown for reference and ignored on import. New users get a generated username and temporary password, shown once after the import.'],
];

export async function writeSetupWorkbook(snap: SetupSnapshot): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  writeReadme(wb, 'Country setup workbook', [
    ...README,
    ['Exported', new Date().toISOString()],
    ['App version', appVersion()],
  ]);
  const active = <T extends { archived: boolean }>(rows: T[]) => rows.filter((r) => !r.archived);
  writeTab(wb, spec(TAB.regions), active(snap.regions).map((r) => [r.code, r.name]));
  writeTab(wb, spec(TAB.districts), active(snap.districts).map((d) => [d.code, d.name, d.regionCode]));
  writeTab(wb, spec(TAB.departments), active(snap.departments).map((d) => [d.code, d.name]));
  writeTab(wb, spec(TAB.facilities), active(snap.facilities).map((f) => [
    f.code, f.name, f.facilityType, f.districtCode, f.departmentCodes.join(';'),
  ]));
  writeTab(wb, spec(TAB.orgRoles), active(snap.orgRoles).map((r) => [r.code, r.name]));
  writeTab(wb, spec(TAB.titles), active(snap.titles).map((t) => [t.code, t.name]));
  writeTab(
    wb,
    spec(TAB.users),
    snap.users.map((u) => [
      u.email, u.firstName, u.lastName, u.nationalId, u.idType, u.role, u.facilityCode, u.departmentCode,
      u.orgRoleCode, u.titleCode, u.regionCodes.join(';'), u.enabled ? 'active' : 'disabled', u.userName,
    ]),
    { readOnly: [USERNAME_COLUMN], lists: { id_type: ID_TYPES, system_role: SYSTEM_ROLES, status: STATUSES } },
  );
  return workbookToBuffer(wb);
}
```

- [ ] **Step 8: Implement the routes**

Create `apps/api/src/routes/admin-setup.ts`:

```ts
// Country setup workbook — mounted by admin.ts under /admin/setup (auth and
// password-change guards are applied there). Spec §3.

import { Router, Request, Response, NextFunction } from 'express';
import { requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { xlsxBody, workbookBody, sendWorkbook } from '../lib/workbook/http';
import { readSetupWorkbook } from '../lib/workbook/setup-format';
import { loadSetupSnapshot } from '../lib/workbook/setup-snapshot';
import { planSetupImport } from '../lib/workbook/setup-planner';
import { applySetupOps } from '../lib/workbook/setup-apply';
import { writeSetupWorkbook } from '../lib/workbook/setup-export';

const router = Router();

// ── Export ────────────────────────────────────────────────────────────────────

router.get('/export', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    sendWorkbook(res, await writeSetupWorkbook(loadSetupSnapshot()), 'country-setup.xlsx');
  } catch (err) { next(err); }
});

// ── Import ────────────────────────────────────────────────────────────────────

router.post('/import/preview', requireAdmin, xlsxBody, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = await readSetupWorkbook(workbookBody(req));
    const { plan } = planSetupImport(parsed, loadSetupSnapshot(), req.session.userId!);
    res.json({ plan });
  } catch (err) { next(err); }
});

router.post('/import/apply', requireAdmin, xlsxBody, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fingerprint = typeof req.query.fingerprint === 'string' ? req.query.fingerprint : '';
    if (!fingerprint) return next(createError('fingerprint is required — preview the workbook first', 400));
    const parsed = await readSetupWorkbook(workbookBody(req));
    const { plan, ops } = planSetupImport(parsed, loadSetupSnapshot(), req.session.userId!);
    if (plan.fingerprint !== fingerprint) {
      return next(createError('The data changed since the preview — preview the workbook again', 409));
    }
    if (!plan.canApply) return next(createError('The workbook has errors — fix them and preview again', 422));
    const credentials = await applySetupOps(ops);
    res.json({ plan, credentials });
  } catch (err) { next(err); }
});

export default router;
```

Note the guard order in the test: the 415 case (`send({ csv })`) sends JSON, so `workbookBody` throws 415; the 400 case has no `fingerprint`.

- [ ] **Step 9: Run the tests and typecheck**

Run: `pnpm --filter @workforce-competency/api test -- setup-import setup-export`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/api test`
Expected: PASS (`admin-users-monitors` still creates users through the moved generators).
Run: `pnpm --filter @workforce-competency/api typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/lib/credentials.ts apps/api/src/lib/workbook apps/api/src/routes/admin-setup.ts apps/api/src/routes/admin.ts apps/api/test/setup-import.test.ts apps/api/test/setup-export.test.ts
git commit -m "feat(api): country setup workbook preview, apply and export"
```

---

### Task 5: Assessment catalogue workbook — preview, apply, export

**Files:**
- Create: `apps/api/src/lib/workbook/catalogue.ts`, `apps/api/src/routes/assessments-catalogue.ts`
- Modify: `apps/api/src/routes/assessments.ts` (imports at top; mount right after `router.use(requireAuth, requirePasswordChanged);`)
- Test: `apps/api/test/catalogue-import.test.ts` (create)

**Interfaces:**
- Consumes (Tasks 1–4): `loadWorkbook`, `workbookToBuffer`; `ParsedTab`, `SheetRow`, `TabSpec`, `readTabs`, `req`, `opt`; `ImportPlan`, `TabPlan`, `newTab`, `diffFields`, `finalisePlan`; `writeTab`, `writeReadme`, `appVersion`; `xlsxBody`, `workbookBody`, `sendWorkbook`; helpers `buildWorkbook`, `binaryParser`; `testApp()` mounts `/assessments` (Task 1).
- Produces (`catalogue.ts`):
  - `CAT_TAB = { domains: 'Domains', items: 'Items', footnotes: 'Footnotes' }`, `type CatalogueTabName`, `CATALOGUE_TABS: TabSpec[]`, `ITEM_FIELDS: string[]` (`competency_value, competency_text, subcompetency_text, beginner, competent, proficient, expert, na`), `type ParsedCatalogue = Record<CatalogueTabName, ParsedTab | null>`, `readCatalogueWorkbook(buffer: Buffer): Promise<ParsedCatalogue>`, `usableRows(tab: ParsedTab | null): SheetRow[]` (rows without errors).
  - `interface CatDomain { id: number; code: string; values: Record<string, string> }` (keys `domain_name, version, purpose, introduction`), `interface CatItem { id: number; domainCode: string; subcompetency: string; sortOrder: number; values: Record<string, string> }` (keys `ITEM_FIELDS`), `interface CatFootnote { id: number; domainCode: string; symbol: string; definition: string; sortOrder: number }`, `interface CatalogueSnapshot { domains: CatDomain[]; items: CatItem[]; footnotes: CatFootnote[] }`, `loadCatalogueSnapshot(): CatalogueSnapshot`.
  - `interface CatalogueOps { domains: DomainOp[]; items: ItemOp[]; footnotes: FootnoteOp[] }`, `planCatalogueImport(parsed: ParsedCatalogue, snap: CatalogueSnapshot): { plan: ImportPlan; ops: CatalogueOps }` (add + update only), `applyCatalogueOps(ops: CatalogueOps): void` (one transaction), `writeCatalogueWorkbook(snap: CatalogueSnapshot): Promise<Buffer>`.
  - HTTP: `GET /assessments/catalogue/export` (`assessment-catalogue.xlsx`), `POST /assessments/catalogue/import/preview` → `{ plan }`, `POST /assessments/catalogue/import/apply?fingerprint=` → `{ plan, credentials: [] }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/catalogue-import.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { query, execute } from '../src/db/database';
import { XLSX_MIME, loadWorkbook } from '../src/lib/workbook/xlsx';
import { initTestDb, resetDb, testApp, asUser, createUser, buildWorkbook, binaryParser } from './helpers';
import type * as ExcelJS from 'exceljs';

const app = testApp();

const DOMAINS = ['domain_code', 'domain_name', 'version', 'purpose', 'introduction'];
const ITEMS = [
  'domain_code', 'competency_value', 'competency_text', 'subcompetency_value', 'subcompetency_text',
  'beginner', 'competent', 'proficient', 'expert', 'na',
];
const FOOTNOTES = ['domain_code', 'symbol', 'definition', 'sort_order'];
const item = (code: string, sub: string, text = `Sub ${sub}`) =>
  [code, '1', 'Competency one', sub, text, 'b', 'c', 'p', 'e', 'N/A'];

interface Tab { tab: string; counts: Record<string, number>; changes: unknown[]; errors: unknown[] }
const tab = (plan: { tabs: Tab[] }, name: string) => plan.tabs.find((t) => t.tab === name) as Tab;

describe('assessment catalogue workbook', () => {
  let admin: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    execute('DELETE FROM assessment_footnotes');
    execute('DELETE FROM assessment_items');
    execute('DELETE FROM assessment_domains');
    admin = createUser({ role: 'admin' });
    execute("INSERT INTO assessment_domains (code, name, version) VALUES ('LAB', 'Laboratory', 1)");
    const [{ id }] = query<{ id: number }>("SELECT id FROM assessment_domains WHERE code = 'LAB'");
    for (const [sub, sort] of [['1.01', 0], ['1.02', 1]] as const) {
      execute(
        `INSERT INTO assessment_items (domain_id, competency_value, competency_text, subcompetency_value, subcompetency_text,
           beginner, competent, proficient, expert, na, sort_order)
         VALUES (?, '1', 'Competency one', ?, ?, 'b', 'c', 'p', 'e', 'N/A', ?)`,
        [id, sub, `Sub ${sub}`, sort],
      );
    }
    execute("INSERT INTO assessment_footnotes (domain_id, symbol, definition, sort_order) VALUES (?, '*', 'Defined term', 1)", [id]);
  });

  const preview = (buf: Buffer, user = admin) =>
    request(app).post('/assessments/catalogue/import/preview').set(asUser(user)).set('Content-Type', XLSX_MIME).send(buf);
  const apply = (buf: Buffer, fingerprint: string) =>
    request(app).post(`/assessments/catalogue/import/apply?fingerprint=${fingerprint}`).set(asUser(admin))
      .set('Content-Type', XLSX_MIME).send(buf);
  const download = (user = admin) =>
    request(app).get('/assessments/catalogue/export').set(asUser(user)).buffer(true).parse(binaryParser);

  const updated = () => buildWorkbook({
    Domains: [DOMAINS, ['lab', 'Laboratory Practice', '2', 'Why it matters', ''], ['BIO', 'Bioinformatics', '1', '', '']],
    Items: [ITEMS, item('LAB', '1.01'), item('LAB', '1.02', 'Changed'), item('LAB', '1.10'), item('BIO', '1.01')],
    Footnotes: [FOOTNOTES, ['LAB', '*', 'Defined term', '1'], ['BIO', '†', 'Dagger', '']],
  });

  it('previews adds and updates without changing anything', async () => {
    const res = await preview(await updated());
    expect(res.status).toBe(200);
    const { plan } = res.body;
    expect(plan.canApply).toBe(true);
    expect(tab(plan, 'Domains').changes).toEqual([
      {
        row: 2, key: 'LAB', kind: 'update',
        fields: [
          { field: 'domain_name', from: 'Laboratory', to: 'Laboratory Practice' },
          { field: 'version', from: '1', to: '2' },
          { field: 'purpose', from: '', to: 'Why it matters' },
        ],
      },
      {
        row: 3, key: 'BIO', kind: 'add',
        fields: [{ field: 'domain_name', from: '', to: 'Bioinformatics' }, { field: 'version', from: '', to: '1' }],
      },
    ]);
    expect(tab(plan, 'Items').counts).toMatchObject({ added: 2, updated: 1, unchanged: 1 });
    expect(tab(plan, 'Items').changes[0]).toEqual({
      row: 3, key: 'LAB 1.02', kind: 'update', fields: [{ field: 'subcompetency_text', from: 'Sub 1.02', to: 'Changed' }],
    });
    expect(tab(plan, 'Footnotes').counts).toMatchObject({ added: 1, unchanged: 1 });
    expect(query('SELECT id FROM assessment_domains')).toHaveLength(1);
  });

  it('applies adds and updates, appending new items after a domain\'s existing ones', async () => {
    const buf = await updated();
    const { body } = await preview(buf);
    const res = await apply(buf, body.plan.fingerprint);
    expect(res.status).toBe(200);
    expect(res.body.credentials).toEqual([]);
    expect(query("SELECT name, version, purpose FROM assessment_domains WHERE code = 'LAB'"))
      .toEqual([{ name: 'Laboratory Practice', version: 2, purpose: 'Why it matters' }]);
    expect(query(
      `SELECT d.code, i.subcompetency_value AS sub, i.subcompetency_text AS text, i.sort_order
       FROM assessment_items i JOIN assessment_domains d ON d.id = i.domain_id ORDER BY d.code, i.sort_order`,
    )).toEqual([
      { code: 'BIO', sub: '1.01', text: 'Sub 1.01', sort_order: 0 },
      { code: 'LAB', sub: '1.01', text: 'Sub 1.01', sort_order: 0 },
      { code: 'LAB', sub: '1.02', text: 'Changed', sort_order: 1 },
      { code: 'LAB', sub: '1.10', text: 'Sub 1.10', sort_order: 2 },
    ]);
    expect(query(
      `SELECT d.code, f.symbol, f.sort_order FROM assessment_footnotes f
       JOIN assessment_domains d ON d.id = f.domain_id ORDER BY d.code`,
    )).toEqual([{ code: 'BIO', symbol: '†', sort_order: 0 }, { code: 'LAB', symbol: '*', sort_order: 1 }]);
  });

  it('never removes anything', async () => {
    const buf = await buildWorkbook({ Items: [ITEMS, item('LAB', '1.01')] });
    const { body } = await preview(buf);
    expect(body.plan.tabs.flatMap((t: Tab) => t.changes)).toEqual([]);
    expect(body.plan.confirmations).toEqual({ archived: 0, deleted: 0, disabledUsers: 0 });
    expect((await apply(buf, body.plan.fingerprint)).status).toBe(200);
    expect(query('SELECT id FROM assessment_items')).toHaveLength(2);
    expect(query('SELECT id FROM assessment_footnotes')).toHaveLength(1);
  });

  it('reports unknown domains, duplicates and bad numbers', async () => {
    const { body } = await preview(await buildWorkbook({
      Domains: [DOMAINS, ['NEW', 'New', 'v2', '', '']],
      Items: [ITEMS, item('ZZZ', '1.01'), item('LAB', '1.01'), item('lab', '1.01')],
      Footnotes: [FOOTNOTES, ['LAB', '*', 'Defined term', 'first']],
    }));
    expect(tab(body.plan, 'Domains').errors).toEqual([
      { row: 2, column: 'version', message: 'version must be a whole number of 1 or more' },
    ]);
    expect(tab(body.plan, 'Items').errors).toEqual([
      { row: 2, column: 'domain_code', message: 'domain_code "ZZZ" is not in the Domains tab or the database' },
      { row: 4, column: 'subcompetency_value', message: 'Duplicate item LAB 1.01 — first used on row 3' },
    ]);
    expect(tab(body.plan, 'Footnotes').errors).toEqual([
      { row: 2, column: 'sort_order', message: 'sort_order must be a whole number' },
    ]);
    expect(body.plan.canApply).toBe(false);
  });

  it('exports the catalogue and re-imports it with no changes', async () => {
    const res = await download();
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('assessment-catalogue.xlsx');
    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Read me', 'Domains', 'Items', 'Footnotes']);
    expect((wb.getWorksheet('Items') as ExcelJS.Worksheet).getCell('D3').value).toBe('1.02');
    const again = await preview(res.body as Buffer);
    expect(again.body.plan.tabs.flatMap((t: Tab) => t.changes)).toEqual([]);
    expect(again.body.plan.canApply).toBe(true);
  });

  it('guards the endpoints', async () => {
    const staff = createUser();
    expect((await download(staff)).status).toBe(403);
    const buf = await updated();
    expect((await preview(buf, staff)).status).toBe(403);
    const { body } = await preview(buf);
    execute("UPDATE assessment_domains SET name = 'Renamed' WHERE code = 'LAB'");
    expect((await apply(buf, body.plan.fingerprint)).status).toBe(409);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workforce-competency/api test -- catalogue-import`
Expected: FAIL — 404 on `/assessments/catalogue/...` (routes do not exist).

- [ ] **Step 3: Implement the catalogue module**

Create `apps/api/src/lib/workbook/catalogue.ts`:

```ts
// The assessment catalogue workbook (assessment-catalogue.xlsx): format,
// snapshot, planner (add + update only — it never removes), apply and export.
// The bundled copy seeds a fresh database (db/seed-assessments.ts); admins can
// re-import an updated copy from the Assessments page. Spec §2.

import * as ExcelJS from 'exceljs';
import { query, execute, transaction } from '../../db/database';
import { loadWorkbook, workbookToBuffer } from './xlsx';
import { ParsedTab, SheetRow, TabSpec, readTabs, req, opt } from './reader';
import { ImportPlan, TabPlan, newTab, diffFields, finalisePlan } from './plan';
import { writeTab, writeReadme, appVersion } from './writer';

// ── Format ────────────────────────────────────────────────────────────────────

export const CAT_TAB = { domains: 'Domains', items: 'Items', footnotes: 'Footnotes' } as const;
export type CatalogueTabName = typeof CAT_TAB[keyof typeof CAT_TAB];

export const CATALOGUE_TABS: TabSpec[] = [
  {
    name: CAT_TAB.domains,
    columns: [req('domain_code'), req('domain_name'), req('version'), opt('purpose'), opt('introduction')],
  },
  {
    name: CAT_TAB.items,
    columns: [
      req('domain_code'), req('competency_value'), opt('competency_text'), req('subcompetency_value'),
      req('subcompetency_text'), req('beginner'), req('competent'), req('proficient'), req('expert'), opt('na'),
    ],
  },
  { name: CAT_TAB.footnotes, columns: [req('domain_code'), req('symbol'), req('definition'), opt('sort_order')] },
];

const DOMAIN_FIELDS = ['domain_name', 'version', 'purpose', 'introduction'];
export const ITEM_FIELDS = [
  'competency_value', 'competency_text', 'subcompetency_text', 'beginner', 'competent', 'proficient', 'expert', 'na',
];

export type ParsedCatalogue = Record<CatalogueTabName, ParsedTab | null>;

export async function readCatalogueWorkbook(buffer: Buffer): Promise<ParsedCatalogue> {
  return readTabs(await loadWorkbook(buffer), CATALOGUE_TABS) as ParsedCatalogue;
}

/** Rows without reader errors (used by the lenient startup loader). */
export function usableRows(tab: ParsedTab | null): SheetRow[] {
  if (!tab || !tab.headerOk) return [];
  return tab.rows.filter((r) => !tab.badRows.has(r.row));
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface CatDomain { id: number; code: string; values: Record<string, string> }
export interface CatItem { id: number; domainCode: string; subcompetency: string; sortOrder: number; values: Record<string, string> }
export interface CatFootnote { id: number; domainCode: string; symbol: string; definition: string; sortOrder: number }
export interface CatalogueSnapshot { domains: CatDomain[]; items: CatItem[]; footnotes: CatFootnote[] }

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

export function loadCatalogueSnapshot(): CatalogueSnapshot {
  const domains = query<{
    id: number; code: string; name: string; version: number; purpose: string | null; introduction: string | null;
  }>('SELECT id, code, name, version, purpose, introduction FROM assessment_domains ORDER BY code')
    .map((d) => ({
      id: d.id,
      code: txt(d.code).toUpperCase(),
      values: { domain_name: txt(d.name), version: String(d.version), purpose: txt(d.purpose), introduction: txt(d.introduction) },
    }));
  const items = query<Record<string, string | number | null>>(
    `SELECT i.*, d.code AS domain_code FROM assessment_items i
     JOIN assessment_domains d ON d.id = i.domain_id ORDER BY d.code, i.sort_order, i.id`,
  ).map((i) => ({
    id: Number(i.id),
    domainCode: txt(i.domain_code).toUpperCase(),
    subcompetency: txt(i.subcompetency_value),
    sortOrder: Number(i.sort_order),
    values: Object.fromEntries(ITEM_FIELDS.map((f) => [f, txt(i[f])])),
  }));
  const footnotes = query<{ id: number; domain_code: string; symbol: string; definition: string; sort_order: number }>(
    `SELECT f.id, d.code AS domain_code, f.symbol, f.definition, f.sort_order FROM assessment_footnotes f
     JOIN assessment_domains d ON d.id = f.domain_id ORDER BY d.code, f.sort_order, f.id`,
  ).map((f) => ({
    id: f.id, domainCode: txt(f.domain_code).toUpperCase(), symbol: txt(f.symbol), definition: txt(f.definition),
    sortOrder: Number(f.sort_order),
  }));
  return { domains, items, footnotes };
}

// ── Planning (add + update only) ──────────────────────────────────────────────

export interface DomainOp { kind: 'add' | 'update'; id: number | null; code: string; values: Record<string, string> }
export interface ItemOp {
  kind: 'add' | 'update'; id: number | null; domainCode: string; subcompetency: string; values: Record<string, string>;
}
export interface FootnoteOp {
  kind: 'add' | 'update'; id: number | null; domainCode: string; symbol: string; definition: string; sortOrder: number | null;
}
export interface CatalogueOps { domains: DomainOp[]; items: ItemOp[]; footnotes: FootnoteOp[] }

const WHOLE = /^-?\d+$/;
const unknownDomain = (code: string) => `domain_code "${code}" is not in the Domains tab or the database`;

/** Domains; adds every code the workbook names to `known`. */
function planDomains(parsed: ParsedTab | null, snap: CatalogueSnapshot, known: Set<string>): { plan: TabPlan; ops: DomainOp[] } {
  const plan = newTab(CAT_TAB.domains, parsed !== null);
  const ops: DomainOp[] = [];
  if (!parsed || !parsed.headerOk) {
    if (parsed) plan.errors.push(...parsed.errors);
    return { plan, ops };
  }
  plan.errors.push(...parsed.errors);
  const byCode = new Map(snap.domains.map((d) => [d.code, d]));
  const firstRow = new Map<string, number>();
  for (const r of parsed.rows) {
    const code = r.values.domain_code.toUpperCase();
    if (!code) continue;
    const first = firstRow.get(code);
    if (first !== undefined) {
      plan.errors.push({ row: r.row, column: 'domain_code', message: `Duplicate domain_code "${code}" — first used on row ${first}` });
      continue;
    }
    firstRow.set(code, r.row);
    known.add(code);
    let valid = !parsed.badRows.has(r.row);
    if (r.values.version && !/^[1-9]\d*$/.test(r.values.version)) {
      plan.errors.push({ row: r.row, column: 'version', message: 'version must be a whole number of 1 or more' });
      valid = false;
    }
    if (!valid) continue;
    const values = {
      domain_name: r.values.domain_name, version: r.values.version, purpose: r.values.purpose, introduction: r.values.introduction,
    };
    const prev = byCode.get(code);
    if (!prev) {
      ops.push({ kind: 'add', id: null, code, values });
      plan.changes.push({ row: r.row, key: code, kind: 'add', fields: diffFields({}, values, DOMAIN_FIELDS) });
      continue;
    }
    const fields = diffFields(prev.values, values, DOMAIN_FIELDS);
    if (fields.length) {
      ops.push({ kind: 'update', id: prev.id, code, values });
      plan.changes.push({ row: r.row, key: code, kind: 'update', fields });
    } else {
      plan.counts.unchanged++;
    }
  }
  return { plan, ops };
}

function planItems(parsed: ParsedTab | null, snap: CatalogueSnapshot, known: Set<string>): { plan: TabPlan; ops: ItemOp[] } {
  const plan = newTab(CAT_TAB.items, parsed !== null);
  const ops: ItemOp[] = [];
  if (!parsed || !parsed.headerOk) {
    if (parsed) plan.errors.push(...parsed.errors);
    return { plan, ops };
  }
  plan.errors.push(...parsed.errors);
  const existing = new Map<string, CatItem>();
  for (const i of snap.items) {
    const key = `${i.domainCode}|${i.subcompetency}`;
    if (!existing.has(key)) existing.set(key, i);
  }
  const firstRow = new Map<string, number>();
  for (const r of parsed.rows) {
    const code = r.values.domain_code.toUpperCase();
    const sub = r.values.subcompetency_value;
    if (!code || !sub) continue;
    const key = `${code}|${sub}`;
    const label = `${code} ${sub}`;
    const first = firstRow.get(key);
    if (first !== undefined) {
      plan.errors.push({ row: r.row, column: 'subcompetency_value', message: `Duplicate item ${label} — first used on row ${first}` });
      continue;
    }
    firstRow.set(key, r.row);
    let valid = !parsed.badRows.has(r.row);
    if (!known.has(code)) {
      plan.errors.push({ row: r.row, column: 'domain_code', message: unknownDomain(code) });
      valid = false;
    }
    if (!valid) continue;
    const values = Object.fromEntries(ITEM_FIELDS.map((f) => [f, r.values[f] ?? '']));
    const prev = existing.get(key);
    if (!prev) {
      ops.push({ kind: 'add', id: null, domainCode: code, subcompetency: sub, values });
      plan.changes.push({ row: r.row, key: label, kind: 'add', fields: diffFields({}, values, ITEM_FIELDS) });
      continue;
    }
    const fields = diffFields(prev.values, values, ITEM_FIELDS);
    if (fields.length) {
      ops.push({ kind: 'update', id: prev.id, domainCode: code, subcompetency: sub, values });
      plan.changes.push({ row: r.row, key: label, kind: 'update', fields });
    } else {
      plan.counts.unchanged++;
    }
  }
  return { plan, ops };
}

function planFootnotes(parsed: ParsedTab | null, snap: CatalogueSnapshot, known: Set<string>): { plan: TabPlan; ops: FootnoteOp[] } {
  const plan = newTab(CAT_TAB.footnotes, parsed !== null);
  const ops: FootnoteOp[] = [];
  if (!parsed || !parsed.headerOk) {
    if (parsed) plan.errors.push(...parsed.errors);
    return { plan, ops };
  }
  plan.errors.push(...parsed.errors);
  const existing = new Map<string, CatFootnote>();
  for (const f of snap.footnotes) {
    const key = `${f.domainCode}|${f.symbol}`;
    if (!existing.has(key)) existing.set(key, f);
  }
  const firstRow = new Map<string, number>();
  for (const r of parsed.rows) {
    const code = r.values.domain_code.toUpperCase();
    const symbol = r.values.symbol;
    if (!code || !symbol) continue;
    const key = `${code}|${symbol}`;
    const label = `${code} ${symbol}`;
    const first = firstRow.get(key);
    if (first !== undefined) {
      plan.errors.push({ row: r.row, column: 'symbol', message: `Duplicate footnote ${label} — first used on row ${first}` });
      continue;
    }
    firstRow.set(key, r.row);
    let valid = !parsed.badRows.has(r.row);
    const rawSort = r.values.sort_order;
    if (rawSort && !WHOLE.test(rawSort)) {
      plan.errors.push({ row: r.row, column: 'sort_order', message: 'sort_order must be a whole number' });
      valid = false;
    }
    if (!known.has(code)) {
      plan.errors.push({ row: r.row, column: 'domain_code', message: unknownDomain(code) });
      valid = false;
    }
    if (!valid) continue;
    // A blank sort_order keeps an existing footnote's position.
    const sortOrder = rawSort ? Number(rawSort) : null;
    const fields = sortOrder === null ? ['definition'] : ['definition', 'sort_order'];
    const values: Record<string, string> = { definition: r.values.definition };
    if (sortOrder !== null) values.sort_order = String(sortOrder);
    const op = { domainCode: code, symbol, definition: r.values.definition, sortOrder };
    const prev = existing.get(key);
    if (!prev) {
      ops.push({ kind: 'add', id: null, ...op });
      plan.changes.push({ row: r.row, key: label, kind: 'add', fields: diffFields({}, values, fields) });
      continue;
    }
    const diff = diffFields({ definition: prev.definition, sort_order: String(prev.sortOrder) }, values, fields);
    if (diff.length) {
      ops.push({ kind: 'update', id: prev.id, ...op });
      plan.changes.push({ row: r.row, key: label, kind: 'update', fields: diff });
    } else {
      plan.counts.unchanged++;
    }
  }
  return { plan, ops };
}

export function planCatalogueImport(parsed: ParsedCatalogue, snap: CatalogueSnapshot): { plan: ImportPlan; ops: CatalogueOps } {
  const known = new Set(snap.domains.map((d) => d.code));
  const domains = planDomains(parsed[CAT_TAB.domains], snap, known);
  const items = planItems(parsed[CAT_TAB.items], snap, known);
  const footnotes = planFootnotes(parsed[CAT_TAB.footnotes], snap, known);
  return {
    plan: finalisePlan([domains.plan, items.plan, footnotes.plan]),
    ops: { domains: domains.ops, items: items.ops, footnotes: footnotes.ops },
  };
}

// ── Apply ─────────────────────────────────────────────────────────────────────

function domainId(code: string): number {
  const [row] = query<{ id: number }>('SELECT id FROM assessment_domains WHERE code = ? COLLATE NOCASE', [code]);
  if (!row) throw new Error(`Catalogue apply: no domain "${code}"`);
  return row.id;
}

function nextSortOrder(table: 'assessment_items' | 'assessment_footnotes', domain: number): number {
  const [row] = query<{ m: number | null }>(`SELECT MAX(sort_order) AS m FROM ${table} WHERE domain_id = ?`, [domain]);
  return row?.m === null || row?.m === undefined ? 0 : row.m + 1;
}

export function applyCatalogueOps(ops: CatalogueOps): void {
  transaction(() => {
    for (const op of ops.domains) {
      const v = op.values;
      const args = [v.domain_name, Number(v.version), v.purpose || null, v.introduction || null];
      if (op.kind === 'add') {
        execute('INSERT INTO assessment_domains (code, name, version, purpose, introduction) VALUES (?, ?, ?, ?, ?)', [op.code, ...args]);
      } else {
        execute(
          `UPDATE assessment_domains SET name = ?, version = ?, purpose = ?, introduction = ?, updated_at = datetime('now')
           WHERE id = ?`,
          [...args, op.id],
        );
      }
    }
    for (const op of ops.items) {
      const v = op.values;
      const cols = [
        v.competency_value, v.competency_text, op.subcompetency, v.subcompetency_text,
        v.beginner, v.competent, v.proficient, v.expert, v.na,
      ];
      if (op.kind === 'add') {
        const domain = domainId(op.domainCode);
        execute(
          `INSERT INTO assessment_items (domain_id, competency_value, competency_text, subcompetency_value, subcompetency_text,
             beginner, competent, proficient, expert, na, sort_order)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [domain, ...cols, nextSortOrder('assessment_items', domain)],
        );
      } else {
        execute(
          `UPDATE assessment_items SET competency_value = ?, competency_text = ?, subcompetency_value = ?, subcompetency_text = ?,
             beginner = ?, competent = ?, proficient = ?, expert = ?, na = ?, updated_at = datetime('now')
           WHERE id = ?`,
          [...cols, op.id],
        );
      }
    }
    for (const op of ops.footnotes) {
      if (op.kind === 'add') {
        const domain = domainId(op.domainCode);
        execute(
          'INSERT INTO assessment_footnotes (domain_id, symbol, definition, sort_order) VALUES (?, ?, ?, ?)',
          [domain, op.symbol, op.definition, op.sortOrder ?? nextSortOrder('assessment_footnotes', domain)],
        );
      } else {
        execute(
          'UPDATE assessment_footnotes SET definition = ?, sort_order = COALESCE(?, sort_order) WHERE id = ?',
          [op.definition, op.sortOrder, op.id],
        );
      }
    }
  });
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function writeCatalogueWorkbook(snap: CatalogueSnapshot): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const version = snap.domains.reduce((m, d) => Math.max(m, Number(d.values.version) || 0), 0);
  writeReadme(wb, 'Assessment catalogue', [
    ['How to use', 'Domains, items and footnotes, one row each. Shaded column headers are required.'],
    ['Matching', 'Domains by domain_code; items by domain_code + subcompetency_value; footnotes by domain_code + symbol. Codes ignore upper/lower case.'],
    ['Adds and updates only', 'Importing adds new rows and updates changed ones. Nothing is ever removed — delete items on the Assessments page.'],
    ['Order', "New items are added after a domain's existing items, in sheet order. A blank footnote sort_order keeps the current position."],
    ['Catalogue version', String(version)],
    ['Exported', new Date().toISOString()],
    ['App version', appVersion()],
  ]);
  writeTab(wb, CATALOGUE_TABS[0], snap.domains.map((d) => [
    d.code, d.values.domain_name, d.values.version, d.values.purpose, d.values.introduction,
  ]));
  writeTab(wb, CATALOGUE_TABS[1], snap.items.map((i) => [
    i.domainCode, i.values.competency_value, i.values.competency_text, i.subcompetency, i.values.subcompetency_text,
    i.values.beginner, i.values.competent, i.values.proficient, i.values.expert, i.values.na,
  ]));
  writeTab(wb, CATALOGUE_TABS[2], snap.footnotes.map((f) => [f.domainCode, f.symbol, f.definition, String(f.sortOrder)]));
  return workbookToBuffer(wb);
}
```

- [ ] **Step 4: Implement the routes**

Create `apps/api/src/routes/assessments-catalogue.ts`:

```ts
// Assessment catalogue workbook — mounted by assessments.ts under
// /assessments/catalogue (auth + password-change guards are applied there).

import { Router, Request, Response, NextFunction } from 'express';
import { requireAdmin } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { xlsxBody, workbookBody, sendWorkbook } from '../lib/workbook/http';
import {
  readCatalogueWorkbook, loadCatalogueSnapshot, planCatalogueImport, applyCatalogueOps, writeCatalogueWorkbook,
} from '../lib/workbook/catalogue';

const router = Router();

router.get('/export', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    sendWorkbook(res, await writeCatalogueWorkbook(loadCatalogueSnapshot()), 'assessment-catalogue.xlsx');
  } catch (err) { next(err); }
});

router.post('/import/preview', requireAdmin, xlsxBody, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = await readCatalogueWorkbook(workbookBody(req));
    const { plan } = planCatalogueImport(parsed, loadCatalogueSnapshot());
    res.json({ plan });
  } catch (err) { next(err); }
});

router.post('/import/apply', requireAdmin, xlsxBody, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fingerprint = typeof req.query.fingerprint === 'string' ? req.query.fingerprint : '';
    if (!fingerprint) return next(createError('fingerprint is required — preview the workbook first', 400));
    const parsed = await readCatalogueWorkbook(workbookBody(req));
    const { plan, ops } = planCatalogueImport(parsed, loadCatalogueSnapshot());
    if (plan.fingerprint !== fingerprint) {
      return next(createError('The catalogue changed since the preview — preview the workbook again', 409));
    }
    if (!plan.canApply) return next(createError('The workbook has errors — fix them and preview again', 422));
    applyCatalogueOps(ops);
    res.json({ plan, credentials: [] });
  } catch (err) { next(err); }
});

export default router;
```

In `apps/api/src/routes/assessments.ts`, after the line `import { parseCsv } from '../lib/csv';` add:

```ts
import catalogueRouter from './assessments-catalogue';
```

and directly after `router.use(requireAuth, requirePasswordChanged);` add:

```ts

// ── Catalogue workbook ────────────────────────────────────────────────────────

router.use('/catalogue', catalogueRouter);
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @workforce-competency/api test -- catalogue-import`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/api test`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/api typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/workbook/catalogue.ts apps/api/src/routes/assessments-catalogue.ts apps/api/src/routes/assessments.ts apps/api/test/catalogue-import.test.ts
git commit -m "feat(api): assessment catalogue workbook import and export"
```

---

### Task 6: Bundled catalogue workbook and startup loader

**Files:**
- Create (temporary): `apps/api/src/scripts/build-catalogue-workbook.ts` — run once, then deleted in this task
- Create: `apps/api/seed-data/assessment-catalogue.xlsx` (generated)
- Modify: `apps/api/src/db/seed-assessments.ts` (full rewrite), `apps/api/src/server.ts` (line `seedAssessments();`), `apps/api/Dockerfile` (comment above `COPY … seed-data`)
- Delete: `apps/api/seed-data/assessment_data.csv`, `apps/api/seed-data/footnotes.csv`, `apps/api/seed-data/assessments/` (19 CSVs). Keep `apps/api/seed-data/appendix_b.csv`.
- Test: `apps/api/test/seed-assessments.test.ts` (create)

**Interfaces:**
- Consumes (Task 5): `CAT_TAB`, `ITEM_FIELDS`, `CatalogueSnapshot`, `CatDomain`, `CatItem`, `CatFootnote`, `ParsedCatalogue`, `readCatalogueWorkbook`, `writeCatalogueWorkbook`, `usableRows`; `SheetRow` (Task 1); `parseCsv` from `lib/csv.ts` (existing, script only).
- Produces: `seedAssessments(): Promise<void>` (now async; same insert-only rules), `seedCatalogue(parsed: ParsedCatalogue): { domains: number; items: number; footnotes: number }`, `CATALOGUE_FILE = 'assessment-catalogue.xlsx'`.

Verified counts from today's CSV seeding on a fresh database: **20 domains, 511 items, 1 footnote** (`SAF` has no items; every domain is version 1). The spec's "416 items" is a typo — the parity test pins 511 and the per-domain counts below.

- [ ] **Step 1: Write the one-off conversion script**

Create `apps/api/src/scripts/build-catalogue-workbook.ts`:

```ts
// One-off conversion: the CSV catalogue in seed-data/ → seed-data/assessment-catalogue.xlsx.
// Reads the CSVs the way the old seeder did, writes the workbook, reads it back
// and checks every value survived. Run once, commit the workbook, then delete
// this script together with the CSVs.

import fs from 'fs';
import path from 'path';
import { parseCsv } from '../lib/csv';
import {
  CAT_TAB, ITEM_FIELDS, CatalogueSnapshot, CatDomain, CatItem, CatFootnote, writeCatalogueWorkbook, readCatalogueWorkbook,
} from '../lib/workbook/catalogue';

const SEED_DIR = path.resolve(__dirname, '../../seed-data');
const OUT = path.join(SEED_DIR, 'assessment-catalogue.xlsx');

function readCsv(file: string): Record<string, string>[] {
  const { headers, rows } = parseCsv(fs.readFileSync(file, 'utf8'));
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function fail(message: string): never {
  console.error(`[catalogue] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  // Items: one CSV per domain, mapped by its `code` column; order = sort_order.
  const versions = new Map<string, string>();
  const items: CatItem[] = [];
  const dir = path.join(SEED_DIR, 'assessments');
  for (const filename of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv')).sort()) {
    const rows = readCsv(path.join(dir, filename));
    const codes = new Set(rows.map((r) => r.code.toUpperCase()));
    if (codes.size !== 1) fail(`${filename}: expected one domain code, found ${[...codes].join(', ')}`);
    const code = [...codes][0];
    versions.set(code, rows[0].assessment_version || '1');
    rows.forEach((r, i) => items.push({
      id: 0, domainCode: code, subcompetency: r.subcompetency_value, sortOrder: i,
      values: Object.fromEntries(ITEM_FIELDS.map((f) => [f, r[f] ?? ''])),
    }));
  }

  const domains: CatDomain[] = readCsv(path.join(SEED_DIR, 'assessment_data.csv')).map((r) => {
    const code = r.assessment_code.toUpperCase();
    return {
      id: 0, code,
      values: {
        domain_name: r.assessment_name, version: versions.get(code) ?? '1',
        purpose: r.purpose ?? '', introduction: r.introduction ?? '',
      },
    };
  });

  // Old rule: a footnote's sort_order is its CSV value, else its index within the domain.
  const perDomain = new Map<string, number>();
  const footnotes: CatFootnote[] = readCsv(path.join(SEED_DIR, 'footnotes.csv')).map((r) => {
    const code = r.domain_code.toUpperCase();
    const index = perDomain.get(code) ?? 0;
    perDomain.set(code, index + 1);
    const sort = r.sort_order !== '' && Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : index;
    return { id: 0, domainCode: code, symbol: r.symbol, definition: r.definition, sortOrder: sort };
  });

  const snap: CatalogueSnapshot = { domains, items, footnotes };
  const buffer = await writeCatalogueWorkbook(snap);
  fs.writeFileSync(OUT, buffer);

  // Read it back with the import reader and compare every value (cells are trimmed).
  const parsed = await readCatalogueWorkbook(buffer);
  for (const [name, t] of Object.entries(parsed)) {
    if (!t || !t.headerOk || t.errors.length) fail(`${name}: read-back problems ${JSON.stringify(t?.errors ?? 'tab missing')}`);
  }
  const same = (label: string, expected: string[][], tab: keyof typeof parsed, cols: string[]) => {
    const actual = (parsed[tab]?.rows ?? []).map((r) => cols.map((c) => r.values[c]));
    const want = expected.map((row) => row.map((v) => v.trim()));
    if (want.length !== actual.length) fail(`${label}: ${want.length} source rows, ${actual.length} workbook rows`);
    want.forEach((row, i) => {
      if (JSON.stringify(row) !== JSON.stringify(actual[i])) {
        fail(`${label} row ${i + 2}: ${JSON.stringify(row)} became ${JSON.stringify(actual[i])}`);
      }
    });
  };
  same('Domains', domains.map((d) => [d.code, d.values.domain_name, d.values.version, d.values.purpose, d.values.introduction]),
    CAT_TAB.domains, ['domain_code', 'domain_name', 'version', 'purpose', 'introduction']);
  same('Items', items.map((i) => [
    i.domainCode, i.values.competency_value, i.values.competency_text, i.subcompetency, i.values.subcompetency_text,
    i.values.beginner, i.values.competent, i.values.proficient, i.values.expert, i.values.na,
  ]), CAT_TAB.items, [
    'domain_code', 'competency_value', 'competency_text', 'subcompetency_value', 'subcompetency_text',
    'beginner', 'competent', 'proficient', 'expert', 'na',
  ]);
  same('Footnotes', footnotes.map((f) => [f.domainCode, f.symbol, f.definition, String(f.sortOrder)]),
    CAT_TAB.footnotes, ['domain_code', 'symbol', 'definition', 'sort_order']);

  console.log(`[catalogue] wrote ${OUT}: ${domains.length} domains, ${items.length} items, ${footnotes.length} footnotes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the conversion**

Run: `pnpm --filter @workforce-competency/api exec ts-node --transpile-only src/scripts/build-catalogue-workbook.ts`
Expected: `[catalogue] wrote …/apps/api/seed-data/assessment-catalogue.xlsx: 20 domains, 511 items, 1 footnotes` and exit code 0. Any `fail(...)` line means a value did not survive — stop and fix the writer before continuing.

- [ ] **Step 3: Commit the workbook (and the script, for history)**

```bash
git add apps/api/seed-data/assessment-catalogue.xlsx apps/api/src/scripts/build-catalogue-workbook.ts
git commit -m "chore(api): convert the assessment catalogue CSVs to assessment-catalogue.xlsx"
```

- [ ] **Step 4: Write the parity test**

Create `apps/api/test/seed-assessments.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { query, execute } from '../src/db/database';
import { seedAssessments } from '../src/db/seed-assessments';
import { initTestDb } from './helpers';

const count = (sql: string) => query<{ n: number }>(sql)[0].n;

// Items per domain as seeded from the former CSVs (SAF has none).
const ITEMS_PER_DOMAIN: Record<string, number> = {
  BIO: 11, CHM: 34, COM: 22, EMR: 25, ETH: 6, GEN: 29, INF: 95, MCB: 42, MLD: 43, QMS: 44,
  RES: 31, SAC: 12, SAF: 0, SCT: 6, SDR: 8, SEC: 17, SHC: 21, SPH: 21, SRV: 22, WFT: 22,
};

describe('assessment catalogue seeding from the bundled workbook', () => {
  beforeAll(initTestDb);

  it('matches the former CSV seeding on a fresh database', async () => {
    await seedAssessments();
    expect(count('SELECT COUNT(*) AS n FROM assessment_domains')).toBe(20);
    expect(count('SELECT COUNT(*) AS n FROM assessment_items')).toBe(511);
    expect(count('SELECT COUNT(*) AS n FROM assessment_footnotes')).toBe(1);

    const perDomain = Object.fromEntries(query<{ code: string; n: number }>(
      `SELECT d.code, COUNT(i.id) AS n FROM assessment_domains d
       LEFT JOIN assessment_items i ON i.domain_id = d.id GROUP BY d.code`,
    ).map((r) => [r.code, r.n]));
    expect(perDomain).toEqual(ITEMS_PER_DOMAIN);

    expect(query('SELECT code FROM assessment_domains WHERE version <> 1')).toEqual([]);
    expect(query(
      `SELECT i.subcompetency_value, i.subcompetency_text, i.sort_order FROM assessment_items i
       JOIN assessment_domains d ON d.id = i.domain_id WHERE d.code = 'SAC' ORDER BY i.sort_order LIMIT 1`,
    )).toEqual([{ subcompetency_value: '1.01', subcompetency_text: 'Safety program', sort_order: 0 }]);
    // Text-formatted cells keep codes like 1.10 intact.
    expect(count("SELECT COUNT(*) AS n FROM assessment_items WHERE subcompetency_value LIKE '%.10'")).toBeGreaterThan(0);
    // sort_order is 0..n-1 within every domain.
    expect(query(
      `SELECT domain_id FROM assessment_items GROUP BY domain_id
       HAVING MIN(sort_order) <> 0 OR MAX(sort_order) <> COUNT(*) - 1`,
    )).toEqual([]);
    expect(query("SELECT purpose IS NOT NULL AS p, introduction IS NOT NULL AS i FROM assessment_domains WHERE code = 'INF'"))
      .toEqual([{ p: 1, i: 1 }]);
    expect(query(
      `SELECT f.symbol, f.definition, f.sort_order FROM assessment_footnotes f
       JOIN assessment_domains d ON d.id = f.domain_id WHERE d.code = 'INF'`,
    )).toEqual([{ symbol: '*', definition: 'This term is defined in Appendix B.', sort_order: 1 }]);
  });

  it('is insert-only on restart and never overwrites edits', async () => {
    execute("UPDATE assessment_domains SET name = 'Edited' WHERE code = 'QMS'");
    execute('DELETE FROM assessment_footnotes');
    await seedAssessments();
    expect(query("SELECT name FROM assessment_domains WHERE code = 'QMS'")).toEqual([{ name: 'Edited' }]);
    expect(count('SELECT COUNT(*) AS n FROM assessment_domains')).toBe(20);
    expect(count('SELECT COUNT(*) AS n FROM assessment_items')).toBe(511);
    // INF had no footnotes any more, so its footnote is inserted again.
    expect(count('SELECT COUNT(*) AS n FROM assessment_footnotes')).toBe(1);
  });
});
```

- [ ] **Step 5: Remove the CSVs and the script, then see the test fail**

```bash
git rm apps/api/seed-data/assessment_data.csv apps/api/seed-data/footnotes.csv apps/api/seed-data/assessments/*.csv apps/api/src/scripts/build-catalogue-workbook.ts
```

`apps/api/seed-data/appendix_b.csv` must still exist afterwards (`ls apps/api/seed-data` → `appendix_b.csv  assessment-catalogue.xlsx`).

Run: `pnpm --filter @workforce-competency/api test -- seed-assessments`
Expected: FAIL — 0 domains (the CSV seeder finds no CSVs).

- [ ] **Step 6: Rewrite the startup loader**

Replace the whole of `apps/api/src/db/seed-assessments.ts` with:

```ts
import fs from 'fs';
import path from 'path';
import { query, execute, transaction } from './database';
import { CAT_TAB, ParsedCatalogue, readCatalogueWorkbook, usableRows } from '../lib/workbook/catalogue';
import type { SheetRow } from '../lib/workbook/reader';

/**
 * Seeds the assessment catalogue — domains, competency items and footnotes —
 * from the workbook bundled at `seed-data/assessment-catalogue.xlsx`, so a
 * fresh install already has the full catalogue.
 *
 * Seeding is additive and never destructive. A domain is inserted only when
 * its code is absent, its items only when it has none, and its footnotes only
 * when it has none. Restarting a populated instance is therefore a no-op, and
 * content edited through the admin UI is never overwritten. Admins push
 * updated content with the catalogue workbook import on the Assessments page.
 */

// dist/db/ and src/db/ sit at the same depth, so this resolves in both the
// compiled and the ts-node/nodemon case.
const SEED_DIR = path.resolve(
  process.env.SEED_DATA_PATH ?? path.join(__dirname, '../../seed-data'),
);
export const CATALOGUE_FILE = 'assessment-catalogue.xlsx';

function domainIdOf(code: string): number | null {
  const [row] = query<{ id: number }>('SELECT id FROM assessment_domains WHERE code = ? COLLATE NOCASE', [code]);
  return row?.id ?? null;
}

function countFor(table: 'assessment_items' | 'assessment_footnotes', domainId: number): number {
  return query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE domain_id = ?`, [domainId])[0].n;
}

/** Rows grouped by upper-cased domain_code, in sheet order. */
function groupByDomain(rows: SheetRow[]): Map<string, SheetRow[]> {
  const out = new Map<string, SheetRow[]>();
  for (const r of rows) {
    const code = r.values.domain_code.toUpperCase();
    out.set(code, [...(out.get(code) ?? []), r]);
  }
  return out;
}

/** Insert-only seeding from a parsed catalogue workbook. Call inside a transaction. */
export function seedCatalogue(parsed: ParsedCatalogue): { domains: number; items: number; footnotes: number } {
  let domains = 0;
  let items = 0;
  let footnotes = 0;

  for (const r of usableRows(parsed[CAT_TAB.domains])) {
    const code = r.values.domain_code.toUpperCase();
    if (domainIdOf(code) !== null) continue;
    const version = Number(r.values.version);
    execute(
      'INSERT INTO assessment_domains (code, name, version, purpose, introduction) VALUES (?, ?, ?, ?, ?)',
      [code, r.values.domain_name, Number.isInteger(version) && version > 0 ? version : 1,
       r.values.purpose || null, r.values.introduction || null],
    );
    domains++;
  }

  for (const [code, rows] of groupByDomain(usableRows(parsed[CAT_TAB.items]))) {
    const domain = domainIdOf(code);
    if (domain === null) {
      console.warn(`[seed:assessments] items for unknown domain '${code}' — skipped`);
      continue;
    }
    if (countFor('assessment_items', domain) > 0) continue; // already populated — leave it alone
    rows.forEach((r, i) => {
      const v = r.values;
      execute(
        `INSERT INTO assessment_items
           (domain_id, competency_value, competency_text, subcompetency_value, subcompetency_text,
            beginner, competent, proficient, expert, na, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [domain, v.competency_value, v.competency_text, v.subcompetency_value, v.subcompetency_text,
         v.beginner, v.competent, v.proficient, v.expert, v.na, i],
      );
      items++;
    });
  }

  for (const [code, rows] of groupByDomain(usableRows(parsed[CAT_TAB.footnotes]))) {
    const domain = domainIdOf(code);
    if (domain === null) {
      console.warn(`[seed:assessments] footnotes for unknown domain '${code}' — skipped`);
      continue;
    }
    if (countFor('assessment_footnotes', domain) > 0) continue;
    rows.forEach((r, i) => {
      const raw = r.values.sort_order;
      const sort = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : i;
      execute(
        'INSERT INTO assessment_footnotes (domain_id, symbol, definition, sort_order) VALUES (?, ?, ?, ?)',
        [domain, r.values.symbol, r.values.definition, sort],
      );
      footnotes++;
    });
  }

  return { domains, items, footnotes };
}

export async function seedAssessments(): Promise<void> {
  const file = path.join(SEED_DIR, CATALOGUE_FILE);
  if (!fs.existsSync(file)) {
    console.warn(`[seed:assessments] ${file} not found — nothing seeded`);
    return;
  }
  const parsed = await readCatalogueWorkbook(fs.readFileSync(file));
  for (const [name, tab] of Object.entries(parsed)) {
    if (tab && tab.errors.length) {
      console.warn(`[seed:assessments] ${name}: ${tab.errors.length} problem(s) in the bundled workbook — those rows skipped`);
    }
  }

  // One transaction for the whole catalogue: sql.js serialises the entire
  // database to disk on every write made outside a transaction.
  const counts = transaction(() => seedCatalogue(parsed));
  if (counts.domains + counts.items + counts.footnotes === 0) {
    console.log('[seed:assessments] already up-to-date');
    return;
  }
  console.log(
    `[seed:assessments] seeded ${counts.domains} domain(s), ${counts.items} item(s), ${counts.footnotes} footnote(s)`,
  );
}
```

In `apps/api/src/server.ts` replace the line `  seedAssessments();` with:

```ts
  await seedAssessments();
```

In `apps/api/Dockerfile` replace the comment line `# Assessment catalogue CSVs, seeded into an empty database on first start.` with:

```dockerfile
# Assessment catalogue workbook, seeded into an empty database on first start.
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `pnpm --filter @workforce-competency/api test -- seed-assessments`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/api test`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/api typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/seed-assessments.ts apps/api/src/server.ts apps/api/Dockerfile apps/api/test/seed-assessments.test.ts
git commit -m "feat(api): seed the assessment catalogue from the bundled workbook"
```

---

### Task 7: Archived rows in admin lists and reports

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (CRUD `LIST` handler ~line 69; facilities `GET /` ~line 201), `apps/api/src/routes/admin-districts.ts` (`GET /` ~line 28), `apps/api/src/routes/reports.ts` (national/region/district/facility queries, `undistricted_facilities`, the three `suppressSmallGroups(scope, items)` call sites)
- Create: `apps/web/src/lib/reports/archived.ts`, `apps/web/src/lib/reports/archived.test.ts`
- Modify: `apps/web/src/types/reports.ts` (`MaturityCounts`), `apps/web/src/components/reports/levels/{National,Region,District,Facility}Report.tsx`, `apps/web/src/lib/reports/export-excel.ts`, `apps/web/src/lib/reports/export-pdf.ts`
- Test: `apps/api/test/archived.test.ts` (create)

**Interfaces:**
- Consumes: `archived_at` (Task 2); helpers `createOrgRole`, `createTitle` (Task 1).
- Produces: `GET /admin/{regions,districts,facilities,departments,org-roles,user-titles}` return active rows unless `?include_archived=1` (rows carry `archived_at`); report items may carry `archived: true` (never `archived_at`); web `archivedLabel(name: string, archived?: boolean): string`; `MaturityCounts.archived?: boolean`.

- [ ] **Step 1: Write the failing API tests**

Create `apps/api/test/archived.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { execute } from '../src/db/database';
import {
  initTestDb, resetDb, testApp, asUser, createUser, createRegion, createDistrict, createFacility, createDepartment,
  createOrgRole, createTitle, addResponse,
} from './helpers';

const app = testApp();
const archive = (table: string, id: number) =>
  execute(`UPDATE ${table} SET archived_at = datetime('now') WHERE id = ?`, [id]);

describe('archived organisation rows', () => {
  let admin: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
  });
  const get = (path: string) => request(app).get(path).set(asUser(admin));

  it('hides archived rows from admin lists unless include_archived=1', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    archive('regions', createRegion('OLD', 'Old Region'));
    const tmk = createDistrict('TMK', 'Temeke', dsm);
    archive('districts', createDistrict('OLDD', 'Old District', dsm));
    createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    archive('facilities', createFacility('F9', 'Closed Clinic', { regionId: dsm, districtId: tmk }));
    createDepartment('LAB', 'Laboratory');
    archive('departments', createDepartment('OLDP', 'Old Department'));
    createOrgRole('MLS', 'Scientist');
    archive('org_roles', createOrgRole('OLDR', 'Old Role'));
    createTitle('DR', 'Dr.');
    archive('user_titles', createTitle('OLDT', 'Old Title'));

    const cases: [string, string, string, string][] = [
      ['/admin/regions', 'regions', 'DSM', 'OLD'],
      ['/admin/districts', 'districts', 'TMK', 'OLDD'],
      ['/admin/facilities', 'facilities', 'F1', 'F9'],
      ['/admin/departments', 'departments', 'LAB', 'OLDP'],
      ['/admin/org-roles', 'org_roles', 'MLS', 'OLDR'],
      ['/admin/user-titles', 'user_titles', 'DR', 'OLDT'],
    ];
    for (const [path, key, active, archived] of cases) {
      const codes = async (url: string) => ((await get(url)).body[key] as { code: string }[]).map((r) => r.code).sort();
      expect(await codes(path)).toEqual([active]);
      expect(await codes(`${path}?include_archived=1`)).toEqual([active, archived].sort());
    }
    // Facility counts on districts ignore archived facilities.
    expect((await get('/admin/districts')).body.districts[0].facility_count).toBe(1);
  });

  it('lists an archived report child only when it has respondents, flagged archived', async () => {
    const dsm = createRegion('DSM', 'Dar es Salaam');
    const oldRegion = createRegion('OLDR', 'Old Region');
    const emptyRegion = createRegion('EMPR', 'Empty Region');
    const tmk = createDistrict('TMK', 'Temeke', dsm);
    const oldDistrict = createDistrict('OLDD', 'Old District', dsm);
    const emptyDistrict = createDistrict('EMPD', 'Empty District', dsm);
    const f1 = createFacility('F1', 'Temeke Hospital', { regionId: dsm, districtId: tmk });
    const oldFacility = createFacility('F8', 'Old Clinic', { regionId: dsm, districtId: tmk });
    const emptyFacility = createFacility('F9', 'Empty Clinic', { regionId: dsm, districtId: tmk });
    const lab = createDepartment('LAB', 'Laboratory', [f1]);
    const mic = createDepartment('MIC', 'Microbiology');      // archived, no longer linked, has history at F1
    const xry = createDepartment('XRY', 'X-Ray', [f1]);       // archived, still linked, no responses

    const respond = (o: { facilityId?: number; regionId?: number; districtId?: number; departmentId?: number }) =>
      addResponse({ userId: createUser(), ...o });
    respond({ facilityId: f1, regionId: dsm, districtId: tmk, departmentId: lab });
    respond({ facilityId: f1, regionId: dsm, districtId: tmk, departmentId: mic });
    respond({ facilityId: oldFacility, regionId: dsm, districtId: tmk });
    respond({ regionId: dsm, districtId: oldDistrict });
    respond({ regionId: oldRegion });

    archive('regions', oldRegion);
    archive('regions', emptyRegion);
    archive('districts', oldDistrict);
    archive('districts', emptyDistrict);
    archive('facilities', oldFacility);
    archive('facilities', emptyFacility);
    archive('departments', mic);
    archive('departments', xry);

    const rows = (items: Record<string, unknown>[], key: string) => items.map((i) => [i[key], i.archived ?? false]);

    const national = await get('/reports/national');
    expect(rows(national.body.items, 'region_name')).toEqual([['Dar es Salaam', false], ['Old Region', true]]);
    expect(national.body.items[0]).not.toHaveProperty('archived_at');

    const region = await get(`/reports/regions/${dsm}`);
    expect(rows(region.body.items, 'district_name')).toEqual([['Old District', true], ['Temeke', false]]);

    const district = await get(`/reports/districts/${tmk}`);
    expect(rows(district.body.items, 'facility_name')).toEqual([['Old Clinic', true], ['Temeke Hospital', false]]);

    const facility = await get(`/reports/facilities/${f1}`);
    expect(rows(facility.body.items, 'department_name')).toEqual([['Laboratory', false], ['Microbiology', true]]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workforce-competency/api test -- archived`
Expected: FAIL — archived codes still listed; report items have no `archived` flag and include empty archived rows.

- [ ] **Step 3: Filter the admin lists**

In `apps/api/src/routes/admin.ts`, directly above the line `// ── Generic CRUD factory ───…` insert:

```ts
// ── Archived rows ─────────────────────────────────────────────────────────────
// Lists (and so every picker) show active rows; ?include_archived=1 adds the
// archived ones for the Setup tables' "Show archived" toggle.

const includeArchived = (req: Request) =>
  req.query.include_archived === '1' || req.query.include_archived === 'true';

```

Replace the CRUD list handler:

```ts
  // LIST
  r.get('/', (_req, res: Response, next: NextFunction) => {
    try {
      res.json({ [table]: query(`SELECT * FROM ${table} ORDER BY name ASC`) });
    } catch (err) { next(err); }
  });
```

with:

```ts
  // LIST — active rows unless ?include_archived=1
  r.get('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const where = includeArchived(req) ? '' : 'WHERE archived_at IS NULL';
      res.json({ [table]: query(`SELECT * FROM ${table} ${where} ORDER BY name ASC`) });
    } catch (err) { next(err); }
  });
```

Replace the facilities list handler (from `facilitiesRouter.get('/', (_req, res: Response, next: NextFunction) => {` through its closing `});`) with:

```ts
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
```

In `apps/api/src/routes/admin-districts.ts`, replace the list handler (from `router.get('/', (_req, res: Response, next: NextFunction) => {` through its closing `});`) with:

```ts
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
```

- [ ] **Step 4: Archived children in reports**

In `apps/api/src/routes/reports.ts`, insert directly above the line `function meta(`:

```ts
// ── Archived children ─────────────────────────────────────────────────────────
// An archived region/district/facility/department stays in a list only while
// it has respondents in the current view, flagged `archived: true` so the UI
// can label it. `archived_at` itself is not sent.
function withArchived(items: Record<string, unknown>[]): Record<string, unknown>[] {
  return items.flatMap((item) => {
    const { archived_at: archivedAt, ...rest } = item;
    if (archivedAt === null || archivedAt === undefined) return [rest];
    return Number(rest.respondents ?? 0) > 0 ? [{ ...rest, archived: true }] : [];
  });
}

```

National — replace:

```ts
      `SELECT r.id AS region_id, r.name AS region_name, ${COUNTS_SELECT}
       FROM regions r
       LEFT JOIN user_assessment_responses uar ON uar.region_id = r.id${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       GROUP BY r.id, r.name
       ORDER BY r.name`,
```

with:

```ts
      `SELECT r.id AS region_id, r.name AS region_name, r.archived_at, ${COUNTS_SELECT}
       FROM regions r
       LEFT JOIN user_assessment_responses uar ON uar.region_id = r.id${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       GROUP BY r.id, r.name, r.archived_at
       ORDER BY r.name`,
```

and in the national `res.json(...)` replace `level: 'national', items, meta:` with `level: 'national', items: withArchived(items), meta:`.

Region — replace:

```ts
      `SELECT d.id AS district_id, d.name AS district_name, ${COUNTS_SELECT}
       FROM districts d
       LEFT JOIN user_assessment_responses uar
              ON uar.district_id = d.id AND uar.region_id = d.region_id${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       WHERE d.region_id = ?
       GROUP BY d.id, d.name
       ORDER BY d.name`,
```

with:

```ts
      `SELECT d.id AS district_id, d.name AS district_name, d.archived_at, ${COUNTS_SELECT}
       FROM districts d
       LEFT JOIN user_assessment_responses uar
              ON uar.district_id = d.id AND uar.region_id = d.region_id${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       WHERE d.region_id = ?
       GROUP BY d.id, d.name, d.archived_at
       ORDER BY d.name`,
```

and replace `'SELECT id, name FROM facilities WHERE region_id = ? AND district_id IS NULL ORDER BY name'` with `'SELECT id, name FROM facilities WHERE region_id = ? AND district_id IS NULL AND archived_at IS NULL ORDER BY name'`.

District — replace:

```ts
      `SELECT fa.id AS facility_id, fa.name AS facility_name, ${COUNTS_SELECT}
       FROM facilities fa
       LEFT JOIN user_assessment_responses uar
              ON uar.facility_id = fa.id${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       WHERE fa.district_id = ?
       GROUP BY fa.id, fa.name
       ORDER BY fa.name`,
```

with:

```ts
      `SELECT fa.id AS facility_id, fa.name AS facility_name, fa.archived_at, ${COUNTS_SELECT}
       FROM facilities fa
       LEFT JOIN user_assessment_responses uar
              ON uar.facility_id = fa.id${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       WHERE fa.district_id = ?
       GROUP BY fa.id, fa.name, fa.archived_at
       ORDER BY fa.name`,
```

Facility — replace:

```ts
    // INNER JOIN facility_departments ensures we list every dept owned by the
    // facility (even empty ones); LEFT JOIN responses so zero-response depts stay.
    const items = query(
      `SELECT d.id AS department_id, d.name AS department_name, ${COUNTS_SELECT}
       FROM departments d
       INNER JOIN facility_departments fd ON fd.department_id = d.id AND fd.facility_id = ?
       LEFT JOIN user_assessment_responses uar
              ON uar.department_id = d.id AND uar.facility_id = ?${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       GROUP BY d.id, d.name
       ORDER BY d.name`,
      [facilityId, facilityId, ...on.params],
    );
```

with:

```ts
    // Every department linked to the facility (even empty ones), plus archived
    // departments — linked or not — that still have responses here (withArchived
    // drops the empty archived ones). LEFT JOIN responses keeps zero-response rows.
    const items = query(
      `SELECT d.id AS department_id, d.name AS department_name, d.archived_at, ${COUNTS_SELECT}
       FROM departments d
       LEFT JOIN facility_departments fd ON fd.department_id = d.id AND fd.facility_id = ?
       LEFT JOIN user_assessment_responses uar
              ON uar.department_id = d.id AND uar.facility_id = ?${on.sql}
       LEFT JOIN user_assessments ua ON ua.id = uar.user_assessment_id${uaOnFilter(f)}
       WHERE fd.facility_id IS NOT NULL OR d.archived_at IS NOT NULL
       GROUP BY d.id, d.name, d.archived_at
       ORDER BY d.name`,
      [facilityId, facilityId, ...on.params],
    );
```

Finally replace every occurrence (three: region, district, facility) of `items: suppressSmallGroups(scope, items)` with `items: suppressSmallGroups(scope, withArchived(items))` — archived rows are resolved before partner suppression looks at the list.

- [ ] **Step 5: Run the API tests**

Run: `pnpm --filter @workforce-competency/api test`
Expected: PASS (including `archived`, `reports-small-groups`, `reports-districts`, `reports-departments`).
Run: `pnpm --filter @workforce-competency/api typecheck`
Expected: no errors.

- [ ] **Step 6: Write the failing web test**

Create `apps/web/src/lib/reports/archived.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { archivedLabel } from "./archived";

describe("archivedLabel", () => {
  it("labels archived rows and leaves active rows alone", () => {
    expect(archivedLabel("Temeke", true)).toBe("Temeke (archived)");
    expect(archivedLabel("Temeke", false)).toBe("Temeke");
    expect(archivedLabel("Temeke")).toBe("Temeke");
  });
});
```

Run: `pnpm --filter @workforce-competency/web test -- archived`
Expected: FAIL — cannot resolve `./archived`.

- [ ] **Step 7: Implement the web label**

Create `apps/web/src/lib/reports/archived.ts`:

```ts
// Report rows for archived regions/districts/facilities/departments stay
// visible while they have respondents; the label says they are archived.
export function archivedLabel(name: string, archived?: boolean): string {
  return archived ? `${name} (archived)` : name;
}
```

In `apps/web/src/types/reports.ts`, inside `MaturityCounts`, after the `suppressed?: …;` line add:

```ts
  // An archived region/district/facility/department listed because it still
  // has respondents in this view. Absent on active rows.
  archived?: boolean;
```

In each of `NationalReport.tsx`, `RegionReport.tsx`, `DistrictReport.tsx`, `FacilityReport.tsx` (`apps/web/src/components/reports/levels/`), after the line `import { UnassignedBanner } from '../UnassignedBanner';` add:

```ts
import { archivedLabel } from '@/lib/reports/archived';
```

then replace every occurrence (two per file — chart data and table rows):

| File | Replace | With |
|---|---|---|
| `NationalReport.tsx` | `label: r.region_name,` | `label: archivedLabel(r.region_name, r.archived),` |
| `RegionReport.tsx` | `label: r.district_name,` | `label: archivedLabel(r.district_name, r.archived),` |
| `DistrictReport.tsx` | `label: r.facility_name,` | `label: archivedLabel(r.facility_name, r.archived),` |
| `FacilityReport.tsx` | `label: r.department_name,` | `label: archivedLabel(r.department_name, r.archived),` |

In `apps/web/src/lib/reports/export-excel.ts`, after `import type { AnyReport, MaturityCounts } from '@/types/reports';` add `import { archivedLabel } from './archived';` and replace:

| Replace | With |
|---|---|
| `Region: i.region_name,` | `Region: archivedLabel(i.region_name, i.archived),` |
| `District: i.district_name,` | `District: archivedLabel(i.district_name, i.archived),` |
| `Facility: i.facility_name,` | `Facility: archivedLabel(i.facility_name, i.archived),` |
| `Department: i.department_name,` | `Department: archivedLabel(i.department_name, i.archived),` |

In `apps/web/src/lib/reports/export-pdf.ts`, after `import type { AnyReport, MaturityCounts } from '@/types/reports';` add `import { archivedLabel } from './archived';` and replace:

| Replace | With |
|---|---|
| `i.region_name, ...countCells(i),` | `archivedLabel(i.region_name, i.archived), ...countCells(i),` |
| `i.district_name, ...countCells(i),` | `archivedLabel(i.district_name, i.archived), ...countCells(i),` |
| `i.facility_name, ...countCells(i),` | `archivedLabel(i.facility_name, i.archived), ...countCells(i),` |
| `i.department_name, ...countCells(i),` | `archivedLabel(i.department_name, i.archived), ...countCells(i),` |

- [ ] **Step 8: Run the web checks**

Run: `pnpm --filter @workforce-competency/web test`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/web typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin-districts.ts apps/api/src/routes/reports.ts apps/api/test/archived.test.ts apps/web/src/lib/reports/archived.ts apps/web/src/lib/reports/archived.test.ts apps/web/src/types/reports.ts apps/web/src/components/reports/levels apps/web/src/lib/reports/export-excel.ts apps/web/src/lib/reports/export-pdf.ts
git commit -m "feat: hide archived rows from admin lists and label archived report rows"
```

---

### Task 8: Web — binary API helpers, plan helpers and the import dialog

**Files:**
- Modify: `apps/web/src/lib/api.ts` (full replacement below)
- Create: `apps/web/src/lib/import/plan.ts`, `apps/web/src/lib/import/plan.test.ts`, `apps/web/src/components/import/ImportWorkbookDialog.tsx`

**Interfaces:**
- Consumes: API response shapes from Tasks 4–5 — preview `{ plan: ImportPlan }`, apply `{ plan: ImportPlan; credentials: ImportCredential[] }`; 409 on a stale fingerprint, 413 above 10 MB.
- Produces:
  - `lib/api.ts`: unchanged `api`, plus `XLSX_MIME`, `type ApiResponse<T>`, `type BinaryResponse<T> = ApiResponse<T> & { status: number }`, `postWorkbook<T>(path: string, file: Blob): Promise<BinaryResponse<T>>`, `saveBlob(blob: Blob, filename: string): void`, `downloadFile(path: string, filename: string): Promise<string | null>` (error message or null).
  - `lib/import/plan.ts`: types `ChangeKind`, `FieldChange`, `PlanChange`, `PlanError`, `TabCounts`, `TabPlan`, `ImportPlan`, `ImportCredential { name; email; username; temp_password }`, `ApplyResult { plan; credentials }`, `Tone`, `PlanSection`, `SheetError`; functions `planSections(plan): PlanSection[]`, `allErrors(plan): SheetError[]`, `needsConfirmation(c): boolean`, `confirmationSentence(c): string`, `hasMajorityWarning(plan): boolean`, `formatValue(v: unknown): string`, `rowLabel(row: number | null): string`, `credentialRows(creds): Record<string, string>[]`, `applySummary(plan): string`; const `KIND_LABEL`, `MAJORITY_MARKER`.
  - `components/import/ImportWorkbookDialog.tsx`: `ImportWorkbookDialog({ open, onClose, title, hint, previewPath, applyPath, onApplied })` — upload → preview → (confirm) → apply → result with one-time credentials download.

- [ ] **Step 1: Write the failing helper tests**

Create `apps/web/src/lib/import/plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  planSections, allErrors, needsConfirmation, confirmationSentence, hasMajorityWarning, formatValue, rowLabel,
  credentialRows, applySummary, type ImportPlan, type TabPlan,
} from "./plan";

const counts = (over: Partial<TabPlan["counts"]> = {}): TabPlan["counts"] => ({
  added: 0, updated: 0, restored: 0, archived: 0, deleted: 0, disabled: 0, unchanged: 0, ...over,
});
const tab = (over: Partial<TabPlan>): TabPlan => ({
  tab: "Regions", present: true, counts: counts(), changes: [], errors: [], warnings: [], ...over,
});
const plan = (tabs: TabPlan[], over: Partial<ImportPlan> = {}): ImportPlan => ({
  fingerprint: "f", tabs, canApply: true, confirmations: { archived: 0, deleted: 0, disabledUsers: 0 }, ...over,
});

describe("planSections", () => {
  it("pins tabs with errors first, keeps the others in order and builds count badges", () => {
    const sections = planSections(plan([
      tab({ tab: "Regions", counts: counts({ added: 2, unchanged: 3 }) }),
      tab({ tab: "Districts", errors: [{ row: 9, column: "region_code", message: "b" }, { row: 3, column: null, message: "a" }] }),
      tab({ tab: "Users", counts: counts({ disabled: 1 }), warnings: ["1 user is not in the Users tab and will be disabled."] }),
    ]));
    expect(sections.map((s) => s.tab)).toEqual(["Districts", "Regions", "Users"]);
    expect(sections[0].errors.map((e) => e.row)).toEqual([3, 9]);
    expect(sections[0].defaultOpen).toBe(true);
    expect(sections[1].badges).toEqual([{ label: "added", count: 2, tone: "add" }]);
    expect(sections[1].unchanged).toBe(3);
    expect(sections[1].defaultOpen).toBe(false);
    expect(sections[2].badges).toEqual([{ label: "disabled", count: 1, tone: "remove" }]);
    expect(sections[2].defaultOpen).toBe(true);
  });
});

describe("allErrors", () => {
  it("lists every error with its sheet, in tab order then row order", () => {
    const errors = allErrors(plan([
      tab({ tab: "Regions", errors: [{ row: 5, column: "region_name", message: "x" }, { row: 2, column: null, message: "y" }] }),
      tab({ tab: "Users", errors: [{ row: 0, column: "email", message: "z" }] }),
    ]));
    expect(errors.map((e) => [e.tab, e.row])).toEqual([["Regions", 2], ["Regions", 5], ["Users", 0]]);
  });
});

describe("confirmation", () => {
  it("is needed only when something is archived, deleted or disabled", () => {
    expect(needsConfirmation({ archived: 0, deleted: 0, disabledUsers: 0 })).toBe(false);
    expect(needsConfirmation({ archived: 0, deleted: 1, disabledUsers: 0 })).toBe(true);
    expect(needsConfirmation({ archived: 0, deleted: 0, disabledUsers: 2 })).toBe(true);
  });

  it("states the numbers with singular and plural forms", () => {
    expect(confirmationSentence({ archived: 2, deleted: 1, disabledUsers: 1 }))
      .toBe("I understand this will archive 2 items, delete 1, and disable 1 user");
    expect(confirmationSentence({ archived: 1, deleted: 0, disabledUsers: 3 }))
      .toBe("I understand this will archive 1 item, delete 0, and disable 3 users");
  });
});

describe("hasMajorityWarning", () => {
  it("spots the more-than-half warning on any tab", () => {
    expect(hasMajorityWarning(plan([tab({ warnings: ["1 user is not in the Users tab and will be disabled."] })]))).toBe(false);
    expect(hasMajorityWarning(plan([
      tab({ warnings: ["3 of 4 existing regions would be archived or deleted — this usually means the wrong file."] }),
    ]))).toBe(true);
  });
});

describe("formatting", () => {
  it("shows empty values and missing rows explicitly", () => {
    expect(formatValue("")).toBe("(empty)");
    expect(formatValue(null)).toBe("(empty)");
    expect(formatValue("DSM")).toBe("DSM");
    expect(formatValue(3)).toBe("3");
    expect(rowLabel(null)).toBe("—");
    expect(rowLabel(0)).toBe("—");
    expect(rowLabel(7)).toBe("row 7");
  });

  it("builds credential rows for the download", () => {
    expect(credentialRows([{ name: "Amina Hassan", email: "a@x.test", username: "amina.hassan", temp_password: "Tmp123" }]))
      .toEqual([{ Name: "Amina Hassan", Email: "a@x.test", Username: "amina.hassan", "Temporary password": "Tmp123" }]);
  });

  it("summarises what was applied", () => {
    expect(applySummary(plan([
      tab({ counts: counts({ added: 2, archived: 1 }) }),
      tab({ tab: "Users", counts: counts({ added: 1, disabled: 2 }) }),
    ]))).toBe("Applied: 3 added, 1 archived, 2 disabled.");
    expect(applySummary(plan([tab({ counts: counts({ unchanged: 4 }) })]))).toBe("No changes were needed.");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workforce-competency/web test -- import/plan`
Expected: FAIL — cannot resolve `./plan`.

- [ ] **Step 3: Implement the plan helpers**

Create `apps/web/src/lib/import/plan.ts`:

```ts
// Shapes and pure helpers for the workbook import preview (country setup and
// assessment catalogue). Keep in sync with apps/api/src/lib/workbook/plan.ts.

export type ChangeKind = "add" | "update" | "restore" | "archive" | "delete" | "disable";

export interface FieldChange { field: string; from: unknown; to: unknown }
export interface PlanChange { row: number | null; key: string; kind: ChangeKind; fields?: FieldChange[] }
export interface PlanError { row: number; column: string | null; message: string }
export interface TabCounts {
  added: number; updated: number; restored: number; archived: number; deleted: number; disabled: number; unchanged: number;
}
export interface TabPlan {
  tab: string;
  present: boolean;
  counts: TabCounts;
  changes: PlanChange[];
  errors: PlanError[];
  warnings: string[];
}
export interface ImportPlan {
  fingerprint: string;
  tabs: TabPlan[];
  canApply: boolean;
  confirmations: { archived: number; deleted: number; disabledUsers: number };
}
export interface ImportCredential { name: string; email: string; username: string; temp_password: string }
export interface ApplyResult { plan: ImportPlan; credentials: ImportCredential[] }

export const KIND_LABEL: Record<ChangeKind, string> = {
  add: "Add", update: "Update", restore: "Restore", archive: "Archive", delete: "Delete", disable: "Disable",
};

/** Text the API puts in every "more than half removed" warning. */
export const MAJORITY_MARKER = "usually means the wrong file";

export type Tone = "add" | "update" | "restore" | "remove";

const BADGES: { key: keyof TabCounts; label: string; tone: Tone }[] = [
  { key: "added", label: "added", tone: "add" },
  { key: "updated", label: "updated", tone: "update" },
  { key: "restored", label: "restored", tone: "restore" },
  { key: "archived", label: "archived", tone: "remove" },
  { key: "deleted", label: "deleted", tone: "remove" },
  { key: "disabled", label: "disabled", tone: "remove" },
];

export interface PlanSection {
  tab: string;
  present: boolean;
  badges: { label: string; count: number; tone: Tone }[];
  unchanged: number;
  changes: PlanChange[];
  errors: PlanError[];
  warnings: string[];
  defaultOpen: boolean;
}

const byRow = (a: PlanError, b: PlanError) => a.row - b.row;

/** One section per tab; tabs with errors first, each error list sorted by row. */
export function planSections(plan: ImportPlan): PlanSection[] {
  const sections = plan.tabs.map((t) => ({
    tab: t.tab,
    present: t.present,
    badges: BADGES.filter((b) => t.counts[b.key] > 0).map((b) => ({ label: b.label, count: t.counts[b.key], tone: b.tone })),
    unchanged: t.counts.unchanged,
    changes: t.changes,
    errors: [...t.errors].sort(byRow),
    warnings: t.warnings,
    defaultOpen: t.errors.length > 0 || t.warnings.length > 0,
  }));
  return [...sections.filter((s) => s.errors.length > 0), ...sections.filter((s) => s.errors.length === 0)];
}

export interface SheetError extends PlanError { tab: string }

/** Every error with its sheet name — pinned at the top of the preview. */
export function allErrors(plan: ImportPlan): SheetError[] {
  return plan.tabs.flatMap((t) => [...t.errors].sort(byRow).map((e) => ({ ...e, tab: t.tab })));
}

export function needsConfirmation(c: ImportPlan["confirmations"]): boolean {
  return c.archived + c.deleted + c.disabledUsers > 0;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function confirmationSentence(c: ImportPlan["confirmations"]): string {
  return `I understand this will archive ${plural(c.archived, "item", "items")}, delete ${c.deleted}, `
    + `and disable ${plural(c.disabledUsers, "user", "users")}`;
}

export function hasMajorityWarning(plan: ImportPlan): boolean {
  return plan.tabs.some((t) => t.warnings.some((w) => w.includes(MAJORITY_MARKER)));
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  return String(v);
}

/** Row 0 / null means "not a spreadsheet row" (e.g. something the workbook no longer lists). */
export function rowLabel(row: number | null): string {
  return row ? `row ${row}` : "—";
}

export function credentialRows(creds: ImportCredential[]): Record<string, string>[] {
  return creds.map((c) => ({ Name: c.name, Email: c.email, Username: c.username, "Temporary password": c.temp_password }));
}

export function applySummary(plan: ImportPlan): string {
  const total = (key: keyof TabCounts) => plan.tabs.reduce((n, t) => n + t.counts[key], 0);
  const parts = BADGES.map((b) => [b.label, total(b.key)] as const).filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`);
  return parts.length ? `Applied: ${parts.join(", ")}.` : "No changes were needed.";
}
```

- [ ] **Step 4: Run the helper tests**

Run: `pnpm --filter @workforce-competency/web test -- import/plan`
Expected: PASS.

- [ ] **Step 5: Binary upload/download helpers**

Replace the whole of `apps/web/src/lib/api.ts` with:

```ts
const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api/v1';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type ApiResponse<T> = { data: T; error: null } | { data: null; error: string };
export type BinaryResponse<T> = ApiResponse<T> & { status: number };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: 'include', // always send session cookie
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return { data: null, error: (json as { error?: string })?.error ?? res.statusText };
    }

    return { data: json as T, error: null };
  } catch {
    return { data: null, error: 'Network error. Please check your connection.' };
  }
}

export const api = {
  get:    <T>(path: string)                    => request<T>(path),
  post:   <T>(path: string, body: unknown)     => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown)     => request<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T>(path: string)                    => request<T>(path, { method: 'DELETE' }),
};

// ── Workbooks (binary bodies) ────────────────────────────────────────────────

async function errorMessage(res: Response): Promise<string> {
  if (res.status === 413) return 'The file is larger than 10 MB.';
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  return json?.error ?? res.statusText;
}

/** POST an .xlsx file as the raw request body; the response is JSON. */
export async function postWorkbook<T>(path: string, file: Blob): Promise<BinaryResponse<T>> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': XLSX_MIME },
      body: file,
    });
    if (!res.ok) return { data: null, error: await errorMessage(res), status: res.status };
    return { data: (await res.json()) as T, error: null, status: res.status };
  } catch {
    return { data: null, error: 'Network error. Please check your connection.', status: 0 };
  }
}

/** Hand a Blob to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** GET a file (e.g. a workbook export) and download it. Returns an error message, or null. */
export async function downloadFile(path: string, filename: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { credentials: 'include' });
    if (!res.ok) return await errorMessage(res);
    saveBlob(await res.blob(), filename);
    return null;
  } catch {
    return 'Network error. Please check your connection.';
  }
}
```

- [ ] **Step 6: The shared import dialog**

Create `apps/web/src/components/import/ImportWorkbookDialog.tsx`:

```tsx
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { AlertTriangle, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { postWorkbook, XLSX_MIME } from "@/lib/api";
import {
  KIND_LABEL, allErrors, applySummary, confirmationSentence, credentialRows, formatValue, hasMajorityWarning,
  needsConfirmation, planSections, rowLabel, type ApplyResult, type ImportCredential, type ImportPlan, type Tone,
} from "@/lib/import/plan";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TONE_CLASS: Record<Tone, string> = {
  add: "border-transparent bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
  update: "border-transparent bg-sky-600/15 text-sky-700 dark:text-sky-400",
  restore: "border-transparent bg-violet-600/15 text-violet-700 dark:text-violet-400",
  remove: "border-transparent bg-amber-600/15 text-amber-700 dark:text-amber-400",
};

function downloadCredentials(creds: ImportCredential[]) {
  const ws = XLSX.utils.json_to_sheet(credentialRows(creds));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Credentials");
  XLSX.writeFile(wb, "new-user-credentials.xlsx");
}

// ── Dialog ────────────────────────────────────────────────────────────────────

interface ImportWorkbookDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  hint: ReactNode;
  previewPath: string;
  applyPath: string;
  onApplied: () => void;
}

type Step = "upload" | "preview" | "done";

export function ImportWorkbookDialog({
  open, onClose, title, hint, previewPath, applyPath, onApplied,
}: ImportWorkbookDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  function reset() {
    setStep("upload");
    setFile(null);
    setPlan(null);
    setConfirmed(false);
    setResult(null);
    setLoading(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function preview(f: File) {
    setLoading(true);
    const res = await postWorkbook<{ plan: ImportPlan }>(previewPath, f);
    setLoading(false);
    if (res.error !== null) {
      toast.error(res.error);
      return;
    }
    setPlan(res.data.plan);
    setConfirmed(false);
    setStep("preview");
  }

  async function apply() {
    if (!file || !plan) return;
    setLoading(true);
    const res = await postWorkbook<ApplyResult>(`${applyPath}?fingerprint=${encodeURIComponent(plan.fingerprint)}`, file);
    setLoading(false);
    if (res.error !== null) {
      toast.error(res.error);
      if (res.status === 409) await preview(file); // data moved on: show the fresh plan
      return;
    }
    setResult(res.data);
    setStep("done");
    onApplied();
  }

  const confirmNeeded = plan ? needsConfirmation(plan.confirmations) : false;
  const errors = plan ? allErrors(plan) : [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <form
            className="flex flex-col gap-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (file) void preview(file);
              else toast.error("Select an .xlsx workbook first.");
            }}
          >
            <div className="text-sm text-muted-foreground">{hint}</div>
            <Input
              type="file"
              accept={`.xlsx,${XLSX_MIME}`}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" disabled={loading || !file}>{loading ? "Checking…" : "Preview changes"}</Button>
            </DialogFooter>
          </form>
        )}

        {step === "preview" && plan && (
          <>
            <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
              {hasMajorityWarning(plan) && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Check this is the right file</AlertTitle>
                  <AlertDescription>
                    More than half of the existing rows on at least one tab would be removed. This usually means the wrong file.
                  </AlertDescription>
                </Alert>
              )}

              {errors.length > 0 && (
                <div className="rounded-md border border-destructive/40">
                  <p className="px-3 py-2 text-sm font-medium text-destructive">
                    {errors.length} error{errors.length === 1 ? "" : "s"} — fix the workbook and upload it again. Nothing has been changed.
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Sheet</TableHead>
                        <TableHead className="text-xs">Row</TableHead>
                        <TableHead className="text-xs">Column</TableHead>
                        <TableHead className="text-xs">Problem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {errors.map((e, i) => (
                        <TableRow key={`${e.tab}-${e.row}-${i}`}>
                          <TableCell className="text-xs">{e.tab}</TableCell>
                          <TableCell className="text-xs font-mono">{rowLabel(e.row)}</TableCell>
                          <TableCell className="text-xs font-mono">{e.column ?? "—"}</TableCell>
                          <TableCell className="text-xs">{e.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {planSections(plan).map((s) => (
                <Collapsible key={s.tab} defaultOpen={s.defaultOpen} className="rounded-md border">
                  <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium">
                    <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
                    <span>{s.tab}</span>
                    {!s.present && <span className="text-xs font-normal text-muted-foreground">not in workbook — unchanged</span>}
                    {s.errors.length > 0 && (
                      <Badge variant="destructive">{s.errors.length} error{s.errors.length === 1 ? "" : "s"}</Badge>
                    )}
                    <span className="flex-1" />
                    {s.badges.map((b) => (
                      <Badge key={b.label} variant="outline" className={TONE_CLASS[b.tone]}>{b.count} {b.label}</Badge>
                    ))}
                    {s.present && s.unchanged > 0 && (
                      <span className="text-xs font-normal text-muted-foreground">{s.unchanged} unchanged</span>
                    )}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="flex flex-col gap-2 border-t px-3 py-2">
                    {s.warnings.map((w) => (
                      <p key={w} className="text-xs text-amber-700 dark:text-amber-400">{w}</p>
                    ))}
                    {s.changes.length === 0 && s.errors.length === 0 && (
                      <p className="text-xs text-muted-foreground">{s.present ? "No changes." : "This tab is not in the workbook, so nothing changes."}</p>
                    )}
                    {s.changes.length > 0 && (
                      <ul className="flex flex-col gap-1.5">
                        {s.changes.map((c, i) => (
                          <li key={`${c.key}-${i}`} className="text-xs">
                            <span className="font-medium">{KIND_LABEL[c.kind]}</span>{" "}
                            <span className="font-mono">{c.key}</span>{" "}
                            <span className="text-muted-foreground">({rowLabel(c.row)})</span>
                            {c.fields && c.fields.length > 0 && (
                              <ul className="ml-4 mt-0.5 text-muted-foreground">
                                {c.fields.map((f) => (
                                  <li key={f.field}>
                                    <span className="font-mono">{f.field}</span>: {formatValue(f.from)} → {formatValue(f.to)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>

            {plan.canApply && confirmNeeded && (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
                <span>{confirmationSentence(plan.confirmations)}</span>
              </label>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>Choose another file</Button>
              <Button
                type="button"
                disabled={!plan.canApply || loading || (confirmNeeded && !confirmed)}
                onClick={() => void apply()}
              >
                {loading ? "Applying…" : "Apply changes"}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "done" && result && (
          <>
            <div className="flex-1 overflow-y-auto flex flex-col gap-3">
              <p className="text-sm">{applySummary(result.plan)}</p>
              {result.credentials.length > 0 && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {result.credentials.length} new user{result.credentials.length === 1 ? " was" : "s were"} created.
                    Download their temporary passwords now — this list is shown only once. Each user must change the
                    password at first login.
                  </p>
                  <div className="max-h-64 overflow-y-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">Email</TableHead>
                          <TableHead className="text-xs">Username</TableHead>
                          <TableHead className="text-xs">Temporary password</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.credentials.map((c) => (
                          <TableRow key={c.email}>
                            <TableCell className="text-xs">{c.name}</TableCell>
                            <TableCell className="text-xs">{c.email}</TableCell>
                            <TableCell className="text-xs font-mono">{c.username}</TableCell>
                            <TableCell className="text-xs font-mono">{c.temp_password}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              {result.credentials.length > 0 && (
                <Button variant="outline" onClick={() => downloadCredentials(result.credentials)}>Download credentials</Button>
              )}
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: Run the web checks**

Run: `pnpm --filter @workforce-competency/web test`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/web typecheck`
Expected: no errors (the dialog is not used yet; that is fine — it is exported).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/import apps/web/src/components/import
git commit -m "feat(web): workbook import dialog with change preview"
```

---

### Task 9: Web — Setup page (Export / Import workbook, Get started, Show archived)

**Files:**
- Create: `apps/web/src/lib/setup/archived.ts`, `apps/web/src/lib/setup/archived.test.ts`
- Modify: `apps/web/src/pages/SetupPage.tsx` (imports lines 1–52; types lines 56–59; `SimpleTableTab` lines 113–301 replaced; `FacilitiesTab` edits; lines 599–714 replaced), `apps/web/src/components/setup/DistrictsTab.tsx`, `apps/web/src/lib/setup/districts.ts` (`District.archived_at`)

**Interfaces:**
- Consumes: `ImportWorkbookDialog` (Task 8), `downloadFile` (Task 8), `?include_archived=1` and `archived_at` on admin lists (Task 7), `GET /admin/setup/export`, `POST /admin/setup/import/{preview,apply}` (Task 4), sample workbook URL `data/sample-country-setup.xlsx` (created in Task 11; the link 404s until then).
- Produces: `listPath(path: string, includeArchived: boolean): string`, `listKey(base: string[], includeArchived: boolean): string[]`, `isArchived(row: { archived_at?: string | null }): boolean` in `lib/setup/archived.ts`.

- [ ] **Step 1: Write the failing helper test**

Create `apps/web/src/lib/setup/archived.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { listPath, listKey, isArchived } from "./archived";

describe("archived list helpers", () => {
  it("asks the API for archived rows only when the toggle is on", () => {
    expect(listPath("/admin/regions", false)).toBe("/admin/regions");
    expect(listPath("/admin/regions", true)).toBe("/admin/regions?include_archived=1");
  });

  it("keeps the active-only query key shared with the pickers", () => {
    expect(listKey(["admin", "regions"], false)).toEqual(["admin", "regions"]);
    expect(listKey(["admin", "regions"], true)).toEqual(["admin", "regions", "with-archived"]);
  });

  it("recognises archived rows", () => {
    expect(isArchived({ archived_at: "2026-10-06 10:00:00" })).toBe(true);
    expect(isArchived({ archived_at: null })).toBe(false);
    expect(isArchived({})).toBe(false);
  });
});
```

Run: `pnpm --filter @workforce-competency/web test -- setup/archived`
Expected: FAIL — cannot resolve `./archived`.

- [ ] **Step 2: Implement the helpers**

Create `apps/web/src/lib/setup/archived.ts`:

```ts
// Setup tables show active rows by default; "Show archived" adds the rest.
// The active-only list keeps the plain query key, which the pickers share.

export function listPath(path: string, includeArchived: boolean): string {
  return includeArchived ? `${path}?include_archived=1` : path;
}

export function listKey(base: string[], includeArchived: boolean): string[] {
  return includeArchived ? [...base, "with-archived"] : base;
}

export function isArchived(row: { archived_at?: string | null }): boolean {
  return Boolean(row.archived_at);
}
```

Run: `pnpm --filter @workforce-competency/web test -- setup/archived`
Expected: PASS.

In `apps/web/src/lib/setup/districts.ts`, inside `interface District`, after `facility_count: number;` add:

```ts
  archived_at?: string | null;
```

- [ ] **Step 3: SetupPage imports and types**

In `apps/web/src/pages/SetupPage.tsx`:

Replace `import { Plus, Pencil, Trash2, FileUp, Search } from "lucide-react";` with:

```tsx
import { Plus, Pencil, Trash2, FileUp, Search, Download } from "lucide-react";
```

After `import { Label } from "@/components/ui/label";` add:

```tsx
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
```

Replace `import { api } from "@/lib/api";` with `import { api, downloadFile } from "@/lib/api";`.

Replace `import { ImportDialog } from "@/components/setup/ImportDialog";` with:

```tsx
import { ImportWorkbookDialog } from "@/components/import/ImportWorkbookDialog";
import { listKey, listPath, isArchived } from "@/lib/setup/archived";
```

Replace the `Facility` interface line with:

```tsx
interface Facility   { id: number; code: string; name: string; facility_type: string | null; region_id: number | null; region_name: string | null; district_id: number | null; district_name: string | null; department_ids: number[]; archived_at?: string | null; }
interface SimpleRow  { id: number; code: string; name: string; archived_at?: string | null; }
```

- [ ] **Step 4: Replace `SimpleTableTab`**

Replace everything from the line `// ── Generic table + toolbar for simple code/name tables ───…` down to (not including) `// ── Facilities tab (more complex — region + departments) ───…` with:

```tsx
// ── Generic table + toolbar for simple code/name tables ───────────────────────

interface SimpleTableTabProps<T extends SimpleRow> {
  queryKey: string[];
  fetchFn: (includeArchived: boolean) => Promise<T[]>;
  createFn: (code: string, name: string) => Promise<void>;
  updateFn: (id: number, code: string, name: string) => Promise<void>;
  deleteFn: (id: number) => Promise<void>;
  sheetTitle: (editing: T | null) => string;
  columns?: { header: string; accessor: keyof T }[];
}

function SimpleTableTab<T extends SimpleRow>({
  queryKey, fetchFn, createFn, updateFn, deleteFn, sheetTitle, columns,
}: SimpleTableTabProps<T>) {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const { data: rows = [] } = useQuery({
    queryKey: listKey(queryKey, showArchived),
    queryFn: () => fetchFn(showArchived),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey });
  const archivedId = `show-archived-${queryKey.join("-")}`;

  // Shared pagination + search state — these lists can grow on larger deployments.
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const filtered = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      String(r.code).toLowerCase().includes(q) ||
      String(r.name).toLowerCase().includes(q),
    );
  }, [rows, searchInput]);
  const paged = useMemo(
    () => filtered.slice(page * pageSize, (page + 1) * pageSize),
    [filtered, page, pageSize],
  );
  useEffect(() => { setPage(0); }, [searchInput, rows.length]);

  const cols = columns ?? [
    { header: "Code", accessor: "code" as keyof T },
    { header: "Name", accessor: "name" as keyof T },
  ];

  async function handleSubmit(code: string, name: string) {
    if (editing) {
      await updateFn(editing.id, code, name);
      toast.success("Updated.");
    } else {
      await createFn(code, name);
      toast.success("Created.");
    }
    invalidate();
  }

  async function handleDelete() {
    if (deleteId === null) return;
    const res = await deleteFn(deleteId);
    if ((res as unknown as { error: string | null })?.error) { toast.error((res as unknown as { error: string }).error); return; }
    toast.success("Deleted.");
    invalidate();
    setDeleteId(null);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b">
        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search code or name…"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Switch id={archivedId} checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor={archivedId} className="text-xs text-muted-foreground">Show archived</Label>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { setEditing(null); setSheetOpen(true); }}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              {cols.map((c) => (
                <TableHead key={String(c.accessor)} className="text-xs uppercase tracking-wide">
                  {c.header}
                </TableHead>
              ))}
              <TableHead className="w-20 text-right text-xs uppercase tracking-wide">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={cols.length + 1} className="py-8 text-center text-muted-foreground">
                  {rows.length === 0 ? "No records yet." : "No records match your search."}
                </TableCell>
              </TableRow>
            ) : paged.map((row) => (
              <TableRow
                key={row.id}
                className={`cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]${isArchived(row) ? " opacity-60" : ""}`}
                onClick={() => { setEditing(row); setSheetOpen(true); }}
              >
                {cols.map((c) => (
                  <TableCell
                    key={String(c.accessor)}
                    className={c.accessor === "code" ? "font-mono text-xs text-muted-foreground" : "text-sm"}
                  >
                    {String(row[c.accessor] ?? "")}
                    {c.accessor === "name" && isArchived(row) && (
                      <Badge variant="outline" className="ml-2 text-[10px]">Archived</Badge>
                    )}
                  </TableCell>
                ))}
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => { setEditing(row); setSheetOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(row.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            <TableFillerRow colSpan={cols.length + 1} show={paged.length > 0} />
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
            {filtered.length} record{filtered.length === 1 ? "" : "s"}
            {searchInput && ` · filtered from ${rows.length}`}
          </span>
        }
      />

      <CodeNameSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={sheetTitle(editing)}
        initial={editing}
        onSubmit={handleSubmit}
      />
      <AlertDialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this record?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

```

- [ ] **Step 5: FacilitiesTab — Show archived instead of Import CSV**

In `FacilitiesTab`:

Replace `  const [importOpen, setImportOpen] = useState(false);` with:

```tsx
  const [showArchived, setShowArchived] = useState(false);
```

Replace the facilities query:

```tsx
  const { data: facilities = [] } = useQuery({
    queryKey: ["admin", "facilities"],
    queryFn: async () => {
      const res = await api.get<{ facilities: Facility[] }>("/admin/facilities");
      if (res.error !== null) throw new Error(res.error);
      return res.data.facilities;
    },
  });
```

with:

```tsx
  const { data: facilities = [] } = useQuery({
    queryKey: listKey(["admin", "facilities"], showArchived),
    queryFn: async () => {
      const res = await api.get<{ facilities: Facility[] }>(listPath("/admin/facilities", showArchived));
      if (res.error !== null) throw new Error(res.error);
      return res.data.facilities;
    },
  });
```

Replace the toolbar button:

```tsx
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setImportOpen(true)}>
          <FileUp className="h-3.5 w-3.5" /> Import CSV
        </Button>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openSheet(null)}>
```

with:

```tsx
        <div className="flex items-center gap-2">
          <Switch id="show-archived-facilities" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show-archived-facilities" className="text-xs text-muted-foreground">Show archived</Label>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openSheet(null)}>
```

Replace the facility row opening and name cell:

```tsx
              <TableRow
                key={f.id}
                className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                onClick={() => openSheet(f)}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">{f.code}</TableCell>
                <TableCell className="text-sm">{f.name}</TableCell>
```

with:

```tsx
              <TableRow
                key={f.id}
                className={`cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]${isArchived(f) ? " opacity-60" : ""}`}
                onClick={() => openSheet(f)}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">{f.code}</TableCell>
                <TableCell className="text-sm">
                  {f.name}
                  {isArchived(f) && <Badge variant="outline" className="ml-2 text-[10px]">Archived</Badge>}
                </TableCell>
```

Delete this block (the facilities CSV dialog):

```tsx
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/admin/facilities/import"
        hint="Required columns: facility_code, facility_name, district_code. Optional: facility_type, region_code (must match the district). Existing codes get their district updated."
        onImported={invalidate}
      />
```

- [ ] **Step 6: Replace the bottom of the page (helpers, Get started, page)**

Replace everything from the line `// ── Helpers for simple tabs ───…` to the end of the file with:

```tsx
// ── Helpers for simple tabs ───────────────────────────────────────────────────

function makeSimpleFns(path: string) {
  return {
    fetchFn: async (includeArchived: boolean) => {
      const res = await api.get<{ [key: string]: unknown[] }>(listPath(`/admin/${path}`, includeArchived));
      if (res.error !== null) throw new Error(res.error);
      const key = Object.keys(res.data)[0];
      return res.data[key] as SimpleRow[];
    },
    createFn: async (code: string, name: string) => {
      const res = await api.post(`/admin/${path}`, { code, name });
      if (res.error !== null) throw new Error(res.error as string);
    },
    updateFn: async (id: number, code: string, name: string) => {
      const res = await api.put(`/admin/${path}/${id}`, { code, name });
      if (res.error !== null) throw new Error(res.error as string);
    },
    deleteFn: async (id: number) => {
      return api.delete(`/admin/${path}/${id}`);
    },
  };
}

// ── Get started (no regions yet) ──────────────────────────────────────────────

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || "/";

function GetStartedCard({ onExport, onImport, onManual }: { onExport: () => void; onImport: () => void; onManual: () => void }) {
  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-8">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Get started</CardTitle>
          <CardDescription>
            Load your regions, districts, facilities, departments, roles, titles and users from one Excel workbook.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 text-sm">
          <ol className="flex list-decimal flex-col gap-5 pl-5">
            <li>
              <p className="font-medium">Export the template</p>
              <p className="text-muted-foreground">An empty workbook with every tab and column, plus a Read me tab.</p>
              <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={onExport}>
                <Download className="h-3.5 w-3.5" /> Export template
              </Button>
            </li>
            <li>
              <p className="font-medium">Fill it in</p>
              <p className="text-muted-foreground">
                One row per item. Keep your own admin account on the Users tab. See the{" "}
                <a className="underline" href={`${baseUrl}data/sample-country-setup.xlsx`} download>sample workbook</a>{" "}
                for an example.
              </p>
            </li>
            <li>
              <p className="font-medium">Import the workbook</p>
              <p className="text-muted-foreground">You will see every change before anything is saved.</p>
              <Button size="sm" className="mt-2 gap-1.5" onClick={onImport}>
                <FileUp className="h-3.5 w-3.5" /> Import workbook
              </Button>
            </li>
          </ol>
          <button type="button" className="self-start text-xs text-muted-foreground underline" onClick={onManual}>
            Or add records by hand
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const regionsFns    = makeSimpleFns("regions");
const deptsFns      = makeSimpleFns("departments");
const orgRolesFns   = makeSimpleFns("org-roles");
const titlesFns     = makeSimpleFns("user-titles");

const SETUP_IMPORT_HINT = (
  <>
    Upload a country setup workbook (.xlsx, up to 10 MB). Each tab you include is the complete list: rows missing
    from a tab are archived (or deleted when they have no history) and users missing from Users are disabled.
    Leave a tab out to keep that data unchanged. Nothing is saved until you review the changes and apply them.
  </>
);

export default function SetupPage() {
  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [manual, setManual] = useState(false);

  const { data: regions, isLoading } = useQuery({
    queryKey: ["admin", "regions"],
    queryFn: () => regionsFns.fetchFn(false),
  });
  const showGetStarted = !manual && !isLoading && (regions ?? []).length === 0;

  async function exportSetup() {
    const error = await downloadFile("/admin/setup/export", "country-setup.xlsx");
    if (error) toast.error(error);
  }

  const nav = (
    <div className="flex w-full items-center gap-2 pr-2">
      <h1 className="font-bold text-sm">Setup</h1>
      <div className="flex-1" />
      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void exportSetup()}>
        <Download className="h-3.5 w-3.5" /> Export setup
      </Button>
      <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setImportOpen(true)}>
        <FileUp className="h-3.5 w-3.5" /> Import workbook
      </Button>
    </div>
  );

  return (
    <ContentLayout nav={nav}>
      <div className="flex flex-col min-h-[calc(100vh-26px-56px)] max-h-[calc(100vh-26px-56px)] w-full">
        {showGetStarted ? (
          <GetStartedCard
            onExport={() => void exportSetup()}
            onImport={() => setImportOpen(true)}
            onManual={() => setManual(true)}
          />
        ) : (
          <Tabs defaultValue="regions" className="flex flex-col flex-1 overflow-hidden">
            <div className="border-b px-4">
              <TabsList className="h-10 bg-transparent p-0 gap-2">
                {["regions", "districts", "facilities", "departments", "roles", "titles"].map((tab) => (
                  <TabsTrigger
                    key={tab}
                    value={tab}
                    className="capitalize rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 h-10"
                  >
                    {tab === "roles" ? "Org Roles" : tab === "titles" ? "Job Titles" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto">
              <TabsContent value="regions" className="h-full mt-0">
                <SimpleTableTab
                  queryKey={["admin", "regions"]}
                  fetchFn={regionsFns.fetchFn}
                  createFn={regionsFns.createFn}
                  updateFn={regionsFns.updateFn}
                  deleteFn={regionsFns.deleteFn}
                  sheetTitle={(e) => e ? "Edit Region" : "New Region"}
                />
              </TabsContent>

              <TabsContent value="districts" className="h-full mt-0">
                <DistrictsTab />
              </TabsContent>

              <TabsContent value="facilities" className="h-full mt-0">
                <FacilitiesTab />
              </TabsContent>

              <TabsContent value="departments" className="h-full mt-0">
                <SimpleTableTab
                  queryKey={["admin", "departments"]}
                  fetchFn={deptsFns.fetchFn}
                  createFn={deptsFns.createFn}
                  updateFn={deptsFns.updateFn}
                  deleteFn={deptsFns.deleteFn}
                  sheetTitle={(e) => e ? "Edit Department" : "New Department"}
                />
              </TabsContent>

              <TabsContent value="roles" className="h-full mt-0">
                <SimpleTableTab
                  queryKey={["admin", "org-roles"]}
                  fetchFn={orgRolesFns.fetchFn}
                  createFn={orgRolesFns.createFn}
                  updateFn={orgRolesFns.updateFn}
                  deleteFn={orgRolesFns.deleteFn}
                  sheetTitle={(e) => e ? "Edit Role" : "New Role"}
                />
              </TabsContent>

              <TabsContent value="titles" className="h-full mt-0">
                <SimpleTableTab
                  queryKey={["admin", "user-titles"]}
                  fetchFn={titlesFns.fetchFn}
                  createFn={titlesFns.createFn}
                  updateFn={titlesFns.updateFn}
                  deleteFn={titlesFns.deleteFn}
                  sheetTitle={(e) => e ? "Edit Title" : "New Title"}
                />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </div>

      <ImportWorkbookDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import country setup"
        hint={SETUP_IMPORT_HINT}
        previewPath="/admin/setup/import/preview"
        applyPath="/admin/setup/import/apply"
        onApplied={() => qc.invalidateQueries({ queryKey: ["admin"] })}
      />
    </ContentLayout>
  );
}
```

`makeSimpleFns(...).deleteFn` returns the API response while the prop is typed `Promise<void>` — that is unchanged from before (the existing `handleDelete` cast reads its `error`).

- [ ] **Step 7: DistrictsTab — Show archived instead of Import CSV**

In `apps/web/src/components/setup/DistrictsTab.tsx`:

Replace `import { Plus, Pencil, Trash2, FileUp, Search } from "lucide-react";` with `import { Plus, Pencil, Trash2, Search } from "lucide-react";`.

After `import { Label } from "@/components/ui/label";` add:

```tsx
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
```

Replace `import { ImportDialog } from "./ImportDialog";` with:

```tsx
import { listKey, listPath, isArchived } from "@/lib/setup/archived";
```

Replace `  const [importOpen, setImportOpen] = useState(false);` with `  const [showArchived, setShowArchived] = useState(false);`.

Replace the districts query:

```tsx
  const { data: districts = [] } = useQuery({
    queryKey: ["admin", "districts"],
    queryFn: async () => {
      const res = await api.get<{ districts: District[] }>("/admin/districts");
```

with:

```tsx
  const { data: districts = [] } = useQuery({
    queryKey: listKey(["admin", "districts"], showArchived),
    queryFn: async () => {
      const res = await api.get<{ districts: District[] }>(listPath("/admin/districts", showArchived));
```

Replace the toolbar button:

```tsx
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setImportOpen(true)}>
          <FileUp className="h-3.5 w-3.5" /> Import CSV
        </Button>
```

with:

```tsx
        <div className="flex items-center gap-2">
          <Switch id="show-archived-districts" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show-archived-districts" className="text-xs text-muted-foreground">Show archived</Label>
        </div>
```

Replace the district row opening and name cell:

```tsx
              <TableRow
                key={d.id}
                className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                onClick={() => openSheet(d)}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">{d.code}</TableCell>
                <TableCell className="text-sm">{d.name}</TableCell>
```

with:

```tsx
              <TableRow
                key={d.id}
                className={`cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]${isArchived(d) ? " opacity-60" : ""}`}
                onClick={() => openSheet(d)}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">{d.code}</TableCell>
                <TableCell className="text-sm">
                  {d.name}
                  {isArchived(d) && <Badge variant="outline" className="ml-2 text-[10px]">Archived</Badge>}
                </TableCell>
```

Delete the districts CSV dialog block:

```tsx
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/admin/districts/import"
        hint="Required columns: district_code, district_name, region_code."
        onImported={invalidate}
      />

```

- [ ] **Step 8: Run the web checks**

Run: `pnpm --filter @workforce-competency/web test`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/web typecheck`
Expected: no errors (in particular no unused `FileUp`/`ImportDialog` imports in `DistrictsTab.tsx`; `SetupPage.tsx` still uses `FileUp` for the Import buttons).
Run: `pnpm --filter @workforce-competency/web build`
Expected: build succeeds.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/setup apps/web/src/pages/SetupPage.tsx apps/web/src/components/setup/DistrictsTab.tsx
git commit -m "feat(web): Setup page workbook export/import, Get started and Show archived"
```

---

### Task 10: Web — Users page link to Setup, Assessments page catalogue workbook

**Files:**
- Modify: `apps/web/src/pages/UsersPage.tsx` (imports lines 1–66; `ImportCredential` ~line 120; Helpers ~lines 125–134; Import + Credentials dialogs ~lines 485–620; page state, toolbar and JSX)
- Modify: `apps/web/src/pages/AssessmentsPage.tsx` (imports lines 1–75; Helpers ~lines 105–114; three import dialogs ~lines 254–581; page state, menus and JSX)

**Interfaces:**
- Consumes: `ImportWorkbookDialog`, `downloadFile` (Task 8); `GET /assessments/catalogue/export`, `POST /assessments/catalogue/import/{preview,apply}` (Task 5); the Setup page route `${baseUrl}setup`.
- Produces: no new exports. After this task no web code calls a `…/import` CSV endpoint.

- [ ] **Step 1: Users page — remove the CSV import**

In `apps/web/src/pages/UsersPage.tsx`:

Replace `import { useEffect, useMemo, useRef, useState } from "react";` with:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
```

Delete the dialog import block:

```tsx
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
```

After the line `import { useAuthStore } from "@/store/auth";` add:

```tsx

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || "/";
```

Delete the `ImportCredential` interface:

```tsx
interface ImportCredential {
  user_name: string;
  temp_password: string;
}
```

Delete the `// ── Helpers ───…` heading and the `readFileAsText` function below it (everything up to, not including, `// ── Temp password cell ───…`).

Delete everything from the line `// ── Import dialog ───…` down to (not including) the line `// ── Reset password confirmation ───…` — this removes `ImportResult`, `ImportDialogProps`, `ImportDialog` and `CredentialsDialog`.

In `UsersPage()`, delete these two state lines:

```tsx
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
```

Replace the toolbar button:

```tsx
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setImportOpen(true)}
          >
            <FileUp className="h-3.5 w-3.5" /> Import CSV
          </Button>
```

with:

```tsx
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
            <Link to={`${baseUrl}setup`} title="Bulk-import users with the country setup workbook">
              <FileUp className="h-3.5 w-3.5" /> Bulk import on Setup
            </Link>
          </Button>
```

Replace the empty-table text `"No users yet. Add one or import a CSV."` with `"No users yet. Add one, or bulk-import users with the workbook on the Setup page."`.

Delete the two dialogs at the end of the page JSX:

```tsx
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(result) => {
          setImportResult(result);
          invalidate();
        }}
      />

      <CredentialsDialog
        result={importResult}
        onClose={() => setImportResult(null)}
      />

```

- [ ] **Step 2: Assessments page — replace the CSV dialogs**

In `apps/web/src/pages/AssessmentsPage.tsx`:

Replace `import { useEffect, useMemo, useRef, useState } from "react";` with `import { useEffect, useMemo, useState } from "react";`.

In the `lucide-react` import list replace `  Upload,` with `  Download,` (keep `FileUp`).

In the `@/components/ui/dropdown-menu` import list delete the three lines `  DropdownMenuSub,`, `  DropdownMenuSubContent,`, `  DropdownMenuSubTrigger,`.

Delete the dialog import block:

```tsx
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
```

Replace `import { api } from "@/lib/api";` with:

```tsx
import { api, downloadFile } from "@/lib/api";
import { ImportWorkbookDialog } from "@/components/import/ImportWorkbookDialog";
```

Delete the `// ── Helpers ───…` heading and `readFileAsText` (everything up to, not including, `// ── Domain form dialog ───…`).

Delete everything from `// ── Import domains CSV dialog ───…` down to (not including) `// ── Item form dialog ───…`.

Delete everything from `// ── Import items CSV dialog ───…` down to (not including) `// ── Main page ───…` (this removes `ImportItemsDialog` and `ImportFootnotesDialog`).

In `AssessmentsPage()`:

Delete `  const [importDomainsOpen, setImportDomainsOpen] = useState(false);`, `  const [importItemsOpen, setImportItemsOpen] = useState(false);` and `  const [importFootnotesOpen, setImportFootnotesOpen] = useState(false);`, and after `  const [deleteItemId, setDeleteItemId] = useState<number | null>(null);` add:

```tsx
  const [importCatalogueOpen, setImportCatalogueOpen] = useState(false);

  async function exportCatalogue() {
    const error = await downloadFile("/assessments/catalogue/export", "assessment-catalogue.xlsx");
    if (error) toast.error(error);
  }
```

Replace the Import submenu in the domain options menu:

```tsx
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Upload className="h-4 w-4" /> Import
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem
                          onClick={() => setImportDomainsOpen(true)}
                        >
                          Domains
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setImportFootnotesOpen(true)}
                        >
                          Footnotes
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
```

with:

```tsx
                    <DropdownMenuItem onClick={() => void exportCatalogue()}>
                      <Download className="h-4 w-4" /> Export catalogue
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setImportCatalogueOpen(true)}>
                      <FileUp className="h-4 w-4" /> Import catalogue
                    </DropdownMenuItem>
```

In the item options menu delete:

```tsx
            <DropdownMenuItem onClick={() => setImportItemsOpen(true)}>
              <FileUp className="h-4 w-4" /> Import Items
            </DropdownMenuItem>
```

Replace `` `No items yet.${isAdmin ? ' Use "Add Item" or "Import Items" to add competencies.' : ''}` `` with `` `No items yet.${isAdmin ? ' Use "Add Item", or "Import catalogue" in the domain menu, to add competencies.' : ''}` ``.

Replace the two domain-level import dialogs:

```tsx
      <ImportDomainsDialog
        open={importDomainsOpen}
        onClose={() => setImportDomainsOpen(false)}
        onImported={() =>
          qc.invalidateQueries({ queryKey: ["assessments", "domains"] })
        }
      />
      <ImportFootnotesDialog
        open={importFootnotesOpen}
        onClose={() => setImportFootnotesOpen(false)}
        onImported={() =>
          // A batch import can touch many domains' footnotes; bust all survey
          // model queries so re-opened surveys pick up the new footnotes.
          qc.invalidateQueries({ queryKey: ["assessments"] })
        }
      />
```

with:

```tsx
      <ImportWorkbookDialog
        open={importCatalogueOpen}
        onClose={() => setImportCatalogueOpen(false)}
        title="Import assessment catalogue"
        hint={
          <>
            Upload an assessment catalogue workbook (.xlsx, up to 10 MB) — start from <b>Export catalogue</b>.
            New domains, items and footnotes are added and changed ones updated; nothing is ever removed.
          </>
        }
        previewPath="/assessments/catalogue/import/preview"
        applyPath="/assessments/catalogue/import/apply"
        onApplied={() =>
          // Can touch any domain's items and footnotes; refresh every catalogue query.
          qc.invalidateQueries({ queryKey: ["assessments"] })
        }
      />
```

Delete the items CSV dialog inside the `{selectedDomain && (…)}` fragment:

```tsx
          <ImportItemsDialog
            open={importItemsOpen}
            onClose={() => setImportItemsOpen(false)}
            domainId={selectedDomain.id}
            onImported={() =>
              qc.invalidateQueries({
                queryKey: ["assessments", selectedId, "items"],
              })
            }
          />
```

- [ ] **Step 3: Run the web checks**

Run: `pnpm --filter @workforce-competency/web typecheck`
Expected: no errors (no unused `useRef`, `Dialog*`, `DropdownMenuSub*`, `readFileAsText`, `ImportCredential`).
Run: `pnpm --filter @workforce-competency/web test`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/web build`
Expected: build succeeds.
Run: `git grep -nE "(regions|districts|facilities|departments|org-roles|user-titles|users|domains|items|footnotes)/import" apps/web/src`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/UsersPage.tsx apps/web/src/pages/AssessmentsPage.tsx
git commit -m "feat(web): catalogue workbook on the Assessments page; Users bulk import moves to Setup"
```

---

### Task 11: Remove the CSV path, sample workbook, docs

**Files:**
- Create (temporary): `apps/api/src/scripts/build-sample-setup-workbook.ts` — run once, then deleted in this task
- Create: `apps/web/public/data/sample-country-setup.xlsx` (generated), `apps/api/test/csv-import-removed.test.ts`
- Modify: `apps/api/src/routes/admin.ts`, `apps/api/src/routes/admin-districts.ts`, `apps/api/src/routes/assessments.ts`, `apps/api/test/admin-districts.test.ts`, `apps/api/test/admin-facilities.test.ts`, `apps/web/src/lib/setup/districts.ts`, `apps/web/src/lib/setup/districts.test.ts`
- Delete: `apps/api/src/lib/csv.ts`, `apps/web/src/components/setup/ImportDialog.tsx`, `apps/web/public/data/{departments,districts,facilities,org_roles,regions,user_titles,users}.csv`
- Docs: `apps/web/src/docs/1.0.0/setup.md`, `assessments.md`, `getting-started.md` (full rewrites); `users.md`, `reports.md` (targeted edits)

**Interfaces:**
- Consumes (Tasks 2–4): `SetupSnapshot`, `SnapEntity`, `SnapUser`, `writeSetupWorkbook`, `readSetupWorkbook`, `planSetupImport`; `parseCsv` (script only, then deleted).
- Produces: `sample-country-setup.xlsx` served at `${baseUrl}data/sample-country-setup.xlsx` (linked from the Get started card and `setup.md`). All CSV `/import` endpoints return 404.

- [ ] **Step 1: Generate the sample workbook from the sample CSVs**

Create `apps/api/src/scripts/build-sample-setup-workbook.ts`:

```ts
// One-off conversion: apps/web/public/data/*.csv → apps/web/public/data/sample-country-setup.xlsx.
// The sample needs things the CSVs never had: every facility offers the four
// departments its staff use, users get system_role/status, and the seed admin
// is on the Users tab so importing the sample does not lock that admin out.
// Run once, commit the workbook, then delete this script with the CSVs.

import fs from 'fs';
import path from 'path';
import { parseCsv } from '../lib/csv';
import { SetupSnapshot, SnapEntity, SnapUser } from '../lib/workbook/setup-snapshot';
import { writeSetupWorkbook } from '../lib/workbook/setup-export';
import { readSetupWorkbook } from '../lib/workbook/setup-format';
import { planSetupImport } from '../lib/workbook/setup-planner';

const DATA_DIR = path.resolve(__dirname, '../../../web/public/data');
const OUT = path.join(DATA_DIR, 'sample-country-setup.xlsx');
const SAMPLE_DEPARTMENTS = ['LAB', 'MED', 'NURS', 'PHARM'];

// Mirrors apps/api/src/db/seed.ts.
const SEED_ADMIN: SnapUser = {
  id: 1, email: 'admin@aphl.com', userName: 'admin', firstName: 'National', lastName: 'Administrator',
  nationalId: 'APHL', idType: 'national id', role: 'admin', enabled: true,
  facilityCode: '', departmentCode: '', orgRoleCode: '', titleCode: '', regionCodes: [],
};

function csv(name: string): Record<string, string>[] {
  const { headers, rows } = parseCsv(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const entity = (code: string, name: string): SnapEntity => ({
  id: 0, code: code.toUpperCase(), name, archived: false, hasHistory: false,
});

async function main(): Promise<void> {
  const snap: SetupSnapshot = {
    regions: csv('regions.csv').map((r) => entity(r.region_code, r.region_name)),
    districts: csv('districts.csv').map((r) => ({ ...entity(r.district_code, r.district_name), regionCode: r.region_code.toUpperCase() })),
    departments: csv('departments.csv').map((r) => entity(r.department_code, r.department_name)),
    facilities: csv('facilities.csv').map((r) => ({
      ...entity(r.facility_code, r.facility_name),
      facilityType: r.facility_type,
      districtCode: r.district_code.toUpperCase(),
      departmentCodes: SAMPLE_DEPARTMENTS,
    })),
    orgRoles: csv('org_roles.csv').map((r) => entity(r.role_code, r.role_name)),
    titles: csv('user_titles.csv').map((r) => entity(r.title_code, r.title_name)),
    users: [
      { ...SEED_ADMIN, idType: 'Other', userName: '' },
      ...csv('users.csv').map((r): SnapUser => ({
        id: 0, email: r.email.toLowerCase(), userName: '', firstName: r.first_name, lastName: r.last_name,
        nationalId: r.national_id, idType: r.id_type, role: 'staff', enabled: true,
        facilityCode: r.facility_code.toUpperCase(), departmentCode: r.department_code.toUpperCase(),
        orgRoleCode: r.role_code.toUpperCase(), titleCode: r.title_code.toUpperCase(), regionCodes: [],
      })),
    ],
  };
  const buffer = await writeSetupWorkbook(snap);
  fs.writeFileSync(OUT, buffer);

  // On a fresh install (only the seed admin exists) the sample must preview cleanly.
  const fresh: SetupSnapshot = {
    regions: [], districts: [], departments: [], facilities: [], orgRoles: [], titles: [], users: [SEED_ADMIN],
  };
  const { plan } = planSetupImport(await readSetupWorkbook(buffer), fresh, SEED_ADMIN.id);
  if (!plan.canApply) {
    console.error(JSON.stringify(plan.tabs.flatMap((t) => t.errors.map((e) => ({ tab: t.tab, ...e }))), null, 2));
    process.exit(1);
  }
  console.log(`[sample] wrote ${OUT}: ${plan.tabs.map((t) => `${t.tab} +${t.counts.added}`).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `pnpm --filter @workforce-competency/api exec ts-node --transpile-only src/scripts/build-sample-setup-workbook.ts`
Expected: `[sample] wrote …/apps/web/public/data/sample-country-setup.xlsx: Regions +21, Districts +8, Departments +17, Facilities +12, Org Roles +18, Job Titles +5, Users +8` (the admin row is an update, not an add) and exit code 0.

```bash
git add apps/web/public/data/sample-country-setup.xlsx apps/api/src/scripts/build-sample-setup-workbook.ts
git commit -m "chore: sample country setup workbook converted from the sample CSVs"
```

- [ ] **Step 2: Write the failing removal test**

Create `apps/api/test/csv-import-removed.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { initTestDb, resetDb, testApp, asUser, createUser } from './helpers';

const app = testApp();

describe('the CSV import endpoints are gone', () => {
  let admin: number;

  beforeAll(initTestDb);
  beforeEach(() => {
    resetDb();
    admin = createUser({ role: 'admin' });
  });

  it.each([
    '/admin/regions/import',
    '/admin/districts/import',
    '/admin/departments/import',
    '/admin/facilities/import',
    '/admin/org-roles/import',
    '/admin/user-titles/import',
    '/admin/users/import',
    '/assessments/domains/import',
    '/assessments/domains/1/items/import',
    '/assessments/domains/1/footnotes/import',
    '/assessments/footnotes/import',
  ])('POST %s → 404', async (path) => {
    const res = await request(app).post(path).set(asUser(admin)).send({ csv: 'a,b\n1,2' });
    expect(res.status).toBe(404);
  });
});
```

Run: `pnpm --filter @workforce-competency/api test -- csv-import-removed`
Expected: FAIL — the endpoints still answer (200/400/422).

- [ ] **Step 3: Delete the API CSV endpoints**

In `apps/api/src/routes/admin.ts`:

- Delete the line `import { parseCsv as parseCsvRfc } from '../lib/csv';`.
- Delete the `// ── CSV helpers ───…` heading and the local `parseCsv` function below it (all that is left in that section after Task 4).
- Delete the whole `regionsRouter.post('/import', requireAdmin, …)` handler (from that line through its closing `});`).
- Delete the whole `departmentsRouter.post('/import', requireAdmin, …)` handler.
- Delete the whole `facilitiesRouter.post('/import', requireAdmin, …)` handler.
- Delete the whole `orgRolesRouter.post('/import', requireAdmin, …)` handler.
- Delete the whole `userTitlesRouter.post('/import', requireAdmin, …)` handler.
- Delete the `// ── Personnel bulk import ───…` heading, its two comment lines (`// CSV: first_name,…` and `// Validates ALL rows …`) and the whole `usersRouter.post('/import', requireAdmin, async …)` handler.

`transaction`, `bcrypt`, `generateTempPassword` and `generateUsername` stay in use (user create / reset password).

In `apps/api/src/routes/admin-districts.ts`: delete `import { parseCsv } from '../lib/csv';` and the whole `router.post('/import', requireAdmin, …)` handler.

In `apps/api/src/routes/assessments.ts`: delete `import { parseCsv } from '../lib/csv';` and these four handlers, each from its `router.post(` line (plus the comment lines directly above it) through its closing `});`:
- `router.post('/domains/import', …)`
- `router.post('/domains/:id/items/import', …)`
- `router.post('/domains/:id/footnotes/import', …)` (with the two `// Replace-all import: …` comment lines)
- `router.post('/footnotes/import', …)` (with the four `// Batch footnote import across domains, …` comment lines)

In `apps/api/test/admin-districts.test.ts` delete the tests `it('imports districts from CSV and reports skipped rows with reasons', …)` and `it('rejects an import missing required columns', …)`. In `apps/api/test/admin-facilities.test.ts` delete `it('imports new facilities, updates districts of existing codes, and explains skips', …)` and `it('rejects an import without district_code column', …)`. Every import in both files is still used by the remaining tests.

Delete the files:

```bash
git rm apps/api/src/lib/csv.ts apps/api/src/scripts/build-sample-setup-workbook.ts
git rm apps/web/public/data/departments.csv apps/web/public/data/districts.csv apps/web/public/data/facilities.csv apps/web/public/data/org_roles.csv apps/web/public/data/regions.csv apps/web/public/data/user_titles.csv apps/web/public/data/users.csv
git rm apps/web/src/components/setup/ImportDialog.tsx
```

Run: `pnpm --filter @workforce-competency/api test`
Expected: PASS (including `csv-import-removed`).
Run: `pnpm --filter @workforce-competency/api typecheck`
Expected: no errors (`git grep -n "lib/csv" apps/api/src` finds nothing).

- [ ] **Step 4: Drop the CSV import result helper from the web**

In `apps/web/src/lib/setup/districts.ts` delete the `ImportResult` interface and the `formatImportResult` function (everything after `groupDistrictsByRegion`).

In `apps/web/src/lib/setup/districts.test.ts` change the import line to `import { groupDistrictsByRegion, type District } from "./districts";` and delete the whole `describe("formatImportResult", …)` block.

Run: `pnpm --filter @workforce-competency/web test`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/web typecheck`
Expected: no errors.

- [ ] **Step 5: Rewrite the Setup docs**

Replace the whole of `apps/web/src/docs/1.0.0/setup.md` with:

````markdown
# Setup (admin)

All of the reference data your user directory and reports depend on. **Admin-only.** One tab per reference type, plus a country setup workbook to load or update everything at once.

## Country setup workbook

The quickest way to set up a country — and to keep it up to date — is one Excel workbook.

- **Export setup** (top right) downloads `country-setup.xlsx` with everything that is currently active. On a new system it is the empty template.
- **Import workbook** uploads a filled-in workbook, previews every change, and applies all of it in one go — or nothing.
- A worked example: [sample-country-setup.xlsx](data/sample-country-setup.xlsx). Its first Users row is the built-in admin account; replace it with your own admin account before importing.

When there are no regions yet, the Setup page shows a **Get started** card with three steps: export the template, fill it in, import it.

### Tabs and columns

Required columns are in **bold** (shaded in the exported file). The **Read me** tab explains the rules and is ignored on import.

| Tab | Columns |
|---|---|
| Regions | **region_code**, **region_name** |
| Districts | **district_code**, **district_name**, **region_code** |
| Departments | **department_code**, **department_name** |
| Facilities | **facility_code**, **facility_name**, facility_type, **district_code**, department_codes |
| Org Roles | **role_code**, **role_name** |
| Job Titles | **title_code**, **title_name** |
| Users | **email**, **first_name**, **last_name**, **national_id**, **id_type**, system_role, facility_code, department_code, org_role_code, title_code, region_codes, status, username |

- `department_codes` and `region_codes` take several codes separated by `;`.
- `id_type` is `NRC`, `Passport` or `Other`; `system_role` is `staff` (default), `admin` or `monitor`; `status` is `active` (default) or `disabled`. The exported file offers these as dropdowns.
- `username` is filled in on export and ignored on import.
- A facility's region always comes from its district.

### How an import works

- Codes and emails are matched ignoring upper/lower case. To rename something, keep its code and change the name. Changing a code removes the old item and adds a new one.
- **Every tab you include is the complete list.** Items missing from a tab are **archived** when they have history (survey responses, or — for org roles and titles — users pointing at them) and **deleted** when they have none. Users missing from the Users tab are **disabled**, never deleted.
- **Leave a tab out** of the workbook to keep that kind of data exactly as it is.
- A code that matches an archived item restores it.
- Existing users keep their username and password. New users get a generated username and a temporary password. These are shown once, straight after the import, with a **Download credentials** button; each user must change the password at first login.

### Preview, errors and warnings

The preview has one section per tab with coloured counts (added, updated, restored, archived, deleted, disabled) and every change with its old → new values. Errors are pinned at the top with their sheet, row and column, and **Apply** stays disabled while there are any. Typical errors:

- a required column or value is missing, or a value is not one of the allowed ones;
- the same code or email appears twice, or two users share a national ID + ID type;
- a code refers to something that is not in the workbook (or, for a tab you left out, not active in the system);
- a user's department is not one of their facility's departments;
- a partner (monitor) has no regions, or has a facility, department, org role or title — or a non-partner has regions;
- something would be archived or deleted while an active user, or an item you left unchanged, still uses it;
- the import would disable or demote you, or leave no active admin.

Warnings do not block. Users being disabled because they are missing from the Users tab are listed, and a red banner appears when more than half of a tab's existing items would be removed — that usually means the wrong file. When anything will be archived, deleted or disabled you tick a confirmation before applying. If someone changes the data between your preview and apply, you are asked to preview again.

## Regions

Top-level geographic groupings; a region aggregates every facility in it on the **National** report. Fields: `code` (unique), `name`. A region with districts, or assigned to a partner user, can't be deleted.

## Districts

Each district belongs to exactly one region, and every facility belongs to exactly one district.

- A district with facilities can't be deleted; reassign the facilities first.
- Moving a district to another region moves its facilities with it (historical responses keep the region they were submitted under).

## Facilities

Individual labs / health facilities. Each facility belongs to a **district** (the region is derived from it), links to **several departments**, and has a free-text `facility_type` (e.g. *"Reference lab"*).

## Departments

Functional units — e.g. *Microbiology*, *Administration*. Shared across facilities; a facility lists the departments it has. Department names must be unique.

## Org roles

Broad organisational roles — e.g. *"Laboratory Technician"*, *"Quality Officer"*.

## Job titles

Titles such as *Dr.* or *Ms.*, shown in the Department-level report.

## Archived items

Archived items keep their history in reports (labelled "(archived)" there, while they have respondents) but disappear from lists and pickers. Turn on **Show archived** above a table to see them greyed out. To bring one back, add its code to the workbook again and import.

## Editing one record

**Add** and the pencil icon edit a single record in place, as before. Use the workbook for bulk changes.
````

- [ ] **Step 6: Rewrite the Assessments docs**

Replace the whole of `apps/web/src/docs/1.0.0/assessments.md` with:

````markdown
# Assessments (admin)

Define the assessment frameworks your staff will be asked to complete. **Admin-only.**

Domain-level actions live in the **⋯ (domain options)** menu next to the domain selector: **New**, **Edit**, **Export catalogue**, **Import catalogue** and **Delete**. The **⋯ (item options)** menu on the right of the toolbar (once a domain is selected) has **Add Item**.

## The bundled catalogue

The app ships with an assessment catalogue — 20 domains, their competency items and footnotes — that is loaded automatically the first time it starts. Loading only ever adds what is missing (a missing domain; items or footnotes for a domain that has none), so restarts never overwrite changes you have made.

## Domains

A **domain** is a named assessment framework, e.g. *Bioinformatics (BIO)*. Each domain has a **code**, a **name**, a **version** (bump it when you revise items; old responses keep their old version), and optional **purpose** and **introduction** text shown on the survey **Start** page.

## Items

Each domain has many **items** (subcompetencies), grouped under competencies. Every item has a `competency_value` and `competency_text`, a `subcompetency_value` (unique within the domain) and `subcompetency_text`, and five descriptors: **beginner / competent / proficient / expert / N/A**.

## Footnotes

Footnotes define marked terms (e.g. `*`, `‡`) used in item text: a **symbol → definition** pair per domain. On the survey a footnote shows at the bottom of a page only when its symbol appears on that page.

## Catalogue workbook

To change many items at once, use the catalogue workbook:

1. **⋯ → Export catalogue** downloads `assessment-catalogue.xlsx` with the current catalogue.
2. Edit it in Excel. Tabs and columns (required in **bold**):

| Tab | Columns | Matched by |
|---|---|---|
| Domains | **domain_code**, **domain_name**, **version**, purpose, introduction | domain_code |
| Items | **domain_code**, **competency_value**, competency_text, **subcompetency_value**, **subcompetency_text**, **beginner**, **competent**, **proficient**, **expert**, na | domain_code + subcompetency_value |
| Footnotes | **domain_code**, **symbol**, **definition**, sort_order | domain_code + symbol |

3. **⋯ → Import catalogue** uploads it and shows a preview of what will be added and updated, with any errors pinned at the top. Apply when it looks right.

The catalogue import **only adds and updates** — nothing is ever removed. Delete items or domains here on the page instead. New items are added after a domain's existing items in sheet order; a blank footnote `sort_order` keeps the footnote's current position.

## Effects on surveys

Editing items affects **new** sessions only. Completed assessments keep their original answers and response rows, so historical reports don't change when you tune the descriptors. Bump the domain **version** for substantive changes.
````

- [ ] **Step 7: Rewrite Getting started; edit Users and Reports docs**

Replace the whole of `apps/web/src/docs/1.0.0/getting-started.md` with:

````markdown
# Getting Started

Welcome to **LabWorkforce** — a tool for running competency assessments across your lab workforce, reviewing completed submissions, and producing reports that roll up from individuals to regions.

## What it does

1. **Assessment domains** — groups of competencies with proficiency descriptors (Beginner → Expert). A full catalogue ships with the app and can be updated from an Excel workbook or edited by hand.
2. **Collect self-assessments** — staff answer each competency on a 4-level scale (plus N/A) using the Survey page.
3. **Review submissions** — an admin approves or rejects each completed assessment; only approved submissions count toward reports by default.
4. **Analyse results** — drill down from National → Region → District → Facility → Department → Individual, with charts, stacked breakdowns, and PDF/Excel/CSV export.

## First-time setup (admins)

1. **Sign in** with the built-in admin account and set your own password.
2. **Setup → Get started** — export the country setup template, fill in regions, districts, facilities, departments, org roles, job titles and users, then import it. The preview shows every change before anything is saved. Keep your own admin account on the Users tab, and give every staff user a **facility** and **department**: responses snapshot them at completion time, so unassigned users don't roll up into regional reports. The **Setup** docs page lists the columns and rules; a [sample workbook](data/sample-country-setup.xlsx) shows a filled-in example.
3. **Hand out credentials** — straight after the import, download the new users' usernames and temporary passwords (shown only once). Users change the password at first login. You can also add or edit users one at a time on the **Users** page.
4. **Assessments** — the catalogue is already loaded. Review it on the **Assessments** page; use **Export catalogue / Import catalogue** for bulk changes.

To change the organisation later, export the setup, edit it and import it again — rows you remove are archived (or deleted when they have no history) and users you remove are disabled.

## Daily use (staff)

- Open the **Survey** page, pick a domain, answer each competency.
- If you get interrupted, close the tab. The in-progress session auto-saves and shows up on **My assessments** with a **Resume** button.
- Once you submit, the assessment waits for admin review.

## Daily use (admins)

- **Reviews** shows completed submissions awaiting your decision. Approve to include in reports, reject with notes to exclude.
- **Reports** shows aggregated maturity levels by region/district/facility/department/individual. Click any bar or row to drill down.

## Roles

| Role  | Can see                                                  |
|-------|----------------------------------------------------------|
| admin | Everything — all reports, reviews, user/setup management |
| staff | Own assessments, facility-scoped reports (no national)   |

## Tips

- Pagination lives at the bottom of every large table. Use **Rows per page** if you want denser or lighter views.
- Use the search box on Users and Reviews to narrow long lists.
- Toggle **Approved only** on the Reports filter bar to see pending/rejected submissions too — useful when reviewing before approval.
- Most pages work on both dark and light theme; use the sun/moon icon in the top-right.
````

If the `## Roles` table in the current file already has more rows (e.g. a `monitor` row added by an earlier plan), keep the current table instead of the one above.

In `apps/web/src/docs/1.0.0/users.md`:

Replace the bullet `- CSV import creates staff only; add partners from the form.` with:

```markdown
- Partners can also be created in bulk with the country setup workbook (`system_role` = `monitor` plus `region_codes`).
```

Replace everything from the heading `## Importing users from CSV` down to (not including) `## Editing + resetting` with:

```markdown
## Importing users in bulk

Bulk import lives on the **Setup** page (**Bulk import on Setup** links there): the **Users** tab of the country setup workbook. Users are matched by email; existing users keep their username and password, new users get a generated username and a temporary password, and users missing from the tab are **disabled** (never deleted). The preview shows every change first, and the import will not disable or demote you. Right after the import, **Download credentials** gives you each new user's username and temporary password — the list is shown only once. The **Setup** docs page lists the columns and rules.

```

In `apps/web/src/docs/1.0.0/reports.md`:

Replace `Assigning a district (Setup › Facilities, or a facilities CSV import) also attributes` with `Assigning a district (Setup › Facilities, or the country setup workbook) also attributes`.

Append at the end of the file:

```markdown

## Archived places

A region, district, facility or department removed through the country setup workbook is archived when it has history. It still appears in reports — labelled "(archived)" — wherever it has respondents in the current view, so past results stay visible. Archived places without respondents in the view are left out.
```

- [ ] **Step 8: Run everything and commit**

Run: `pnpm --filter @workforce-competency/api test` → PASS; `pnpm --filter @workforce-competency/api typecheck` → no errors.
Run: `pnpm --filter @workforce-competency/web test` → PASS; `pnpm --filter @workforce-competency/web typecheck` → no errors; `pnpm --filter @workforce-competency/web build` → succeeds.

```bash
git add -A apps/api/src/routes apps/api/test apps/web/src/lib/setup apps/web/src/docs/1.0.0
git commit -m "chore: remove the CSV import path; docs for the setup and catalogue workbooks"
```

(The `git rm` deletions from Step 3 are already staged and go into this commit.)

---

### Task 12: Verification

**Files:** none changed (fix-ups only if a check fails, committed as `fix: …`).

**Interfaces:**
- Consumes: everything above.
- Produces: a green branch ready for review.

- [ ] **Step 1: Full API suite and typecheck**

Run: `pnpm --filter @workforce-competency/api test`
Expected: PASS — including `workbook-reader`, `setup-plan-org`, `setup-plan-users`, `setup-import`, `setup-export`, `catalogue-import`, `seed-assessments`, `archived`, `csv-import-removed`, `migration` and every pre-existing suite.
Run: `pnpm --filter @workforce-competency/api typecheck`
Expected: no errors.

- [ ] **Step 2: Full web suite, typecheck and build**

Run: `pnpm --filter @workforce-competency/web test`
Expected: PASS — including `lib/import/plan.test.ts`, `lib/setup/archived.test.ts`, `lib/reports/archived.test.ts`.
Run: `pnpm --filter @workforce-competency/web typecheck`
Expected: no errors.
Run: `pnpm --filter @workforce-competency/web build`
Expected: build succeeds.

- [ ] **Step 3: Leftover checks**

Run: `git grep -n "parseCsv\|lib/csv\|ImportDialog\b\|formatImportResult\|Import CSV" -- apps`
Expected: no matches.
Run: `ls apps/api/seed-data apps/web/public/data`
Expected: `appendix_b.csv  assessment-catalogue.xlsx` and `sample-country-setup.xlsx` only.
Run: `git status --short`
Expected: clean.

- [ ] **Step 4: Hand over**

The clean-slate manual browser run from spec §7 (fresh deploy → Get started → broken and sample workbooks → credentials → surveys → partner checks → re-import with a facility removed → "(archived)" in reports) is done separately by the controller and is outside this plan's automated scope.

---

## Spec coverage

| Spec section | Tasks |
|---|---|
| §1 Country setup workbook — tabs, columns, `;` lists, allowed values, `username` ignored | 1, 3 |
| §1 Matching, full sync, missing tab, code change, restore, users keep credentials | 2, 3, 4 |
| §1 Validation errors (columns, required, allowed values, duplicates, national ID, references, department ∈ facility, monitor rules, archive-while-referenced, lock-out guards) | 1, 2, 3 |
| §1 Warnings (absent users disabled, > 50 %) | 2, 3 |
| §1 Export styling (frozen header, shaded required, dropdowns, greyed username, active only, empty template) | 4 |
| §2 Catalogue workbook, bundled file, conversion, insert-only startup, add + update re-import, export | 5, 6 |
| §3 Endpoints, 10 MB raw body, fingerprint / 409, one transaction, credentials | 4, 5 |
| §3 Plan shape | 2 (plus `counts.disabled`) |
| §3 UI — Setup buttons, Get started, preview, confirmation checkbox, red banner, result + credentials, Assessments page, Users page link | 8, 9, 10 |
| §4 Migration 11, history, archive/delete/disable, `include_archived`, Show archived, reports "(archived)", pickers | 2, 4, 7, 9 |
| §5 Partner complementary suppression | Excluded — separate plan `2026-10-06-partner-complementary-suppression.md` |
| §6 Remove CSV endpoints and UI, sample workbook, docs | 9, 10, 11 |
| §7 Tests — reader, planner, apply, round trip, catalogue, reports archived, web pure logic | 1–9; clean-slate run out of scope (Task 12) |
