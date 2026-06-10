# Survey UX Tweaks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the skill level (bold) before each survey answer, render per-page footnotes from authored symbol definitions, and add a Purpose + Introduction to each domain's Start page.

**Architecture:** Pure survey-model construction is extracted into a testable `apps/web/src/lib/survey/build.ts` module (unit-tested with Vitest). New per-domain content (`purpose`, `introduction`, footnotes) is stored in SQLite via a new migration, exposed by the assessments API, seeded from CSV through the existing admin import flow, and consumed by `SurveyPage`.

**Tech Stack:** React 19 + Vite, SurveyJS (`survey-core`/`survey-react-ui`), Express 5 + sql.js (SQLite), Vitest (new, web pure-logic only), Playwright (existing e2e).

**Verification model (per the agreed decision):** Vitest unit tests for the pure survey logic in `apps/web`. Migration + API routes verified by `tsc --noEmit` and a Playwright e2e that imports data and asserts the rendered survey. There is no API unit-test runner and this plan does not add one.

**Spec:** `docs/superpowers/specs/2026-06-10-survey-ux-tweaks-design.md`

---

## File Structure

**Created:**
- `apps/web/vitest.config.ts` — Vitest config (node env, no DOM).
- `apps/web/src/lib/survey/build.ts` — pure builders: bold markdown, footnote matching, intro/footnote HTML, full SurveyJS model JSON.
- `apps/web/src/lib/survey/build.test.ts` — Vitest unit tests for the above.
- `apps/web/public/data/assessment_data/footnotes.csv` — seed footnotes (Informatics filled, others a template).
- `apps/web/e2e/survey.spec.ts` — e2e: import data, assert intro/bold/footnote render.

**Modified:**
- `apps/api/src/db/migrations.ts` — append migration id 8 (domain columns + footnotes table).
- `apps/api/src/routes/assessments.ts` — quoted-CSV parser, domain intro fields, footnote routes.
- `apps/web/src/pages/SurveyPage.tsx` — use `build.ts`, fetch footnotes, register `onTextMarkdown`.
- `apps/web/src/pages/AssessmentsPage.tsx` — domain Purpose/Introduction fields; footnotes import + list.
- `apps/web/package.json` — add `vitest` devDep + `test` script.
- `apps/web/public/data/assessment_data/assessment_data.csv` — add `purpose`,`introduction` columns (Informatics filled).

---

## Task 1: Add Vitest to the web app

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/vitest.config.ts`

- [ ] **Step 1: Add the Vitest dev dependency and test script**

In `apps/web/package.json`, add to `scripts` (after the `"e2e:ui"` line):

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

In `devDependencies`, add:

```json
    "vitest": "^3.0.0",
```

- [ ] **Step 2: Install**

Run (from repo root): `pnpm install`
Expected: completes; `apps/web/node_modules/.bin/vitest` exists.

- [ ] **Step 3: Create the Vitest config**

Create `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

// Pure-logic unit tests only (no DOM). Survey builders return strings/objects,
// so the default node environment is sufficient — no jsdom needed.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Verify the runner starts (no tests yet)**

Run (from `apps/web`): `pnpm test`
Expected: Vitest runs and reports "No test files found" (exit 0 or the "no tests" notice). This confirms the runner is wired before any test exists.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(web): add Vitest for pure-logic unit tests"
```

---

## Task 2: Database migration — domain intro columns + footnotes table

**Files:**
- Modify: `apps/api/src/db/migrations.ts` (append after the migration id 7 entry, inside the `migrations` array)

- [ ] **Step 1: Append migration id 8**

In `apps/api/src/db/migrations.ts`, add this object as the new last element of the `migrations` array (after the `{ id: 7, … }` entry, before the closing `]`):

```ts
  {
    id: 8,
    sql: `
      -- Per-domain intro content shown on the survey Start page.
      ALTER TABLE assessment_domains ADD COLUMN purpose      TEXT;
      ALTER TABLE assessment_domains ADD COLUMN introduction TEXT;

      -- Authored footnote symbol → definition pairs, shown on a survey page
      -- when the symbol appears in that page's text.
      CREATE TABLE IF NOT EXISTS assessment_footnotes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_id   INTEGER NOT NULL REFERENCES assessment_domains(id) ON DELETE CASCADE,
        symbol      TEXT    NOT NULL,
        definition  TEXT    NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_footnotes_domain
        ON assessment_footnotes(domain_id);
    `,
  },
```

- [ ] **Step 2: Typecheck the API**

Run (from `apps/api`): `pnpm typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Apply the migration at runtime**

Start the API once so `runMigrations` applies id 8. Run (from `apps/api`): `pnpm dev`
Expected: console logs `[db] migration 8 applied`. Stop the server (Ctrl-C) after the line appears.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations.ts
git commit -m "feat(api): migration 8 — domain intro columns + footnotes table"
```

---

## Task 3: API — quoted-CSV parser

The current `parseCsv` splits on every comma, so long text (intro/definition) containing commas is corrupted. Upgrade it to handle RFC-4180-style double-quoted fields. This is verified by typecheck now and by the Task 10 e2e (which imports quoted CSV).

**Files:**
- Modify: `apps/api/src/routes/assessments.ts:36-48` (the `parseCsv` function)

- [ ] **Step 1: Replace `parseCsv` with a quote-aware parser**

Replace the existing `parseCsv` function (the comment block + function, lines ~36-48) with:

```ts
// CSV parser supporting RFC-4180 double-quoted fields: quoted fields may
// contain commas, newlines, and escaped quotes (""). Unquoted fields are
// trimmed; quoted fields preserve their interior whitespace.
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let fieldWasQuoted = false;

  const pushField = () => {
    record.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };
  const pushRecord = () => {
    pushField();
    // Skip wholly-empty lines.
    if (record.length > 1 || record[0] !== "") records.push(record);
    record = [];
  };

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRecord();
    } else {
      field += ch;
    }
  }
  // Trailing field/record (no final newline).
  if (field !== "" || record.length > 0) pushRecord();

  if (records.length < 2) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  return { headers, rows: records.slice(1) };
}
```

- [ ] **Step 2: Typecheck the API**

Run (from `apps/api`): `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/assessments.ts
git commit -m "fix(api): quote-aware CSV parser for fields containing commas"
```

---

## Task 4: API — domain intro fields (type, create, update, import upsert)

**Files:**
- Modify: `apps/api/src/routes/assessments.ts` (`DomainRow` interface ~6-13; `POST /domains` ~72-94; `PUT /domains/:id` ~121-150; `POST /domains/import` ~96-119)

- [ ] **Step 1: Add intro fields to `DomainRow`**

In the `DomainRow` interface, add after `version: number;`:

```ts
  purpose: string | null;
  introduction: string | null;
```

- [ ] **Step 2: Accept `purpose`/`introduction` on create**

In `POST /domains`, change:

```ts
    const { code, name, version = 1 } = req.body as {
      code?: string; name?: string; version?: number;
    };
    if (!code || !name) return next(createError('code and name are required', 400));
    try {
      execute(
        'INSERT INTO assessment_domains (code, name, version) VALUES (?, ?, ?)',
        [code.toUpperCase(), name, version],
      );
```

to:

```ts
    const { code, name, version = 1, purpose = null, introduction = null } = req.body as {
      code?: string; name?: string; version?: number; purpose?: string | null; introduction?: string | null;
    };
    if (!code || !name) return next(createError('code and name are required', 400));
    try {
      execute(
        'INSERT INTO assessment_domains (code, name, version, purpose, introduction) VALUES (?, ?, ?, ?, ?)',
        [code.toUpperCase(), name, version, purpose, introduction],
      );
```

- [ ] **Step 3: Accept `purpose`/`introduction` on update**

In `PUT /domains/:id`, change the destructure:

```ts
    const {
      code = existing.code,
      name = existing.name,
      version = existing.version,
    } = req.body as { code?: string; name?: string; version?: number };
```

to:

```ts
    const {
      code = existing.code,
      name = existing.name,
      version = existing.version,
      purpose = existing.purpose,
      introduction = existing.introduction,
    } = req.body as { code?: string; name?: string; version?: number; purpose?: string | null; introduction?: string | null };
```

and change the UPDATE statement:

```ts
      execute(
        `UPDATE assessment_domains SET code = ?, name = ?, version = ?, updated_at = datetime('now') WHERE id = ?`,
        [code.toUpperCase(), name, version, id],
      );
```

to:

```ts
      execute(
        `UPDATE assessment_domains SET code = ?, name = ?, version = ?, purpose = ?, introduction = ?, updated_at = datetime('now') WHERE id = ?`,
        [code.toUpperCase(), name, version, purpose, introduction, id],
      );
```

- [ ] **Step 4: Upsert intro fields on import**

The current `POST /domains/import` INSERTs and skips existing domains, so it can never add intro text to a domain that already exists. Change it to update `purpose`/`introduction` when the domain already exists. Replace the loop body in `POST /domains/import`:

```ts
    let imported = 0, skipped = 0;
    for (const row of rows) {
      const code = row[codeIdx]?.toUpperCase();
      const name = row[nameIdx];
      if (!code || !name) { skipped++; continue; }
      try {
        execute('INSERT INTO assessment_domains (code, name) VALUES (?, ?)', [code, name]);
        imported++;
      } catch {
        skipped++;
      }
    }
    res.json({ imported, skipped });
```

with:

```ts
    const purposeIdx = headers.indexOf('purpose');
    const introIdx = headers.indexOf('introduction');
    let imported = 0, updated = 0, skipped = 0;
    for (const row of rows) {
      const code = row[codeIdx]?.toUpperCase();
      const name = row[nameIdx];
      if (!code || !name) { skipped++; continue; }
      const purpose = purposeIdx === -1 ? null : (row[purposeIdx] ?? null);
      const introduction = introIdx === -1 ? null : (row[introIdx] ?? null);
      const [existing] = query<DomainRow>(
        'SELECT * FROM assessment_domains WHERE code = ? COLLATE NOCASE',
        [code],
      );
      if (existing) {
        execute(
          `UPDATE assessment_domains SET name = ?, purpose = ?, introduction = ?, updated_at = datetime('now') WHERE id = ?`,
          [name, purpose, introduction, existing.id],
        );
        updated++;
      } else {
        execute(
          'INSERT INTO assessment_domains (code, name, purpose, introduction) VALUES (?, ?, ?, ?)',
          [code, name, purpose, introduction],
        );
        imported++;
      }
    }
    res.json({ imported, updated, skipped });
```

- [ ] **Step 5: Typecheck the API**

Run (from `apps/api`): `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/assessments.ts
git commit -m "feat(api): domain purpose/introduction on create, update, and import upsert"
```

---

## Task 5: API — footnote routes

**Files:**
- Modify: `apps/api/src/routes/assessments.ts` (add `FootnoteRow` interface near `ItemRow`; add routes before `export default router;`)

- [ ] **Step 1: Add the `FootnoteRow` interface**

After the `ItemRow` interface (before `const router = Router();`), add:

```ts
interface FootnoteRow extends Record<string, unknown> {
  id: number;
  domain_id: number;
  symbol: string;
  definition: string;
  sort_order: number;
  created_at: string;
}
```

- [ ] **Step 2: Add the footnote routes**

Immediately before `export default router;`, add:

```ts
// ── Footnotes ───────────────────────────────────────────────────────────────

router.get('/domains/:id/footnotes', (req: Request, res: Response, next: NextFunction) => {
  try {
    const domainId = Number(req.params.id);
    const [domain] = query<DomainRow>('SELECT id FROM assessment_domains WHERE id = ?', [domainId]);
    if (!domain) return next(createError('Domain not found', 404));
    const footnotes = query<FootnoteRow>(
      'SELECT * FROM assessment_footnotes WHERE domain_id = ? ORDER BY sort_order ASC, id ASC',
      [domainId],
    );
    res.json({ footnotes });
  } catch (err) { next(err); }
});

router.post('/domains/:id/footnotes', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const domainId = Number(req.params.id);
    const [domain] = query<DomainRow>('SELECT id FROM assessment_domains WHERE id = ?', [domainId]);
    if (!domain) return next(createError('Domain not found', 404));
    const { symbol, definition, sort_order = 0 } = req.body as Partial<FootnoteRow>;
    if (!symbol || !definition) return next(createError('symbol and definition are required', 400));
    execute(
      'INSERT INTO assessment_footnotes (domain_id, symbol, definition, sort_order) VALUES (?, ?, ?, ?)',
      [domainId, symbol, definition, sort_order],
    );
    const [footnote] = query<FootnoteRow>(
      'SELECT * FROM assessment_footnotes WHERE domain_id = ? ORDER BY id DESC LIMIT 1',
      [domainId],
    );
    res.status(201).json({ footnote });
  } catch (err) { next(err); }
});

// Replace-all import: clears the domain's footnotes, then inserts the CSV rows.
// Makes re-importing idempotent. CSV columns: symbol, definition, sort_order.
router.post('/domains/:id/footnotes/import', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const domainId = Number(req.params.id);
    const [domain] = query<DomainRow>('SELECT id FROM assessment_domains WHERE id = ?', [domainId]);
    if (!domain) return next(createError('Domain not found', 404));
    const { csv } = req.body as { csv?: string };
    if (!csv) return next(createError('csv is required', 400));
    const { headers, rows } = parseCsv(csv);
    const symIdx = headers.indexOf('symbol');
    const defIdx = headers.indexOf('definition');
    const sortIdx = headers.indexOf('sort_order');
    if (symIdx === -1 || defIdx === -1)
      return next(createError('CSV must have columns: symbol, definition', 400));
    execute('DELETE FROM assessment_footnotes WHERE domain_id = ?', [domainId]);
    let imported = 0, skipped = 0;
    for (let i = 0; i < rows.length; i++) {
      const symbol = rows[i][symIdx];
      const definition = rows[i][defIdx];
      if (!symbol || !definition) { skipped++; continue; }
      const parsedSort = sortIdx === -1 ? i : Number(rows[i][sortIdx] || i);
      execute(
        'INSERT INTO assessment_footnotes (domain_id, symbol, definition, sort_order) VALUES (?, ?, ?, ?)',
        [domainId, symbol, definition, Number.isNaN(parsedSort) ? i : parsedSort],
      );
      imported++;
    }
    res.json({ imported, skipped });
  } catch (err) { next(err); }
});

router.put('/footnotes/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<FootnoteRow>('SELECT * FROM assessment_footnotes WHERE id = ?', [id]);
    if (!existing) return next(createError('Footnote not found', 404));
    const {
      symbol = existing.symbol,
      definition = existing.definition,
      sort_order = existing.sort_order,
    } = req.body as Partial<FootnoteRow>;
    execute(
      'UPDATE assessment_footnotes SET symbol = ?, definition = ?, sort_order = ? WHERE id = ?',
      [symbol, definition, sort_order, id],
    );
    const [footnote] = query<FootnoteRow>('SELECT * FROM assessment_footnotes WHERE id = ?', [id]);
    res.json({ footnote });
  } catch (err) { next(err); }
});

router.delete('/footnotes/:id', requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const [existing] = query<FootnoteRow>('SELECT id FROM assessment_footnotes WHERE id = ?', [id]);
    if (!existing) return next(createError('Footnote not found', 404));
    execute('DELETE FROM assessment_footnotes WHERE id = ?', [id]);
    res.json({ message: 'Footnote deleted' });
  } catch (err) { next(err); }
});
```

- [ ] **Step 3: Typecheck the API**

Run (from `apps/api`): `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/assessments.ts
git commit -m "feat(api): footnote CRUD + replace-all CSV import routes"
```

---

## Task 6: Web — pure survey-build module (TDD with Vitest)

This is the high-risk logic, so write the tests first.

**Files:**
- Create: `apps/web/src/lib/survey/build.ts`
- Test: `apps/web/src/lib/survey/build.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/survey/build.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  boldMarkdown,
  rawPageText,
  matchFootnotes,
  footnoteHtml,
  introHtml,
  buildSurveyJson,
  type SurveyItem,
  type Footnote,
} from "./build";

const item = (over: Partial<SurveyItem> = {}): SurveyItem => ({
  competency_value: "1",
  competency_text: "Competency one",
  subcompetency_value: "1.01",
  subcompetency_text: "Sub one",
  beginner: "Describes things",
  competent: "Verifies things",
  proficient: "Evaluates things",
  expert: "Designs things",
  na: "N/A",
  ...over,
});

describe("boldMarkdown", () => {
  it("converts **x** to <b>x</b>", () => {
    expect(boldMarkdown("**Beginner —** Describes")).toBe("<b>Beginner —</b> Describes");
  });
  it("leaves text without markers untouched", () => {
    expect(boldMarkdown("plain text")).toBe("plain text");
  });
  it("leaves a single stray asterisk untouched", () => {
    expect(boldMarkdown("protocols* and modules")).toBe("protocols* and modules");
  });
});

describe("matchFootnotes", () => {
  const fns: Footnote[] = [
    { symbol: "‡", definition: "Protocol def", sort_order: 2 },
    { symbol: "*", definition: "See Appendix B", sort_order: 1 },
    { symbol: "§", definition: "Unused", sort_order: 3 },
  ];
  it("returns only footnotes whose symbol appears, ordered by sort_order", () => {
    const out = matchFootnotes("uses protocols‡ and terms*", fns);
    expect(out.map((f) => f.symbol)).toEqual(["*", "‡"]);
  });
  it("returns empty when no symbols are present", () => {
    expect(matchFootnotes("no markers here", fns)).toEqual([]);
  });
});

describe("rawPageText", () => {
  it("includes answer text but not injected bold prefixes", () => {
    const text = rawPageText([item({ beginner: "marked*" })]);
    expect(text).toContain("marked*");
    expect(text).not.toContain("**");
  });
});

describe("footnoteHtml", () => {
  it("returns empty string for no footnotes", () => {
    expect(footnoteHtml([])).toBe("");
  });
  it("renders one row per footnote with symbol and definition", () => {
    const html = footnoteHtml([{ symbol: "*", definition: "See Appendix B", sort_order: 1 }]);
    expect(html).toContain("See Appendix B");
    expect(html).toContain("*");
  });
});

describe("introHtml", () => {
  it("includes name, code, and both sections when present", () => {
    const html = introHtml({ code: "INF", name: "Informatics", version: 1, purpose: "P text", introduction: "I text" });
    expect(html).toContain("Informatics");
    expect(html).toContain("INF");
    expect(html).toContain("Purpose");
    expect(html).toContain("P text");
    expect(html).toContain("Introduction");
    expect(html).toContain("I text");
  });
  it("omits sections that are empty/missing", () => {
    const html = introHtml({ code: "INF", name: "Informatics", version: 1 });
    expect(html).not.toContain("Purpose");
    expect(html).not.toContain("Introduction");
  });
});

describe("buildSurveyJson", () => {
  const domain = { code: "INF", name: "Informatics", version: 1, purpose: "P", introduction: "I" };
  it("puts the intro on the first (start) page", () => {
    const json = buildSurveyJson(domain, [item()], []);
    expect(json.firstPageIsStartPage).toBe(true);
    const startHtml = (json.pages[0].elements[0] as { html: string }).html;
    expect(startHtml).toContain("Informatics");
    expect(startHtml).toContain("Purpose");
  });
  it("prefixes each level choice in bold-markdown", () => {
    const json = buildSurveyJson(domain, [item()], []);
    const q = json.pages[1].elements[0] as { choices: { value: string; text: string }[] };
    expect(q.choices[0].text).toBe("**Beginner —** Describes things");
    expect(q.choices[4].text).toBe("N/A");
  });
  it("appends a footnote html element only when a symbol matches the page", () => {
    const fns: Footnote[] = [{ symbol: "*", definition: "See Appendix B", sort_order: 1 }];
    const withMark = buildSurveyJson(domain, [item({ beginner: "describes modules*" })], fns);
    const withoutMark = buildSurveyJson(domain, [item()], fns);
    const types = (p: { elements: { type: string }[] }) => p.elements.map((e) => e.type);
    expect(types(withMark.pages[1])).toContain("html");
    expect(types(withoutMark.pages[1])).not.toContain("html");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/web`): `pnpm test`
Expected: FAIL — cannot resolve `./build` / functions not defined.

- [ ] **Step 3: Implement the module**

Create `apps/web/src/lib/survey/build.ts`:

```ts
// Pure builders for the assessment SurveyJS model. Kept free of React/SurveyJS
// runtime imports so they can be unit-tested in a plain node environment.

export interface DomainMeta {
  code: string;
  name: string;
  version: number;
  purpose?: string | null;
  introduction?: string | null;
}

export interface SurveyItem {
  competency_value: string;
  competency_text: string;
  subcompetency_value: string;
  subcompetency_text: string;
  beginner: string;
  competent: string;
  proficient: string;
  expert: string;
  na: string;
}

export interface Footnote {
  symbol: string;
  definition: string;
  sort_order: number;
}

/** Convert **bold** markers to <b> tags. Leaves all other text untouched. */
export function boldMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

/**
 * All raw, human-authored text on a competency page (titles + answers), used
 * for footnote symbol detection. Excludes the injected "**Level —**" prefixes
 * so the bold markers never trigger the generic "*" footnote.
 */
export function rawPageText(items: SurveyItem[]): string {
  return items
    .map((it) =>
      [it.competency_text, it.subcompetency_text, it.beginner, it.competent, it.proficient, it.expert, it.na].join(" "),
    )
    .join(" ");
}

/** Footnotes whose symbol appears in the page text, ordered by sort_order. */
export function matchFootnotes(pageText: string, footnotes: Footnote[]): Footnote[] {
  return footnotes
    .filter((f) => f.symbol && pageText.includes(f.symbol))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** HTML for the per-page footnote block, or "" when there are no footnotes. */
export function footnoteHtml(footnotes: Footnote[]): string {
  if (footnotes.length === 0) return "";
  const rows = footnotes
    .map(
      (f) =>
        `<div class="flex gap-2 py-0.5"><span class="font-bold flex-none w-4">${f.symbol}</span><span>${f.definition}</span></div>`,
    )
    .join("");
  return `<div class="mt-3 border-t pt-2 text-xs text-muted-foreground leading-relaxed">${rows}</div>`;
}

/**
 * HTML for the domain Start page: name + code, then Purpose / Introduction
 * sections (each omitted when empty). Layout B — left-aligned, labeled.
 */
export function introHtml(domain: DomainMeta): string {
  const sections: string[] = [];
  if (domain.purpose && domain.purpose.trim()) {
    sections.push(
      `<div class="mt-4"><div class="text-xs font-bold uppercase tracking-wide text-primary">Purpose</div>` +
        `<div class="mt-1 text-sm leading-relaxed">${domain.purpose}</div></div>`,
    );
  }
  if (domain.introduction && domain.introduction.trim()) {
    sections.push(
      `<div class="mt-4"><div class="text-xs font-bold uppercase tracking-wide text-primary">Introduction</div>` +
        `<div class="mt-1 text-sm leading-relaxed text-muted-foreground">${domain.introduction}</div></div>`,
    );
  }
  return (
    `<div class="w-full max-w-2xl mx-auto px-2 py-4">` +
    `<div class="text-lg font-bold uppercase">${domain.name}</div>` +
    `<div class="text-xs text-muted-foreground">${domain.code} · v${domain.version}</div>` +
    sections.join("") +
    `</div>`
  );
}

/** Build the full SurveyJS model JSON from domain + items + footnotes. */
export function buildSurveyJson(domain: DomainMeta, items: SurveyItem[], footnotes: Footnote[]) {
  // Group items by competency_text, preserving first-seen order.
  const groups = new Map<string, SurveyItem[]>();
  for (const it of items) {
    const arr = groups.get(it.competency_text) ?? [];
    arr.push(it);
    groups.set(it.competency_text, arr);
  }

  const competencyPages = [...groups.entries()].map(([competencyText, groupItems]) => {
    const elements: Record<string, unknown>[] = groupItems.map((item) => ({
      type: "radiogroup",
      name: `${domain.code}-${domain.version}-${item.competency_value}-${item.subcompetency_value}`,
      title: `${item.subcompetency_value} - ${item.subcompetency_text}`,
      isRequired: true,
      choices: [
        { value: "beginner", text: `**Beginner —** ${item.beginner}` },
        { value: "competent", text: `**Competent —** ${item.competent}` },
        { value: "proficient", text: `**Proficient —** ${item.proficient}` },
        { value: "expert", text: `**Expert —** ${item.expert}` },
        { value: "na", text: item.na },
      ],
    }));

    const fnHtml = footnoteHtml(matchFootnotes(rawPageText(groupItems), footnotes));
    if (fnHtml) {
      elements.push({
        type: "html",
        name: `${domain.code}-fn-${groupItems[0].competency_value}`,
        html: fnHtml,
      });
    }

    return {
      name: `${domain.code}-${groupItems[0].competency_value}`,
      title: competencyText,
      elements,
    };
  });

  return {
    pages: [
      { elements: [{ type: "html", name: "intro", html: introHtml(domain) }] },
      ...competencyPages,
    ],
    pageNextText: "Next",
    completeText: "Submit",
    showPrevButton: false,
    firstPageIsStartPage: true,
    startSurveyText: "Start",
    completedHtml: `Thank you for completing the assessment!
          <div class="w-full flex items-center justify-center mt-4">
            <button id="startAgain" class="flex">New assessment</button>
          </div>`,
    showQuestionNumbers: true,
    requiredMark: "(*)",
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `apps/web`): `pnpm test`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/survey/build.ts apps/web/src/lib/survey/build.test.ts
git commit -m "feat(web): pure survey-model builders (bold, footnotes, intro) + tests"
```

---

## Task 7: Web — wire SurveyPage to the builder + footnotes + markdown

**Files:**
- Modify: `apps/web/src/pages/SurveyPage.tsx` (`AssessmentDomain` interface ~41-46; `data` query `queryFn` ~157-235; survey `useMemo` ~237-307)

- [ ] **Step 1: Import the builder and extend the domain interface**

Add near the other imports (after the `api` import on line 39):

```ts
import { buildSurveyJson, boldMarkdown } from "@/lib/survey/build";
```

In the `AssessmentDomain` interface, add after `version: number;`:

```ts
  purpose?: string | null;
  introduction?: string | null;
```

- [ ] **Step 2: Replace the inline model build with the builder + footnotes fetch**

In the `data` `useQuery`, replace the entire `queryFn` body (everything from `if (!domainCode || !domains) return null;` through the big returned object ending at `requiredMark: "(*)",` and its closing `};`) with:

```ts
      if (!domainCode || !domains) return null;

      const domain = domains.find((d) => d.code === domainCode);
      if (!domain) return null;

      const itemsRes = await api.get<{ items: AssessmentItem[] }>(
        `/assessments/domains/${domain.id}/items`,
      );
      if (itemsRes.error !== null) throw new Error(itemsRes.error);

      // Footnotes are optional: a failure here must not block the survey.
      const fnRes = await api.get<{ footnotes: { symbol: string; definition: string; sort_order: number }[] }>(
        `/assessments/domains/${domain.id}/footnotes`,
      );
      const footnotes = fnRes.error === null ? fnRes.data.footnotes : [];

      return buildSurveyJson(
        { code: domain.code, name: domain.name, version: domain.version, purpose: domain.purpose, introduction: domain.introduction },
        itemsRes.data.items,
        footnotes,
      );
```

> Note: this removes the local `groupedList` construction and the inline `pages`/`completedHtml` object — `buildSurveyJson` now owns all of it, including the identical `completedHtml` "New assessment" button the `onComplete` handler wires up.

- [ ] **Step 3: Register the markdown handler so the bold prefix renders**

In the survey `useMemo`, after `const _survey = new Model(data ?? undefined);` and before `_survey.onStarted.add(...)`, add:

```ts
    // Render the "**Level —**" prefix (and any other ** **) as bold. Only
    // touch strings that actually contain markers so plain titles/answers
    // pass through unchanged.
    _survey.onTextMarkdown.add((_sender: Model, options: { text: string; html: string }) => {
      if (options.text.includes("**")) options.html = boldMarkdown(options.text);
    });
```

- [ ] **Step 4: Typecheck the web app**

Run (from `apps/web`): `pnpm typecheck`
Expected: PASS. (If `onTextMarkdown`'s callback parameter type complains, the inline `{ text: string; html: string }` shape matches the relevant fields of SurveyJS's `TextMarkdownEvent`; keep it.)

- [ ] **Step 5: Run the unit tests (still green) + commit**

Run (from `apps/web`): `pnpm test`
Expected: PASS.

```bash
git add apps/web/src/pages/SurveyPage.tsx
git commit -m "feat(web): survey uses builder — bold levels, footnotes, domain intro"
```

---

## Task 8: Web — AssessmentsPage domain intro fields + footnotes import

**Files:**
- Modify: `apps/web/src/pages/AssessmentsPage.tsx` (`AssessmentDomain` interface ~76-83; `DomainFormDialog` ~120-219; the domains import hint; add a footnotes import dialog + button)

- [ ] **Step 1: Extend the admin `AssessmentDomain` interface**

In `AssessmentsPage.tsx`, add to the `AssessmentDomain` interface (after `version: number;`):

```ts
  purpose?: string | null;
  introduction?: string | null;
```

- [ ] **Step 2: Add Purpose + Introduction fields to the domain form**

In `DomainFormDialog`, add state after `const [version, setVersion] = useState("1");`:

```ts
  const [purpose, setPurpose] = useState("");
  const [introduction, setIntroduction] = useState("");
```

In the `useEffect` that resets fields on open, add after `setVersion(String(initial?.version ?? 1));`:

```ts
      setPurpose(initial?.purpose ?? "");
      setIntroduction(initial?.introduction ?? "");
```

In `handleSubmit`, change the `body` to include the new fields:

```ts
    const body = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      version: Number(version),
      purpose: purpose.trim() || null,
      introduction: introduction.trim() || null,
    };
```

In the JSX, after the Version `<Input>` block (inside the same `grid` div, before the grid's closing `</div>`), add:

```tsx
              <Label htmlFor="d-purpose" className="text-right text-sm self-start mt-2">
                Purpose
              </Label>
              <Textarea
                id="d-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Purpose statement shown on the Start page"
                rows={3}
              />

              <Label htmlFor="d-intro" className="text-right text-sm self-start mt-2">
                Introduction
              </Label>
              <Textarea
                id="d-intro"
                value={introduction}
                onChange={(e) => setIntroduction(e.target.value)}
                placeholder="Longer introduction shown on the Start page"
                rows={6}
              />
```

(`Textarea` is already imported at the top of `AssessmentsPage.tsx`.)

- [ ] **Step 3: Update the domains import hint to mention the new columns**

In `ImportDomainsDialog`, update the hint `<p>` describing required columns to:

```tsx
            Required columns: assessment_code, assessment_name. Optional: purpose, introduction.
```

- [ ] **Step 4: Add a footnotes import dialog component**

Near `ImportItemsDialog`, add:

```tsx
function ImportFootnotesDialog({
  open, onClose, domainId, onImported,
}: { open: boolean; onClose: () => void; domainId: number; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error("Select a CSV file first."); return; }
    setLoading(true);
    const csv = await readFileAsText(file);
    const res = await api.post<{ imported: number; skipped: number }>(
      `/assessments/domains/${domainId}/footnotes/import`, { csv },
    );
    setLoading(false);
    if (res.error !== null) { toast.error(res.error); return; }
    toast.success(`Imported ${res.data.imported} footnote(s), skipped ${res.data.skipped}.`);
    onImported();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Import footnotes</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <p className="text-sm text-muted-foreground">
            Replaces this domain's footnotes. Columns: symbol, definition. Optional: sort_order.
          </p>
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

- [ ] **Step 5: Mount the footnotes import button + dialog**

In the main page component, add state beside the existing `importItemsOpen` state:

```tsx
  const [importFootnotesOpen, setImportFootnotesOpen] = useState(false);
```

Next to the existing "Import Items" button (the items toolbar shown when a domain is selected), add:

```tsx
        {selectedId !== null && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
            onClick={() => setImportFootnotesOpen(true)}>
            <FileUp className="h-3.5 w-3.5" /> Import Footnotes
          </Button>
        )}
```

And beside the other mounted dialogs:

```tsx
        {selectedId !== null && (
          <ImportFootnotesDialog
            open={importFootnotesOpen}
            onClose={() => setImportFootnotesOpen(false)}
            domainId={selectedId}
            onImported={() => qc.invalidateQueries({ queryKey: ["assessments", selectedId, "items"] })}
          />
        )}
```

> Implementer note: match the exact JSX placement to the existing items toolbar/dialog block. `FileUp`, `Dialog*`, `Input`, `Button`, `toast`, `api`, `readFileAsText`, and `qc` (the `useQueryClient()` instance) are already imported/in scope in this file.

- [ ] **Step 6: Typecheck + commit**

Run (from `apps/web`): `pnpm typecheck`
Expected: PASS.

```bash
git add apps/web/src/pages/AssessmentsPage.tsx
git commit -m "feat(web): admin domain intro fields + footnotes CSV import"
```

---

## Task 9: Content — seed CSVs (Informatics filled, others templated)

**Files:**
- Modify: `apps/web/public/data/assessment_data/assessment_data.csv`
- Create: `apps/web/public/data/assessment_data/footnotes.csv`

- [ ] **Step 1: Add intro columns to `assessment_data.csv`**

Rewrite the header to add two columns. New header:

```
id,assessment_code,assessment_name,purpose,introduction
```

Fill the Informatics (`INF`, id 11) row's `purpose` and `introduction` from the user-provided copy, quoting both fields (they contain commas). The Informatics row (single physical line):

```
11,INF,Informatics,"The competencies in Informatics address the knowledge, skills, and abilities needed to systematically apply information science, computer science, and information technology to support public health practice, research, and learning.","Informatics is a broad field encompassing information science, information technology, algorithms, and social science. In addition to electronic recordkeeping and automated data management, informatics includes such activities as test analyses, clinical decision support, messaging, and knowledge management. Once thought of as a support function, the delivery of laboratory informatics services has now evolved to be a mission-critical and central component of laboratory operations. Health laboratory informatics must be cross-cutting, multisectoral, and interoperable to support a nationally integrated electronic laboratory reporting (ELR) system and electronic health record (EHR) system. Since all laboratories must rely on informatics capabilities and often have limited access to informaticians or informatics specialists, it is essential that all staff members maintain varying levels of informatics competencies."
```

All other rows keep their `id,code,name` and append `,,` (empty purpose + introduction) — e.g. `1,QMS,Quality Management System,,`.

- [ ] **Step 2: Create `footnotes.csv` with Informatics rows**

Create `apps/web/public/data/assessment_data/footnotes.csv`. The Informatics items use `*` (terms defined in Appendix B). Seed the generic marker plus any specific symbols actually used in the Informatics item text. Header + rows (definitions with commas are quoted):

```
domain_code,symbol,definition,sort_order
INF,*,This term is defined in Appendix B.,1
INF,‡,"Protocol: a set of technical rules for the transmission and receipt of information between computers.",2
```

> The other 19 domains are intentionally absent from `footnotes.csv` — the file documents the per-domain format. Add their rows when their copy is supplied. (Import is per-domain via the admin "Import Footnotes" button, so a single multi-domain file is split per-domain at author time, or imported one domain at a time.)

- [ ] **Step 3: Verify CSV parses (manual import smoke test)**

With API + web running and logged in as admin: open the Assessments admin page, import `assessment_data.csv` (domains) — confirm the toast reports `updated` for the existing Informatics row. Then select Informatics and import the Informatics rows of `footnotes.csv`. Confirm the toasts report expected counts and no error. (This exercises the Task 3 quoted-CSV parser end to end.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/public/data/assessment_data/assessment_data.csv apps/web/public/data/assessment_data/footnotes.csv
git commit -m "content: Informatics intro + footnotes; intro columns + footnotes template"
```

---

## Task 10: e2e — survey renders intro, bold levels, footnotes

**Files:**
- Create: `apps/web/e2e/survey.spec.ts`

This test seeds Informatics intro + footnotes through the admin API (using the page's authenticated request context — which also verifies the quoted-CSV parser), then drives the survey UI.

- [ ] **Step 1: Confirm the survey route path**

Open `apps/web/src/main.tsx` (or the router config it imports) and confirm the survey page path. The plan assumes `/survey`. If different, use the real path in Step 2.

- [ ] **Step 2: Write the e2e test**

Create `apps/web/e2e/survey.spec.ts` (replace `/survey` if Step 1 found a different path):

```ts
import { test, expect, Page } from "@playwright/test";
import { TEST_ADMIN_USERNAME, TEST_ADMIN_PASSWORD } from "./reset-admin-password";

async function login(page: Page) {
  await page.goto("/");
  await page.locator("#auth-login").fill(TEST_ADMIN_USERNAME);
  await page.locator("#auth-password").fill(TEST_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /login|sign in/i }).click();
  await expect(page.getByRole("link", { name: /reports/i }).first()).toBeVisible({ timeout: 10_000 });
}

test.describe("Survey UX tweaks", () => {
  test("intro, bold skill levels, and footnotes render for a seeded domain", async ({ page }) => {
    await login(page);

    // Find the Informatics domain id via the authenticated API.
    const domainsRes = await page.request.get("/api/assessments/domains");
    expect(domainsRes.ok()).toBeTruthy();
    const { domains } = await domainsRes.json();
    const inf = domains.find((d: { code: string }) => d.code === "INF");
    test.skip(!inf, "Informatics domain not seeded in this environment");

    // Seed intro (via update) + footnotes (via import). The quoted comma in
    // the footnote definition also exercises the CSV parser.
    const upd = await page.request.put(`/api/assessments/domains/${inf.id}`, {
      data: {
        purpose: "Purpose: applies information science to public health practice, research, and learning.",
        introduction: "Introduction: a broad field, mission-critical to the laboratory.",
      },
    });
    expect(upd.ok()).toBeTruthy();

    const imp = await page.request.post(`/api/assessments/domains/${inf.id}/footnotes/import`, {
      data: { csv: 'symbol,definition,sort_order\n*,"Defined in Appendix B, the glossary.",1\n' },
    });
    expect(imp.ok()).toBeTruthy();

    // Open the survey straight on Informatics.
    await page.goto("/survey?domain=INF");

    // Start page shows the intro sections.
    await expect(page.getByText(/^Purpose$/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/applies information science/i)).toBeVisible();
    await expect(page.getByText(/^Introduction$/i).first()).toBeVisible();

    // Start the questionnaire.
    await page.getByRole("button", { name: /^start$/i }).click();
    await expect(page.locator("#surveyContainer")).toBeVisible({ timeout: 10_000 });

    // Skill level renders in bold: a <b> tag containing "Beginner" exists.
    await expect(page.locator("#surveyContainer b", { hasText: /Beginner/ }).first())
      .toBeVisible({ timeout: 10_000 });

    // Footnote definition text appears somewhere on the page (the seeded "*").
    await expect(page.getByText(/Defined in Appendix B/i).first()).toBeVisible();
  });
});
```

- [ ] **Step 3: Run the e2e**

Ensure the API is running (`pnpm dev:api` from repo root) with migration 8 applied and Informatics items seeded. Then run (from `apps/web`): `pnpm e2e survey.spec.ts`
Expected: PASS (or `skip` if Informatics isn't seeded in the environment — the test self-skips rather than failing).

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/survey.spec.ts
git commit -m "test(e2e): survey intro, bold levels, and footnotes render"
```

---

## Task 11: Full verification pass

- [ ] **Step 1: Typecheck both packages**

Run (from repo root): `pnpm -r typecheck`
Expected: PASS for `@workforce-competency/api` and `@workforce-competency/web`.

- [ ] **Step 2: Run web unit tests**

Run (from `apps/web`): `pnpm test`
Expected: PASS — all `build.test.ts` cases green.

- [ ] **Step 3: Manual smoke (real app)**

With API + web running: import `assessment_data.csv` and Informatics `footnotes.csv` via the admin page, open the survey on Informatics, and confirm: (a) Start page shows Purpose + Introduction, (b) each answer begins with a bold level, (c) a footnote block appears at the bottom of pages whose text contains a marked term, (d) domains without intro/footnotes still show the plain Start page and no footnote block.

- [ ] **Step 4: Final commit (if any docs/codemap updates were made)**

```bash
git add -A
git commit -m "docs: survey UX tweaks verification notes"
```

---

## Self-Review Notes

- **Spec coverage:** skill-level bold (Tasks 6–7), footnotes sourcing/display (Tasks 5–7, 9), domain intro (Tasks 4, 6–9), storage via CSV+DB (Tasks 2, 4, 5, 9), admin management (Task 8), graceful degradation (`introHtml`/`footnoteHtml` empty handling + Task 6 tests + Task 11 step 3), CSV comma risk (Task 3). All spec sections map to a task.
- **Type consistency:** `DomainMeta`/`SurveyItem`/`Footnote` defined in Task 6 are reused verbatim in Task 7; `FootnoteRow`/`DomainRow` shapes in Tasks 4–5 match the migration columns in Task 2; the `?` index access in `buildSurveyJson` (`groupItems[0]`) mirrors the existing code's grouping.
- **Open risk carried from spec:** the generic `*` footnote shows on any page containing `*` (including existing stray `protocols*`); intended, verified in Task 11 step 3.
