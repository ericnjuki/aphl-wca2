# Districts — Design

**Date:** 2026-09-28
**Status:** Approved design, pending spec review
**Branch:** `feat/districts`

## Problem

Several facilities sit in the same region but in different districts. The org
hierarchy today is Region → Facility → Department, so there is no way to record
or report on districts.

## Decisions

| Question | Decision |
|---|---|
| Scope | District is a full hierarchy level: Region → District → Facility, with its own report, drill-down, breadcrumbs, exports and staff scoping. |
| Required? | Every facility must belong to a district. A facility's region is derived from its district. |
| Storage of facility region | Keep `facilities.region_id` as a **server-maintained denormalised copy** of `districts.region_id`. All existing region queries keep working unchanged. |

Rejected: dropping `facilities.region_id` and deriving region via join — rewrites
every region query and makes not-yet-districted facilities vanish from region
reports during rollout.

## 1. Data model

New migration **9** in `apps/api/src/db/migrations.ts`:

```sql
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
```

- `facilities.district_id` is nullable in the schema so existing rows stay valid;
  the API enforces it as required on create/update.
- **Foreign keys are not enforced** (`PRAGMA foreign_keys` is never enabled in
  this codebase). All referential rules below are enforced in API code. Enabling
  the pragma globally is out of scope.

### Invariants (enforced in API code)

1. When a facility is saved with `district_id = D`, set
   `facilities.region_id = districts.region_id` of `D`.
2. When a district's `region_id` changes, update `region_id` on all its
   facilities to match.
3. A district cannot be deleted while any facility references it (409).
4. A region cannot be deleted while any district references it (409).

### Response snapshot

- `apps/api/src/routes/survey.ts` completion: the org-context query also selects
  `f.district_id`, written to `user_assessment_responses.district_id`.
- **Backfill on assignment:** when a facility's district is set or changed, run
  `UPDATE user_assessment_responses SET district_id = ? WHERE facility_id = ? AND district_id IS NULL`.
  Only NULLs are filled; an existing district snapshot is never overwritten.
  Without this, all pre-district history would be permanently "unassigned".
- `apps/api/src/scripts/backfill-responses.ts`: include `district_id` in the
  org context it writes, for parity.

### Access scope

`apps/api/src/lib/report-scope.ts`:
- `Scope` gains `districtId: number | null` (from `f.district_id`).
- `denyReason` gains `{ level: 'district'; districtId }`: staff allowed only when
  it equals their own `districtId`; admin unrestricted.

## 2. Setup UI, admin API, CSV import

### Admin API (`apps/api/src/routes/admin.ts`)

- `GET /admin/districts` → `{ districts: [{ id, code, name, region_id, region_name, facility_count }] }`, ordered by region name, then district name.
- `POST /admin/districts` — requires `code`, `name`, `region_id`; 400 if the
  region does not exist; 409 on duplicate code.
- `PUT /admin/districts/:id` — same validation; applies invariant 2.
- `DELETE /admin/districts/:id` — invariant 3; 409 message states the count,
  e.g. `"3 facilities are still assigned to this district"`.
- `POST /admin/districts/import` — CSV columns `district_code, district_name,
  region_code` (all required). Rows with unknown region are skipped.
- Regions: replace the generic `DELETE` for regions with one that applies
  invariant 4.
- Facilities `POST`/`PUT`: `district_id` required (400 if missing or unknown);
  `region_id` in the body is ignored and derived (invariant 1); run the backfill.
  `GET` list adds `district_id, district_name`.

### Facilities CSV import

- `district_code` becomes required. `region_code` is still accepted but only
  validated: row skipped if it does not match the district's region.
- **Behaviour change:** if `facility_code` already exists, update only that
  facility's `district_id` (and derived `region_id`), then run the backfill.
  Name, type and departments are left unchanged. This makes bulk-assigning
  districts to existing facilities practical.
- The districts and facilities import endpoints return
  `{ imported, updated?, skipped, errors: [{ row, reason }] }`, and the import
  dialog lists the first few reasons.

### Setup page (`apps/web/src/pages/SetupPage.tsx`)

- New **Districts** tab between Regions and Facilities: table with Code, Name,
  Region, Facilities (count), search; a dedicated sheet with code, name and a
  required Region select; CSV import with hint
  `Required columns: district_code, district_name, region_code.`
- **Facilities** tab: the Region select becomes a required **District** select,
  grouped by region (`Dar es Salaam › Temeke`). Table gains a District column;
  Region column stays read-only. Editing an existing facility that has no
  district requires choosing one before saving. Import hint updated.
- Sample data: new `apps/web/public/data/districts.csv`; `district_code`
  column added to `apps/web/public/data/facilities.csv`.

## 3. Reports

Drill-down becomes National → Region → **District** → Facility → Department → Individual.

### API (`apps/api/src/routes/reports.ts`)

- **New** `GET /reports/districts/:districtId` → `{ level: 'district', district: { id, name, region_id, region_name }, items: [{ facility_id, facility_name, ...counts }], meta }`.
  Same LEFT JOIN pattern as the region report today (facilities filtered by
  `f.district_id = ?`). Unassigned = respondents with `uar.district_id = ?` and
  `facility_id IS NULL`. Scoped via `denyReason` level `district`.
- **Changed** `GET /reports/regions/:regionId`:
  - `items` become districts in the region: `[{ district_id, district_name, ...counts }]`,
    joining responses on `uar.district_id = d.id`.
  - Unassigned = respondents with `uar.region_id = ?` and `district_id IS NULL`.
  - New field `undistricted_facilities: [{ id, name }]` — facilities in the
    region with `district_id IS NULL`.
- **Changed** `GET /reports/facilities/:facilityId`: `facility` gains
  `district_id, district_name, region_name`.
- National report unchanged.

### Frontend

- `types/reports.ts`: `ReportLevel` gains `'district'`; add `DistrictItem`,
  `DistrictReportResponse`; `RegionItem` becomes district-shaped;
  `RegionReportResponse` gains `undistricted_facilities`; facility shape gains
  the district fields.
- `main.tsx`: route `reports/districts/:districtId`.
- `hooks/reports/useReportQueries.ts`: `useDistrictReport(districtId)`.
- `components/reports/levels/DistrictReport.tsx`: modelled on the current
  `RegionReport` (facility bars, click → facility report).
- `RegionReport.tsx`: district bars, click → district report; below the table,
  a "Facilities without a district" list of links to facility reports, rendered
  only when non-empty.
- `ReportsPage.tsx`: level detection includes `districtId`; breadcrumbs —
  District: `Region name › District name`; Facility:
  `Region name › District name › Facility` (named links, replacing the generic
  "Region" crumb).
- `UnassignedBanner.tsx`: `region` message becomes "respondents aren't attributed
  to a district" with CTA to Setup (`${baseUrl}setup`); add a `district` message
  (respondents with no facility) with CTA to Users.
- `ReportKpiCards` bucket label: "districts" on region, "facilities" on district.
- Exports (`lib/reports/export-excel.ts`, `export-pdf.ts`, `ExportMenu.tsx`):
  add `district` cases (title `District · <name>`, Facility column); region
  export uses a District column.
- Staff landing redirect is unchanged (own facility report).

## Testing

- Add vitest to `apps/api` with an in-memory sql.js database and all migrations
  applied. Cover:
  - district CRUD validation; invariants 1–4;
  - backfill fills only NULL `district_id`;
  - facility CSV import: new row, existing-code district update, region/district
    mismatch skipped with reason;
  - region report groups by district and reports `undistricted_facilities`;
  - district report totals and unassigned count;
  - `denyReason` for `district` (own district allowed, other denied, admin allowed).
- Frontend: `pnpm --filter @workforce-competency/web test` stays green; manual
  walk-through in the running app of Setup → Districts, facility assignment, the
  full drill-down, breadcrumbs, and PDF/Excel export at region and district level.

## Documentation

Update `apps/web/src/docs/1.0.0/setup.md`, `reports.md`, `getting-started.md`,
`users.md` where regions are described, plus `README.md` and
`apps/web/README.md`.

## Out of scope

- Enabling `PRAGMA foreign_keys`.
- District filters on the national report.
- Changing the staff default landing page.
