# Partner Complementary Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop partners recovering a hidden report row by subtraction, and make the "Avg maturity" summary card use the true average from the API.

**Architecture:** `suppressSmallGroups` in the reports router gains a second pass: when exactly one row in a list is hidden, the smallest other non-empty row is hidden too, and every hidden row is tagged `suppressed: 'small' | 'complementary'`. Report `meta` gains `avg_level`, computed in SQL over the whole view, and nulled for partners when the view has 1–2 respondents. The web reads `meta.avg_level` for the KPI card and labels the two suppression kinds differently in the table and exports.

**Tech Stack:** Express 5 + sql.js API (TypeScript, vitest + supertest); React + Vite web (vitest, node env, pure-logic tests).

**Spec:** `docs/superpowers/specs/2026-10-06-workbook-import-design.md` §5

## Global Constraints

- Partner-only: admins and staff must see exactly what they see today.
- `MIN_GROUP_SIZE` stays 3. Primary rule unchanged: rows with 1–2 respondents are hidden; rows with 0 respondents are never hidden.
- Complementary rule: if exactly one row in a list is hidden, also hide the smallest remaining row with respondents > 0; ties → the first such row in list order (lists are already ordered by name).
- `suppressed` values are exactly `'small'` and `'complementary'` (absent on visible rows). Hidden rows keep the blanked counts (`BLANK_COUNTS`).
- UI text: `small` → "Fewer than 3 respondents — hidden for privacy" (count cell `<3`, exports "Fewer than 3"); `complementary` → "Hidden for privacy" (count cell `—`, exports "Hidden for privacy").
- `meta.avg_level` = average of `response_level` over levels 1–4 (N/A excluded) for all respondents in the view (same filters as `meta.total_respondents`); `null` when there are none; for partners also `null` when `total_respondents` is 1 or 2.
- Branch: `feat/partner-complementary-suppression`, created from `feat/workbook-import` (which holds the spec commit). Merge to `main` when done.
- Commands from repo root: `pnpm --filter @workforce-competency/api test|typecheck`, `pnpm --filter @workforce-competency/web test|typecheck|build`.

---

## File Map

- Modify `apps/api/src/routes/reports.ts` — `suppressSmallGroups`, `respondentCounts`, `meta`, all `meta(...)` call sites.
- Modify `apps/api/test/reports-small-groups.test.ts` — expect `'small'`, add complementary + avg tests.
- Modify `apps/web/src/types/reports.ts` — `suppressed` union, `ReportMeta.avg_level`.
- Create `apps/web/src/lib/reports/privacy.ts` + `privacy.test.ts` — labels per suppression kind.
- Modify `apps/web/src/components/reports/MaturityBreakdownTable.tsx`, `apps/web/src/lib/reports/export-excel.ts` (+ test), `apps/web/src/lib/reports/export-pdf.ts` — use the labels.
- Modify `apps/web/src/components/reports/levels/{National,Region,District,Facility,Department}Report.tsx` — KPI avg from `data.meta.avg_level`.
- Modify `apps/web/src/docs/1.0.0/users.md`, `reports.md`.

---

### Task 1: API — complementary suppression and `meta.avg_level`

**Files:**
- Modify: `apps/api/src/routes/reports.ts` (lines ~64–125 helpers; `meta(...)` call sites at ~150, 201, 243, 292, 357, 424)
- Test: `apps/api/test/reports-small-groups.test.ts`

**Interfaces:**
- Produces: report rows may carry `suppressed: 'small' | 'complementary'`; every report `meta` has `avg_level: number | null`.

- [ ] **Step 1: Create the branch**

```bash
git checkout feat/workbook-import && git checkout -b feat/partner-complementary-suppression
```

- [ ] **Step 2: Update and extend the tests (RED)**

In `apps/api/test/reports-small-groups.test.ts`:

Change `HIDDEN`'s `suppressed: true` to `suppressed: 'small'`.

The existing fixture has Temeke Hospital departments Laboratory (3), Microbiology (2), X-Ray (0) — so the facility list has exactly one small row; Laboratory must now be hidden as complementary. Replace the first test with:

```ts
  it('hides small departments, plus a second row so the hidden one cannot be subtracted out', async () => {
    const res = await get(`/reports/facilities/${f1}`, monitor);
    expect(res.status).toBe(200);
    expect(row(res.body.items, 'department_id', mic)).toMatchObject(HIDDEN);
    expect(row(res.body.items, 'department_id', lab)).toMatchObject({ ...HIDDEN, suppressed: 'complementary' });
  });
```

In the region test, Dar es Salaam has districts Temeke (5) and Ilala (2): Ilala is small, so Temeke becomes complementary. Replace the region assertions with:

```ts
    const region = await get(`/reports/regions/${dsm}`, monitor);
    expect(row(region.body.items, 'district_id', ila)).toMatchObject(HIDDEN);
    expect(row(region.body.items, 'district_id', tmk)).toMatchObject({ ...HIDDEN, suppressed: 'complementary' });
```

Append these tests inside the same `describe`:

```ts
  it('hides nothing extra when two or more rows are already small', async () => {
    // Add a second small department (Pharmacy, 1 person) to Temeke Hospital.
    const pha = createDepartment('PHA', 'Pharmacy', [f1]);
    addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: pha, level: 2 });
    const res = await get(`/reports/facilities/${f1}`, monitor);
    expect(row(res.body.items, 'department_id', mic).suppressed).toBe('small');
    expect(row(res.body.items, 'department_id', pha).suppressed).toBe('small');
    expect(row(res.body.items, 'department_id', lab).suppressed).toBeUndefined();
    expect(row(res.body.items, 'department_id', lab).respondents).toBe(3);
  });

  it('picks the smallest remaining row as the complementary one', async () => {
    // Give Laboratory more people than a new 4-person Radiology department.
    addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: lab, level: 3 });
    addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: lab, level: 3 });
    const rad = createDepartment('RAD', 'Radiology', [f1]);
    for (let i = 0; i < 4; i++) {
      addResponse({ userId: createUser({ facilityId: f1 }), facilityId: f1, regionId: dsm, districtId: tmk, departmentId: rad, level: 2 });
    }
    const res = await get(`/reports/facilities/${f1}`, monitor);
    expect(row(res.body.items, 'department_id', mic).suppressed).toBe('small');
    expect(row(res.body.items, 'department_id', rad).suppressed).toBe('complementary');
    expect(row(res.body.items, 'department_id', lab).respondents).toBe(5);
  });

  it('reports the true average for the whole view in meta.avg_level', async () => {
    // Temeke Hospital: levels 2,3,4 (Laboratory) + 1,4 (Microbiology) → 14 / 5 = 2.8
    const asAdmin = await get(`/reports/facilities/${f1}`, admin);
    expect(asAdmin.body.meta.avg_level).toBeCloseTo(2.8);
    const asPartner = await get(`/reports/facilities/${f1}`, monitor);
    expect(asPartner.body.meta.avg_level).toBeCloseTo(2.8);
  });

  it('hides the average from partners when the whole view has fewer than 3 respondents', async () => {
    const asPartner = await get(`/reports/districts/${ila}`, monitor);
    expect(asPartner.body.meta.total_respondents).toBe(2);
    expect(asPartner.body.meta.avg_level).toBeNull();
    const asAdmin = await get(`/reports/districts/${ila}`, admin);
    expect(asAdmin.body.meta.avg_level).toBeCloseTo(2.5);
  });
```

- [ ] **Step 3: Run to verify failures**

Run: `pnpm --filter @workforce-competency/api test -- reports-small-groups`
Expected: FAIL — `suppressed` is `true`, no complementary rows, `meta.avg_level` undefined. The admin/staff tests still pass.

- [ ] **Step 4: Implement**

In `apps/api/src/routes/reports.ts`, replace the comment above `MIN_GROUP_SIZE`, the constants and the `suppressSmallGroups` function with:

```ts
// Partner (monitor) users see aggregates only. A bucket built from fewer than
// MIN_GROUP_SIZE people would expose those people's results, so its counts
// are blanked and the row is flagged `suppressed: 'small'`. Empty buckets are
// left as-is.
//
// A single hidden row could still be recovered as `parent total − visible
// rows`, so when exactly one row is hidden the smallest other non-empty row is
// hidden too (`suppressed: 'complementary'`). Lists arrive ordered by name, so
// ties go to the first by name.
const MIN_GROUP_SIZE = 3;
const BLANK_COUNTS = {
  respondents: 0, total_responses: 0, avg_level: null,
  count_na: 0, count_beginner: 0, count_competent: 0, count_proficient: 0, count_expert: 0,
};

type Suppression = 'small' | 'complementary';

function suppressSmallGroups<T extends Record<string, unknown>>(scope: Scope, items: T[]): T[] {
  if (scope.role !== 'monitor') return items;
  const count = (item: T) => Number(item.respondents ?? 0);

  const hidden = new Map<number, Suppression>();
  items.forEach((item, i) => {
    const n = count(item);
    if (n > 0 && n < MIN_GROUP_SIZE) hidden.set(i, 'small');
  });

  if (hidden.size === 1) {
    let pick = -1;
    items.forEach((item, i) => {
      if (hidden.has(i) || count(item) === 0) return;
      if (pick === -1 || count(item) < count(items[pick])) pick = i;
    });
    if (pick !== -1) hidden.set(pick, 'complementary');
  }

  return items.map((item, i) => {
    const kind = hidden.get(i);
    return kind ? { ...item, ...BLANK_COUNTS, suppressed: kind } : item;
  });
}

// The view-wide average is hidden from partners when the view itself is a
// small group (1–2 people), for the same reason rows are.
function viewAvg(scope: Scope, counts: { total: number; avg: number | null }): number | null {
  if (scope.role === 'monitor' && counts.total > 0 && counts.total < MIN_GROUP_SIZE) return null;
  return counts.avg;
}
```

Replace `meta`:

```ts
function meta(f: CommonFilters, totalRespondents: number, unassigned: number, avgLevel: number | null = null) {
  return {
    total_respondents: totalRespondents,
    unassigned_respondents: unassigned,
    avg_level: avgLevel,
    generated_at: new Date().toISOString(),
    filters: {
      domain_code: f.domainCode,
      competency_value: f.competencyValue,
      approved_only: f.approvedOnly,
    },
  };
}
```

In `respondentCounts`, change the return type to `{ total: number; unassigned: number; avg: number | null }`, add `AVG(CASE WHEN uar.response_level > 0 THEN uar.response_level END) AS avg_level` to the SELECT (after the `unassigned` column), widen the row type to include `avg_level: number | null`, and return:

```ts
  return { total: row?.total ?? 0, unassigned: row?.unassigned ?? 0, avg: row?.avg_level ?? null };
```

Update the call sites to pass the average:

| Endpoint | New `meta(...)` |
|---|---|
| national (~150) | `meta(f, counts.total, counts.unassigned, viewAvg(scope, counts))` |
| region (~201) | `meta(f, counts.total, counts.unassigned, viewAvg(scope, counts))` |
| district (~243) | `meta(f, counts.total, counts.unassigned, viewAvg(scope, counts))` |
| facility (~292) | `meta(f, counts.total, counts.unassigned, viewAvg(scope, counts))` |
| department (~357) | `meta(f, counts.total, 0, viewAvg(scope, counts))` |
| individual (~424) | unchanged (`meta(f, 1, 0)`; avg defaults to null — the individual report has its own averages) |

Every listed endpoint already has `scope` in its handler.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @workforce-competency/api test`
Expected: PASS (all files).
Run: `pnpm --filter @workforce-competency/api typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/reports.ts apps/api/test/reports-small-groups.test.ts
git commit -m "feat(api): complementary suppression and view-wide average for partner reports"
```

---

### Task 2: Web — labels per suppression kind and KPI average from the API

**Files:**
- Modify: `apps/web/src/types/reports.ts` (`MaturityCounts.suppressed`, `ReportMeta`)
- Create: `apps/web/src/lib/reports/privacy.ts`, `apps/web/src/lib/reports/privacy.test.ts`
- Modify: `apps/web/src/components/reports/MaturityBreakdownTable.tsx` (row cells ~lines 70–84)
- Modify: `apps/web/src/lib/reports/export-excel.ts` (`countColumns`), `apps/web/src/lib/reports/export-excel.test.ts`
- Modify: `apps/web/src/lib/reports/export-pdf.ts` (`countCells`)
- Modify: `apps/web/src/components/reports/levels/{National,Region,District,Facility,Department}Report.tsx`

**Interfaces:**
- Consumes: Task 1's `suppressed` values and `meta.avg_level`.
- Produces: `suppressionText(kind)` → `{ count: string; note: string; export: string }`.

- [ ] **Step 1: Types**

In `apps/web/src/types/reports.ts`, replace the `suppressed?: boolean;` field and its comment in `MaturityCounts` with:

```ts
  // Partner view only. 'small': the bucket has 1–2 respondents. 'complementary':
  // hidden as well so a lone small bucket can't be recovered by subtraction.
  // Counts are blanked (zero, avg null) by the API. Absent on visible rows.
  suppressed?: 'small' | 'complementary';
```

In `ReportMeta`, after `unassigned_respondents: number;` add:

```ts
  // Average maturity over all respondents in the view (levels 1–4, N/A
  // excluded). Null when there are none, or for partners when the view has
  // only 1–2 respondents.
  avg_level: number | null;
```

- [ ] **Step 2: Write the failing label tests**

Create `apps/web/src/lib/reports/privacy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { suppressionText } from "./privacy";

describe("suppressionText", () => {
  it("explains small groups", () => {
    expect(suppressionText("small")).toEqual({
      count: "<3",
      note: "Fewer than 3 respondents — hidden for privacy",
      export: "Fewer than 3",
    });
  });

  it("explains complementary hiding without claiming fewer than 3", () => {
    expect(suppressionText("complementary")).toEqual({
      count: "—",
      note: "Hidden for privacy",
      export: "Hidden for privacy",
    });
  });
});
```

In `apps/web/src/lib/reports/export-excel.test.ts`: add `avg_level: null,` to the shared `meta` fixture (it is now a required `ReportMeta` field), change the existing hidden-row fixture's `suppressed: true` to `suppressed: "small"`, and add:

```ts
  it("labels complementary rows as hidden for privacy", () => {
    const r: RegionReportResponse = {
      level: "region", region: { id: 1, name: "Dar es Salaam" },
      items: [{
        district_id: 7, district_name: "Temeke", suppressed: "complementary",
        respondents: 0, total_responses: 0, avg_level: null,
        count_na: 0, count_beginner: 0, count_competent: 0, count_proficient: 0, count_expert: 0,
      }],
      undistricted_facilities: [], meta,
    };
    expect(breakdown(buildWorkbook(r))[0]).toMatchObject({ District: "Temeke", Respondents: "Hidden for privacy" });
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @workforce-competency/web test -- privacy export-excel`
Expected: FAIL — `./privacy` not found; complementary label missing.

- [ ] **Step 4: Implement the labels**

Create `apps/web/src/lib/reports/privacy.ts`:

```ts
import type { MaturityCounts } from "@/types/reports";

type Suppression = NonNullable<MaturityCounts["suppressed"]>;

// Wording for report rows the API hid from partner users.
export function suppressionText(kind: Suppression): { count: string; note: string; export: string } {
  return kind === "small"
    ? { count: "<3", note: "Fewer than 3 respondents — hidden for privacy", export: "Fewer than 3" }
    : { count: "—", note: "Hidden for privacy", export: "Hidden for privacy" };
}
```

In `apps/web/src/components/reports/MaturityBreakdownTable.tsx`, import `suppressionText` from `@/lib/reports/privacy`, then in the row:
- replace the note span's text `Fewer than 3 respondents — hidden for privacy` with `{suppressionText(r.suppressed).note}` (it is already inside `{r.suppressed && (...)}`);
- replace `{r.suppressed ? '<3' : r.respondents}` with `{r.suppressed ? suppressionText(r.suppressed).count : r.respondents}`.

The other cells keep `r.suppressed ? '—' : …` (truthiness works for both kinds).

In `apps/web/src/lib/reports/export-excel.ts` `countColumns`, change `Respondents: 'Fewer than 3'` to `Respondents: suppressionText(i.suppressed).export` (import `suppressionText`).

In `apps/web/src/lib/reports/export-pdf.ts` `countCells`, change the first array element `'Fewer than 3'` to `suppressionText(i.suppressed).export` (import `suppressionText`).

- [ ] **Step 5: KPI average from the API**

In each of `RegionReport.tsx`, `DistrictReport.tsx`, `FacilityReport.tsx`, `DepartmentReport.tsx`, delete the `totalResp` and `avgLevel` constants and pass `avgLevel={data.meta.avg_level}` to `ReportKpiCards`. In `NationalReport.tsx`, delete the `avgLevel` constant and pass `avgLevel={data.meta.avg_level}`. Keep each file's `covered` / `coveredRegions` computation unchanged.

- [ ] **Step 6: Test, typecheck, build**

Run: `pnpm --filter @workforce-competency/web test`
Expected: PASS.
Run: `pnpm --filter @workforce-competency/web typecheck`
Expected: no errors (if anything else builds a `ReportMeta` literal, add `avg_level`).
Run: `pnpm --filter @workforce-competency/web build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): label complementary hiding and use the API's view-wide average"
```

---

### Task 3: Docs, verification, merge

**Files:**
- Modify: `apps/web/src/docs/1.0.0/users.md` (Partner section bullet about 1–2 respondents)
- Modify: `apps/web/src/docs/1.0.0/reports.md` (Partner bullet)

- [ ] **Step 1: Docs**

In `users.md`, replace the bullet beginning "To protect individuals" with:

```markdown
- To protect individuals, any department, facility or district with only 1 or
  2 respondents shows as "Fewer than 3 respondents" for partners. When that
  would leave a single hidden row in a list, one more row is hidden ("Hidden
  for privacy") so the hidden results can't be worked out by subtraction.
  This applies on screen and in exports. Admins and staff still see the numbers.
```

In `reports.md`, replace the two lines starting "Rows with only 1 or 2 respondents" with:

```markdown
  Rows with only 1 or 2 respondents are shown as "Fewer than 3 respondents";
  if that leaves one hidden row in a list, another is hidden too ("Hidden for
  privacy") so totals can't reveal it.
```

- [ ] **Step 2: Full verification**

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
All must pass.

- [ ] **Step 3: Commit, merge to main**

```bash
git add apps/web/src/docs/1.0.0/users.md apps/web/src/docs/1.0.0/reports.md
git commit -m "docs: complementary hiding for partner reports"
git checkout main
git merge --no-ff feat/partner-complementary-suppression -m "Merge branch 'feat/partner-complementary-suppression': close the partner subtraction gap"
```

Re-run the four commands above on `main`, then `git branch -d feat/partner-complementary-suppression` and `git checkout feat/workbook-import && git merge --ff-only main` so the import work builds on it. (Pushing is left to the user.)
