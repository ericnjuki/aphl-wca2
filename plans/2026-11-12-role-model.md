# Role model: national / county / sub-county coordinators, facility admin, scoped reviews
**Status:** in-progress

Fork-only change (user, 2026-11-12): accepts future merge conflicts with upstream's region-monitor
design (`docs/superpowers/specs/2026-10-06-region-monitors-design.md`). No data migration: all
UAT/prod data is still test data.

## Roles

| Code | UI label | Placed at | Takes assessments | Reviews | Reports | Manages users |
|---|---|---|---|---|---|---|
| `admin` | Admin | none | no | any | everything, incl. individual | anyone, anywhere |
| `national` | National | none | no | no | national page only (per-county list), summary-only | no |
| `county` | County coordinator | 1 county (`user_regions`) | no | no | own county and below, summary-only | no |
| `subcounty` | Sub-county coordinator | 1 sub-county (`user_districts`) | no | any submission from a facility in their sub-county | own sub-county + its facilities, summary-only | no |
| `facility_admin` | Facility admin | 1 facility | yes | staff + other facility admins in own facility, never own | own facility, its departments, individuals in it | create staff/facility admins in own facility; edit details (name, email, department); reset passwords |
| `staff` | Staff | 1 facility | yes | no | own results only | no |

- "Summary-only" = today's partner rules: approved submissions only, small-group suppression
  (MIN_GROUP_SIZE 3 + complementary), no department grid, no individual reports.
- Sub-county coordinators see individual answers **only inside the review detail view** for a
  submission they may review, never in reports.
- No self-approval for anyone (reviewer ≠ submitter, enforced in the API).
- Facility admins cannot disable/delete users or move them to another facility (admin only).
  National/county/sub-county users are created by admin only.
- "Region"/"District" labels become configurable per deployment (see Labels).

## Backend (`apps/api`)

1. **Migration 12:** `user_districts (user_id, district_id)` mirroring `user_regions`
   (migration 10). One row per user for `subcounty`; `user_regions` limited to one row for `county`.
2. **Auth middleware** (`middleware/auth.ts`): `requireRole(...roles)` replaces `requireAdmin` where
   access widens; `denyMonitor` becomes `requireAssessmentTaker` (`facility_admin`, `staff`) on
   `survey.ts` session create/update/complete.
3. **Report scope** (`lib/report-scope.ts`): one policy per role replaces the admin/staff/monitor
   branches. `Scope` gains `districtIds`. Staff: `user` level for self only.
4. **Reports** (`routes/reports.ts`): every `scope.role === 'monitor'` becomes
   `isSummaryOnly(scope)` (`national`, `county`, `subcounty`). New: suppression on the national
   per-county list. Sub-county coordinators' privacy-hidden check stops at their district (no
   parent list above it to compare against). Department report facility pinning extends to
   `facility_admin`.
5. **Reviews** (`routes/admin.ts` → own router): list and approve/reject filtered by role
   (admin all; sub-county by submission facility's district; facility admin by facility),
   self-review rejected (403). New `GET /reviews/:id` returning the submission + all answers
   (same shape as `my-assessments/:id`).
6. **Users** (`routes/admin.ts`): `USER_ROLES` + `validatePlacement` rewritten per role. Facility
   admins: list/create/edit/reset limited to their facility; may only create `staff` or
   `facility_admin`; cannot change facility, role to anything else, enable/disable or delete.
7. **Workbook import/export** (`lib/workbook/setup-users.ts` etc.): new role values; `region_codes`
   accepts one code for `county`; new `district_codes` column for `subcounty`.
8. **Labels config:** env vars (e.g. `ORG_LEVEL1_LABEL=County`, `ORG_LEVEL2_LABEL=Sub-county`,
   defaults Region/District) exposed via a public `GET /api/v1/config`; used in API error
   messages and the workbook "Read me" and validation text. Tab names and column keys stay
   unchanged (user, 2026-11-12; DECISIONS). UAT/prod `.env` set to County/Sub-county at deploy.
9. `/auth/me` returns the user's district (for `subcounty`) alongside `regions`.

## Web (`apps/web`)

1. `Role` type + `menu-list.ts`: Survey/My Assessments for `facility_admin`, `staff`; Reviews for
   `admin`, `subcounty`, `facility_admin`; Users for `admin`, `facility_admin`; Assessments/Setup
   admin only. `main.tsx` redirect for non-takers generalised from `isMonitor`.
2. **Users page** (`UsersPage.tsx`, `lib/users/placement.ts`): role picker shows allowed roles for
   the caller; placement by role: county picker / sub-county picker / county → sub-county →
   facility cascade (cascade filters only; facility still determines region/district).
   Facility admin view: facility fixed, no enable/disable/delete.
3. **Reviews page** (`ReviewsPage.tsx`): keep the list; add a detail view (route or dialog) showing
   the submission's answers per competency/subcompetency (reuse My Assessments' detail table),
   with approve/reject there. Approve/reject hidden on the caller's own submissions.
4. **Reports:** landing per role (`lib/reports/landing.ts`); drill-down links stop at the role's
   limit (`FacilityReport.tsx` etc.); `ReportFilterBar` / `UnassignedBanner` role checks; staff
   land on their own individual report.
5. **Labels:** fetch `/config` at startup; replace hardcoded Region/District strings in reports,
   setup and users pages; en/pt/sw locale strings for role names.
6. In-app docs `apps/web/src/docs/1.0.0/users.md` and `reports.md` updated.

Implementation notes (2026-11-13, from the API side):
- First: type `AuthUser.role` and menu `Role` as the six-role union, mirroring
  `apps/api/src/lib/roles.ts` (`REVIEWER_ROLES`, `USER_MANAGER_ROLES`, `FACILITY_ROLES`, summary-only)
  in one web `lib/roles.ts`, so `tsc` flags every stale `'monitor'` check. Add `districts` /
  `district_ids` to `AuthUser` (`/auth/me` already returns them).
- Admin is not an assessment taker: check `survey.ts`'s gate; if so, `HomeRoute` sends admin
  (and national/county/subcounty) to Reports and the menu drops Survey/My Assessments for them.
- Landing: admin/national stay national; county → their region; subcounty → `districts[0]`;
  facility_admin → facility; staff → `/reports/users/:id` (changes `landing.test.ts`). A coordinator
  with no assignment gets a "not assigned" message, not the old regions picker.
- Links stop at the role's limit both ways: no links on national's per-county list for national;
  no department grid for summary-only (`FacilityReport` `isMonitor`); breadcrumbs/back links above
  a subcounty user's district must not render (they 403); no `/reports/users/:id` link from
  review detail for subcounty.
- Users page as facility admin: check the pickers' GET endpoints are readable by
  `facility_admin`; ungate the `enabled: isAdmin` query (~line 571). The API PUT compares
  `facility_id` with `!==` and checks `is_enabled`: `buildUserBody` must send the existing numeric
  facility and unchanged `is_enabled`, and always explicit `region_ids` / `district_ids` (empty
  when unused). Cover in `placement.test.ts`.
- Role names interpolate the labels (`t('roles.county', { label })`), defaults until `/config` loads.
- Review detail: same presentation as My Assessments' detail, extracting its table (not a copy).
- Grep locale JSON and `src/docs/**/*.md` for "monitor"/"Partner" at the end.
- Edit repo files with Edit/node, not `sed -i` (it drops CRLF in Git Bash).

## Tests

- Rewrite the monitor-based API tests (`admin-users-monitors`, `reports-monitors`,
  `reports-drilldown-privacy`, `reports-small-groups`, `survey-monitors`, `setup-plan-users`, …)
  for the new roles.
- New: access matrix per role × report level; review scoping + self-review block; facility-admin
  user management limits; national-list suppression; workbook role/district codes; `/config`.
- Web: `placement.test.ts`, menu filtering, landing.
- `pnpm` type check + build + tests, then (on approval) a live Playwright pass logged in as each role.

## Hard to reverse

- Migration 12 is forward-only on UAT/prod. Low risk: additive table, test data only. Recovery:
  DB volume backup taken before deploy (existing practice).
- Existing `monitor` users (if any on UAT/prod) stop working until re-assigned a new role by admin.

## Out of scope

- Email (account-created / password-reset mails): separate plan, after this one (TODO.md).
- Coordinators filling in assessments on behalf of staff.
