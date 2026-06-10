# Survey UX Tweaks — Design Spec

**Date:** 2026-06-10
**Status:** Approved for planning
**Area:** Assessment survey (`apps/web` survey UI + `apps/api` assessments domain) 

## Background

After user testing of the assessment survey, three tweaks were requested:

1. **Skill level inline.** The redesigned survey dropped the colored Beginner→Expert
   scale that used to sit beside the answers, so the skill level is no longer visible.
   Users want the level shown at the start of each answer.
2. **Footnotes.** The survey tool should display footnotes (e.g. "‡ Protocol: a set of
   technical rules for the transmission and receipt of information between computers")
   at the bottom of question pages, defining marked terms used in that page's text.
3. **Domain intro.** The Start screen (the page with the Start button) should show
   introductory information about the domain — a Purpose statement and an Introduction.

The survey is built with **SurveyJS** (`survey-core` / `survey-react-ui`) in
`apps/web/src/pages/SurveyPage.tsx`. Assessment content lives in SQLite
(`assessment_domains`, `assessment_items`), seeded from CSV files under
`apps/web/public/data/assessment_data/` and loaded by an admin through the CSV-import
dialogs in `apps/web/src/pages/AssessmentsPage.tsx`.

## Decisions

Settled during brainstorming (visual mockups + follow-up questions):

- **Skill level format:** bold label prefix — `**Beginner —** Describes electronic
  modules…`. (Not brackets, not colored pills.)
- **Footnotes sourcing:** an authored list of `{symbol, definition}` rows per domain. A
  footnote shows on a page only when its symbol appears in that page's text. The generic
  "* This term is defined in Appendix B" is just one row.
- **Footnotes management:** CSV import + DB storage (no full in-app editing UI for v1),
  matching how items are managed.
- **Domain intro layout:** left-aligned with labeled "Purpose" and "Introduction"
  sections, Start button bottom-right (mockup option B).
- **Intro/footnote storage:** DB columns + a footnotes table, seeded from CSV via the
  existing admin import flow.
- **Scope:** wire the feature for all 20 domains. Seed **Informatics** from the copy the
  users provided. The other 19 domains need official copy supplied by the team — see
  Content & Scope below. The UI degrades gracefully when a domain has no intro/footnotes.

## Goals

- Show the skill level (bold) at the start of every answer choice in the survey.
- Render a per-page footnote block that lists only the symbol definitions relevant to
  that page.
- Show a Purpose + Introduction on the domain Start page.
- Keep all content admin-manageable through the existing CSV-import + DB pattern.

## Non-Goals

- A rich in-app editor for footnotes (CSV import is sufficient for v1).
- Authoring official intro/footnote copy for the 19 non-Informatics domains (that copy
  is a content dependency owned by the team).
- Reworking the answer scale into anything other than the current radio group.
- Auto-deriving footnotes by fuzzy-matching glossary terms against free text (rejected as
  noisy/fragile in favor of the authored symbol list).

## Architecture

The change spans four layers, each independently understandable and testable:

```
CSV source files  ──import──▶  API (assessments routes)  ──HTTP──▶  Survey UI (SurveyPage)
   (content)                       │                                    │
                                   ▼                                    ▼
                          SQLite schema (migration 8)          Admin UI (AssessmentsPage)
```

### 1. Data layer — `apps/api/src/db/migrations.ts`

Append a new migration (id 8). Append-only; never edit existing entries.

- `assessment_domains`: add columns
  - `purpose TEXT` (nullable)
  - `introduction TEXT` (nullable)
- New table `assessment_footnotes`:
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `domain_id INTEGER NOT NULL REFERENCES assessment_domains(id) ON DELETE CASCADE`
  - `symbol TEXT NOT NULL` — the marker that appears in item text (e.g. `*`, `‡`, `†`, `§`)
  - `definition TEXT NOT NULL`
  - `sort_order INTEGER NOT NULL DEFAULT 0`
  - `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
  - index on `domain_id`

`ALTER TABLE … ADD COLUMN` on `assessment_domains` is safe and consistent with migration
6's approach.

### 2. CSV source files — `apps/web/public/data/assessment_data/`

- Extend `assessment_data.csv` with two optional trailing columns: `purpose`,
  `introduction`. Existing importers tolerate extra columns (parser is positional by
  header lookup).
- New `footnotes.csv` with columns: `domain_code, symbol, definition, sort_order`.
- Seed Informatics rows (purpose + introduction text provided by users; footnote rows for
  the symbols actually used in the Informatics items, including the generic
  `*` → "This term is defined in Appendix B").

> **CSV parser note:** the API's `parseCsv` (`assessments.ts`) splits naively on commas and
> does not handle quoted fields containing commas. Purpose/introduction/definition text
> contains commas. The plan must address this — either (a) upgrade `parseCsv` to handle
> double-quoted fields, or (b) define these long-text columns to be quoted and parse
> accordingly. Decision deferred to the implementation plan; (a) is preferred because the
> competency CSVs already suffer from comma-splitting (visible as double-spaces in
> `informatics_competencies_v1.csv`).

### 3. API — `apps/api/src/routes/assessments.ts`

- `DomainRow` interface and all domain query responses already use `SELECT *`, so
  `purpose`/`introduction` flow through automatically. Add the fields to the TS interface.
- `POST /domains` and `PUT /domains/:id`: accept optional `purpose`, `introduction`.
- `POST /domains/import`: read optional `purpose` / `introduction` columns when present.
- New footnote routes (mirroring the items routes, admin-guarded where mutating):
  - `GET /domains/:id/footnotes` → `{ footnotes: FootnoteRow[] }` ordered by `sort_order`.
  - `POST /domains/:id/footnotes/import` → bulk insert from CSV (`symbol, definition, sort_order`).
  - `POST /domains/:id/footnotes`, `PUT /footnotes/:id`, `DELETE /footnotes/:id` for parity.

### 4. Admin UI — `apps/web/src/pages/AssessmentsPage.tsx`

- Domain editor sheet: add `Purpose` and `Introduction` `<Textarea>` fields, wired into the
  existing create/update calls.
- Footnotes: add a footnotes CSV-import dialog (reuse `ImportDialog`) and a simple read-only
  list of a domain's footnotes, consistent with the items UI. No inline footnote editor for v1.

### 5. Survey UI — `apps/web/src/pages/SurveyPage.tsx`

Three focused changes, all inside the existing `useQuery`/`useMemo` survey-model build.

**(a) Skill level — bold prefix.**
- When building `choices`, prepend the level label to each answer text:
  - `text: \`**Beginner —** ${item.beginner}\`` … `**Competent —**`, `**Proficient —**`,
    `**Expert —**`. The N/A choice keeps its plain text (or `**N/A**`).
- Register a markdown handler so SurveyJS renders the bold:
  ```ts
  _survey.onTextMarkdown.add((_s, opt) => {
    opt.html = opt.text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  });
  ```
  Content is trusted admin data, so a bold-only transform is acceptable; we do not inject
  arbitrary HTML beyond the `<b>` wrap.

**(b) Footnotes — per-page block.**
- Fetch footnotes for the selected domain (`GET /domains/:id/footnotes`) alongside items.
- For each competency page, gather all text on the page (the page/question titles + every
  choice text) into one string. For each footnote whose `symbol` appears as a substring of
  that string, include it. Skip the block entirely if no symbols match.
- Append the matched footnotes as a trailing `{ type: "html", html: … }` element on that
  page, rendered as a bordered footnote list (small, muted, symbol + definition rows),
  ordered by `sort_order`.
- Symbol matching is a plain substring test against the raw item text (symbols are authored
  to be distinctive: `*`, `†`, `‡`, `§`, `¶`).

**(c) Domain intro — Start page (layout B).**
- The first page is already the start page (`firstPageIsStartPage: true`) holding an HTML
  element with the domain name + code. Rebuild that HTML to add, when present:
  - a "Purpose" labeled section showing `domain.purpose`
  - an "Introduction" labeled section showing `domain.introduction`
  - left-aligned, Start button position unchanged.
- Omit a section when its field is empty so domains without copy fall back to today's
  minimal Start page.

## Content & Scope

- **Informatics:** fully seeded from the provided Purpose + Introduction text and footnote
  rows for the symbols used in its items.
- **Other 19 domains:** structurally supported but require official copy. Deliverable
  includes a filled `assessment_data.csv` (Informatics populated, others blank-but-present)
  and a `footnotes.csv` template. We will not invent authoritative competency copy.
- **Graceful degradation:** missing `purpose`/`introduction` → those sections are omitted;
  a domain with no footnote rows → no footnote blocks. No errors, no empty headers.

## Data Flow

1. Admin imports `assessment_data.csv` (domains + intro) and `footnotes.csv` via
   AssessmentsPage → API import endpoints → SQLite.
2. SurveyPage loads `/assessments/domains` (carries `purpose`/`introduction`),
   `/assessments/domains/:id/items`, and `/assessments/domains/:id/footnotes`.
3. The SurveyJS model is built: bold choice text + markdown handler, per-page footnote
   HTML blocks, and the intro Start page.

## Error Handling

- API footnote routes follow the existing `try/catch → next(createError)` pattern; unknown
  domain → 404.
- CSV import skips malformed rows (missing `symbol`/`definition`) and reports counts, as the
  existing imports do.
- Survey UI treats footnotes/intro as optional: a failed or empty footnotes fetch must not
  block the survey from rendering.

## Testing

- **Migration:** applying migration 8 creates the columns + table and is idempotent
  (re-run is a no-op via the `migrations` ledger).
- **API:** tests for domain import with the new columns, and for the footnotes
  list/import/CRUD routes (including 404 on unknown domain and malformed-row skipping).
- **Survey UI:** verify (1) bold rendering of the level prefix via `onTextMarkdown`,
  (2) footnote block appears only when a symbol is present on the page and lists the right
  rows in order, (3) intro sections render with content and are omitted when empty. Use the
  existing Playwright e2e harness (`apps/web/e2e`) where a full-render check adds value;
  otherwise focused unit-level checks on the page-building helpers.

## Open Questions / Risks

- **CSV comma handling** (see §2 note) — must be resolved in the plan; affects all
  long-text fields.
- **Symbol collisions:** `*` is common in prose. Authors must use it only as a deliberate
  marker; the generic "*" footnote will show on any page containing a `*`. Acceptable given
  authored content, but worth noting to content authors.
- **Existing stray `*`** in current competency CSVs (e.g. `protocols*`) will start
  triggering the generic Appendix-B footnote once seeded — intended, but verify it reads
  correctly.
