# Region Monitors (Partner Users) — Design

**Date:** 2026-10-06
**Status:** Approved design, pending spec review

## Problem

Every non-admin user's report access is derived from their facility. Supporting
partners (e.g. NGOs running a project) need to monitor one or more regions
without belonging to any facility. Today the only workaround is to place them in
an arbitrary facility, which makes them look like that facility's staff and lets
them see its individuals' results.

## Decisions

| Question | Decision |
|---|---|
| Who are these users? | External partners only. They monitor; they never take assessments. |
| What can they see? | Aggregated reports only — region, district and facility levels. Never an individual's results, never per-person grids. |
| How many regions? | One or more (a project can span several regions). |
| How are regions assigned? | Directly to each user by an admin. No "project" entity. |
| Representation | New system role `monitor` + link table `user_regions`. |
| CSV import | Not in this iteration — monitors are created via the Users form. |

Rejected:
- **`users.region_id` column** — cannot express multi-region partners.
- **Reusing `staff` with a region** — staff means "assessed worker"; monitors
  would leak into survey flows, staff counts and individual-report access.
- **Projects as a first-class entity** — more tables/screens than a handful of
  partner users justify. Revisit if project coverage changes often.

## 1. Data model

New migration **10** in `apps/api/src/db/migrations.ts`:

```sql
CREATE TABLE IF NOT EXISTS user_regions (
  user_id   INTEGER NOT NULL,
  region_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, region_id)
);
CREATE INDEX IF NOT EXISTS idx_user_regions_region ON user_regions(region_id);
```

`users.role` is free text with default `'staff'`; `'monitor'` is a new value —
no column change.

Invariants (enforced in code; foreign keys are not enforced in this database):

1. A `monitor` has `facility_id`, `department_id`, `org_role_id` and `title_id`
   all NULL.
2. A `monitor` has at least one `user_regions` row; every referenced region exists.
3. Only `monitor` users have `user_regions` rows. Changing a user's role away
   from `monitor` deletes their rows.
4. A region cannot be deleted while any `user_regions` row references it. The
   existing `regionsRouter` `beforeDelete` hook gains this check (409, e.g.
   "2 partner users are still assigned to this region"), matching the existing
   districts check.

There is no user-delete endpoint (users are disabled, not deleted), so no
cleanup on user delete is needed.

## 2. Access control

`apps/api/src/lib/report-scope.ts`:

- `Scope.role` becomes `'staff' | 'admin' | 'monitor'`.
- `Scope` gains `regionIds: number[]` — loaded from `user_regions` for monitors,
  empty for everyone else.
- `denyReason` gets a monitor branch, evaluated before the staff rules:

| Requested level | Monitor |
|---|---|
| national | 403 |
| region | allowed iff `regionId ∈ regionIds` |
| district | allowed iff the district's current `region_id ∈ regionIds` (404 handling unchanged if the district doesn't exist) |
| facility | allowed iff the facility's current `region_id ∈ regionIds` |
| department | **403 always** |
| user (individual) | **403 always**, including their own id |

Why department is blocked: `GET /reports/departments/:id` returns a per-person
grid with names, across every facility that has the department. That violates
"aggregates only". A monitor's view of departments is the per-department
aggregate rows in the facility report.

### Bug fix included

In the existing staff `level: 'user'` rule, `u.facility_id === scope.facilityId`
is true when both are NULL, so a facility-less staff user can view any other
facility-less user's individual report. Fix: deny when `scope.facilityId` is
NULL (the self-view rule above it still applies). Add a regression test.

## 3. Survey and assessments

Monitors cannot create responses:

- `POST /survey/sessions` and `POST /survey/sessions/:id/complete` → 403
  `"Partner users do not take assessments"` for monitors.
- `GET /survey/sessions` and `GET /my-assessments` → empty lists for monitors.

Implemented as a small `denyMonitor` middleware in `middleware/auth.ts`
(after `requireAuth`) applied to the survey router's write routes, so the check
lives in one place.

## 4. Admin API

`apps/api/src/routes/admin.ts`, users router:

- `POST /admin/users` and `PUT /admin/users/:id` accept `region_ids: number[]`.
  The user row and its `user_regions` rows are written in one transaction.
- Validation (400):
  - `role = 'monitor'` with any of facility / department / org role / title set.
  - `role = 'monitor'` with empty or missing `region_ids`.
  - Unknown region id in `region_ids`.
  - `region_ids` non-empty for a non-monitor role.
- `PUT` changing role from `monitor` to another role deletes the user's
  `user_regions` rows (invariant 3).
- `GET /admin/users` adds `region_ids: number[]` and `region_names: string[]`
  per user.
- `POST /admin/users/import` is unchanged; it only creates `staff`.

`apps/api/src/routes/auth.ts`: the login response and `/auth/me` user object add
`region_ids` and `regions: { id, name }[]` (empty for non-monitors).

## 5. Web UI

### Landing and routing

- `/` (Survey page): a monitor is redirected to `/reports`.
- `/reports` (`ReportsPage.tsx`) redirect logic gains a monitor branch, ahead of
  the existing staff branch:
  - exactly one region → `/reports/regions/:id`
  - several regions → a **"Your regions"** view: one card per region linking to
    its region report. No combined multi-region report.
- Breadcrumbs: for monitors the "National" root crumb is replaced by
  "Your regions" (multi-region) or omitted (single region).

### Inside reports

- Facility report: department rows are rendered as non-links for monitors.
- Any link to an individual report is hidden for monitors.
- These are UX only; the API (§2) is the enforcement.

### Menu

`apps/web/src/lib/menu-list.ts`: `Role` gains `'monitor'`. Menu items get an
optional `roles?: Role[]` allow-list alongside the existing `adminOnly`. Survey
and My Assessments are restricted to `['admin', 'staff']`. Monitors see Reports
and Docs.

### Users page (admin)

- System Role select adds **"Partner (monitor)"**.
- When selected: Facility, Department, Org Role and Title fields are hidden and
  cleared; a **Regions** checklist appears (at least one required, enforced
  client-side and by the API).
- Switching away from monitor clears the region selection.
- Users table: monitors show their region names in the facility column, with a
  "Partner" badge.

### i18n and docs

- New strings in every existing locale file.
- `docs/`: add a "Partner (monitor) users" section to the roles/setup docs,
  covering what monitors can and cannot see.

## 6. Testing

API (vitest, `apps/api/test`):

- `denyReason` matrix for monitors: each level × in-region / out-of-region,
  national, department, individual (own and other).
- Multi-region monitor can view both regions and their districts/facilities.
- Facility moved to another region via district re-assignment: monitor access
  follows the facility's current region.
- Monitor cannot start or complete a survey (403); my-assessments returns empty.
- Admin validation cases from §4; role change monitor → staff clears regions.
- Region delete blocked while assigned to a monitor (409).
- Regression: facility-less staff cannot view another facility-less user's
  individual report.

Web:

- Monitor landing redirect: one region vs several.
- Menu filtering for the monitor role.

Manual: create a monitor with two regions on a local build; verify landing,
drill-down to facility, blocked department/individual links, and a 403 when
hitting a national / out-of-region / department URL directly.

## Out of scope

- CSV import of monitor users (`region_codes` column) — add later if needed.
- District-level or national-level monitor scope.
- Projects as an entity.
- The staff department-report scoping issue noted below.

## Known adjacent issue (not fixed here)

`GET /reports/departments/:id` lets a staff user view the department if their
facility has it, but the query returns named respondents from **every**
facility with that department (`WHERE uar.department_id = ?`, no facility
filter). Staff can therefore see named colleagues' results from other
facilities. Tracked separately.
