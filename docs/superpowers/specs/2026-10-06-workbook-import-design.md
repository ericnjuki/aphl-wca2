# Workbook Import & Partner Privacy Hardening — Design

**Date:** 2026-10-06
**Status:** Approved design, pending spec review

## Problem

1. **Initial data is loaded the way the original script-based tool did it.**
   Organisation data comes from six sample CSVs in `apps/web/public/data/`
   that an admin uploads one at a time on separate Setup tabs, in dependency
   order, plus a separate users CSV. Nothing validates across files, nothing
   is atomic, and there is no way to retire an entity. The assessment
   catalogue is 22 CSVs under `apps/api/seed-data/`, with four CSV import
   dialogs on the Assessments page.
2. **Partner small-group hiding can be defeated by subtraction.** When exactly
   one row in a list is hidden, `parent total − visible rows` reveals it
   (demonstrated in the UI test: Temeke district − Laboratory = the hidden
   Microbiology row).

## Decisions

| Question | Decision |
|---|---|
| How many workbooks? | Two formats, but only one is imported per deployment: the **country setup** workbook. The **assessment catalogue** ships with the app. |
| Catalogue after deployment | Bundled `assessment-catalogue.xlsx` loads on start (insert-missing only, as today). Admins can re-import an updated catalogue workbook from the Assessments page. |
| Re-import semantics (country setup) | **Full sync**: the workbook is the truth for every tab it contains. |
| What "remove" means | **Archive, keep history.** Items with history are archived; items with none are deleted; users are disabled, never deleted. |
| Missing tab | No change for that entity. |
| Catalogue re-import | Add + update only; never removes. |
| Architecture | **Server-side parsing** with ExcelJS; **preview (dry run) → apply** in one transaction guarded by a plan fingerprint. |
| Template | "Export current setup" doubles as template (empty on a fresh system) and backup. |
| Glossary (`appendix_b.csv`) | Out of scope — nothing uses it. Left in place. |
| Partner subtraction gap | **Complementary suppression**: a list never has exactly one hidden row. |

Rejected:
- **One workbook for everything** — org editors would carry 400+ catalogue rows.
- **Add/update-only or first-time-only re-import** — user chose full sync; guarded by preview + confirmation instead.
- **Hard delete everything not in the workbook** — would drop history from reports.
- **Client-side parsing (B)** — a second code path for the bundled catalogue.
- **Excel front-end over the existing CSV endpoints (C)** — no cross-tab validation, not atomic, no archiving.

## 1. Country setup workbook (`country-setup.xlsx`)

Codes and emails are matched case-insensitively. Bold = required.

| Tab | Columns | Key |
|---|---|---|
| Read me | instructions, export date, app version | ignored on import |
| Regions | **region_code**, **region_name** | code |
| Districts | **district_code**, **district_name**, **region_code** | code |
| Departments | **department_code**, **department_name** | code |
| Facilities | **facility_code**, **facility_name**, facility_type, **district_code**, department_codes | code |
| Org Roles | **role_code**, **role_name** | code |
| Job Titles | **title_code**, **title_name** | code |
| Users | **email**, **first_name**, **last_name**, **national_id**, **id_type**, system_role, facility_code, department_code, org_role_code, title_code, region_codes, status, username | email |

- `department_codes`, `region_codes`: `;`-separated lists (whitespace trimmed, empty entries ignored).
- `id_type` ∈ {NRC, Passport, Other}. `system_role` ∈ {staff, admin, monitor}, default `staff`. `status` ∈ {active, disabled}, default `active`.
- `username`: written on export, **ignored on import**, styled read-only.
- A facility's region is derived from its district (existing invariant).
- Export writes: frozen header row, shaded required headers, dropdown data
  validation for `id_type`, `system_role`, `status`. Only **active** (non-archived) entities are exported. On a system with no org data the export is the empty template.
- Code changes are treated as remove(old) + add(new); rename by changing the name and keeping the code.
- A code that matches an **archived** entity restores it (clears `archived_at`) and applies the row.
- Users matched by email keep their username and password; only the listed fields are updated. New users get a generated username and temporary password (existing generators) and must change it on first login.

### Validation (whole-plan, after adds/updates/removals are resolved)

Errors block apply:
- Missing tab headers / required columns; required cell empty; value outside its allowed set.
- Duplicate key within a tab; two users sharing the same `national_id` + `id_type` (a database uniqueness rule), including against users not in the workbook.
- Reference to a code that exists neither in the workbook (if that tab is present) nor as an active entity in the database (if the tab is absent).
- A user's `department_code` not among their facility's departments.
- `monitor`: needs ≥1 `region_codes`, must not have facility/department/org role/title. Non-monitor: must not have `region_codes`.
- Archiving an entity still referenced by an active entity or active user in the resulting state (e.g. a facility with an active user, a region with a non-archived district, a region in a monitor's regions).
- Lock-out guards: the import may not disable or demote the importing admin, and must leave at least one active admin.

Warnings (do not block):
- Users disabled because they are absent from the Users tab.
- Any tab where more than 50% of existing active entities would be archived/deleted ("this usually means the wrong file").

## 2. Assessment catalogue workbook (`assessment-catalogue.xlsx`)

| Tab | Columns | Key |
|---|---|---|
| Read me | instructions, catalogue version | ignored |
| Domains | **domain_code**, **domain_name**, **version**, purpose, introduction | code |
| Items | **domain_code**, **competency_value**, competency_text, **subcompetency_value**, **subcompetency_text**, **beginner**, **competent**, **proficient**, **expert**, na | domain + subcompetency |
| Footnotes | **domain_code**, **symbol**, **definition**, sort_order | domain + symbol |

- Bundled at `apps/api/seed-data/assessment-catalogue.xlsx`, produced once by a
  conversion script from the existing CSVs; the 22 CSVs are then removed.
- **Startup**: same rules as today's `seed-assessments.ts` — insert missing domains; insert items/footnotes only for domains that have none. Never overwrites.
- **Admin re-import**: preview → apply, add + update only. A fresh database seeded from the workbook must match today's CSV seeding (20 domains, 416 items, footnotes).
- `GET /assessments/catalogue/export` writes the current catalogue in this format.

## 3. Import flow

### Endpoints (admin only)

| Endpoint | Purpose |
|---|---|
| `GET /admin/setup/export` | Stream the country setup workbook |
| `POST /admin/setup/import/preview` | Body: raw `.xlsx` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, ≤10 MB). Returns the plan; changes nothing. |
| `POST /admin/setup/import/apply?fingerprint=…` | Same body. Recomputes the plan; 409 if its fingerprint differs; otherwise applies in **one transaction** and returns the summary + credentials for newly created users. |
| `GET /assessments/catalogue/export` | Stream the catalogue workbook |
| `POST /assessments/catalogue/import/preview` / `…/apply` | Same pattern, add + update only |

### Plan shape

```ts
interface ImportPlan {
  fingerprint: string;              // sha256 of the canonical change list
  tabs: TabPlan[];
  canApply: boolean;                // false when any error exists
  confirmations: { archived: number; deleted: number; disabledUsers: number };
}
interface TabPlan {
  tab: string;                      // "Facilities"
  present: boolean;                 // false → tab absent, no changes
  counts: { added: number; updated: number; restored: number; archived: number; deleted: number; unchanged: number };
  changes: { row: number | null; key: string; kind: 'add'|'update'|'restore'|'archive'|'delete'|'disable';
             fields?: { field: string; from: unknown; to: unknown }[] }[];
  errors: { row: number; column: string | null; message: string }[];
  warnings: string[];
}
```

Row numbers are spreadsheet row numbers (header = row 1).

### UI

- **Setup page** header: **Export setup** and **Import workbook** buttons. The per-tab "Import CSV" buttons are removed, as is the Users page CSV import (it links to Setup).
- **Get started** card replaces the empty Setup tables when there are no regions: 1) Export template, 2) fill it in, 3) Import workbook.
- **Preview screen**: one collapsible section per tab with coloured counts; rows listed with field-level `from → to`; error rows pinned first with sheet/row/column/message.
  - Apply disabled while any error exists.
  - When `confirmations` has any non-zero count, a checkbox must be ticked: "I understand this will archive N items, delete M, and disable K users".
  - Red banner on any >50% warning.
- **Result**: summary of applied changes; if users were created, **Download credentials** (xlsx: name, email, username, temporary password), shown once.
- **Assessments page**: the four CSV dialogs are replaced by **Export catalogue** / **Import catalogue** using the same preview component.

## 4. Data model & archiving

Migration **11**: `ALTER TABLE … ADD COLUMN archived_at TEXT` on `regions`, `districts`, `facilities`, `departments`, `org_roles`, `user_titles`.

- **History** = referenced by any `user_assessment_responses` row (regions, districts, facilities, departments) or by any user, enabled or not (org roles, titles).
- Remove with history → set `archived_at`. Remove without history → delete (plus `facility_departments` links / `user_regions` rows as applicable). Users → `is_enabled = 0`.
- Admin list endpoints and pickers return active entities by default; `?include_archived=1` includes archived. Setup tables get a **Show archived** toggle (archived rows greyed and labelled).
- Reports: an archived child (region, district, facility, department) is listed only when it has respondents in the current view, with `archived: true`; the UI labels it "(archived)".
- Existing single-entity CRUD (Setup forms) is unchanged except that pickers exclude archived rows.

## 5. Partner privacy hardening

In `suppressSmallGroups` (`apps/api/src/routes/reports.ts`), partner view only:

1. **Primary**: hide every row with 1–2 respondents (existing).
2. **Complementary**: if exactly one row in the list is hidden, also hide the smallest remaining row with respondents (ties → first by name). Rows carry `suppressed: 'small' | 'complementary'`.

Summary cards: reports return `meta.avg_level` (average over all respondents in the view); the web uses it instead of averaging visible rows. For partners, `meta.avg_level` is `null` when the view has 1–2 respondents.

Web: the table shows "Fewer than 3 respondents — hidden for privacy" for `small` and "Hidden for privacy" for `complementary` (its count is ≥3, so "fewer than 3" would be wrong); Excel/PDF exports likewise.

## 6. Removal of the CSV path

- Delete org `/import` endpoints (regions, districts, departments, facilities, org roles, titles, users) and the assessment CSV import endpoints; remove their UI.
- Replace `apps/web/public/data/*.csv` with `sample-country-setup.xlsx` (converted from the same sample data) and link it from the docs.
- Rewrite docs: setup, users, assessments, getting started.

## 7. Testing

API (vitest; fixtures built with ExcelJS inside tests):
- Reader: tabs/headers, case-insensitive codes, missing required columns, `;` lists, blank rows skipped, `username` ignored.
- Planner: add / update / unchanged / archive-with-history / delete-without-history / restore; missing tab = no change; every validation rule in §1; lock-out guards; >50% warning.
- Apply: atomic (error → nothing changed), stale fingerprint → 409, credentials only for new users.
- Round trip: export then re-import → plan with no changes.
- Catalogue: fresh DB from bundled workbook = 20 domains / 416 items / footnotes; re-import add + update only.
- Reports: archived children only with data; complementary suppression (one hidden → second hidden; single non-empty row); `meta.avg_level` correct and null for small partner views.

Web (vitest, pure logic): preview grouping, confirmation sentence.

Clean-slate manual run (throwaway DB, screenshots): fresh deploy with catalogue only → seed admin first login → Get started → export template → broken workbook shows errors and blocks apply → sample workbook preview + apply → credentials download → one staff survey via UI, the rest via API, approvals in Reviews → partner checks including complementary suppression (the Temeke − Laboratory subtraction no longer reveals Microbiology) → re-import with one facility removed → preview shows archive, reports show "(archived)" with history intact.

## Order of work

1. Complementary suppression + `meta.avg_level` (own branch, merged first).
2. Migration 11 + workbook reader + planner.
3. Apply + export endpoints.
4. Catalogue workbook, conversion script, startup loader, catalogue import.
5. Web: Get started, import/export, preview screen, Assessments page.
6. Archived handling in Setup tables and reports.
7. Remove CSV path, docs, sample workbook.
8. Clean-slate run.

## Out of scope

- Glossary / `appendix_b.csv`.
- CSV or other formats (xlsx only).
- Scheduled or API-driven sync; import is admin-initiated in the UI.
