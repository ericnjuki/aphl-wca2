# LabWorkforce — web

Front end for **LabWorkforce**, a competency-assessment tool for laboratory workforces. Staff complete self-assessments against domain-specific frameworks, an admin reviews submissions, and results roll up from individuals through departments, facilities, regions and national level with charts and CSV / Excel / PDF export.

This package (`web/`) is the browser app. It pairs with the Express API in [`../api/`](../api/).

---

## Tech stack

| Concern | Choice |
|---|---|
| Framework | React 19 + React Router v7 |
| Bundler / dev server | Vite 6 |
| Language | TypeScript 5.7 |
| UI | shadcn/ui + Radix primitives + Tailwind v4 |
| State | Zustand (auth, report filters) + TanStack Query (server state) |
| Surveys | SurveyJS (`survey-react-ui`) |
| Charts | Recharts |
| Markdown | `react-markdown` + `remark-gfm` (in-app docs) |
| i18n | i18next (en, pt, sw) |
| Exports | `jspdf` + `jspdf-autotable`, `xlsx`, `html-to-image` |
| E2E | Playwright (`e2e/`) |
| Client storage | `@sqlite.org/sqlite-wasm` |

---

## Prerequisites

- Node 20+ (22 recommended)
- A running API — see [`../api/README`](../api) or just `cd ../api && npm run dev`

---

## Setup

```bash
npm install
npx playwright install chromium   # only needed once, for e2e tests
```

The first run will also pull Recharts, jsPDF, xlsx, and the rest of the chart / export stack.

### Environment

`web/.env` is already set up for local dev. Key knob:

```env
VITE_API_URL=/api/v1
```

This goes through Vite's dev proxy — the browser always talks to its own origin, Vite forwards `/api/**` to `http://127.0.0.1:3000`. No CORS drama, session cookies always stick. Change it only if the API lives on a different host in production.

---

## Running

```bash
npm run dev        # Vite on http://localhost:5573 (port hard-coded)
```

The `predev` hook runs `kill-port 5573` first so a stray / zombie Vite from a previous session can't hold the port. Vite is configured with `strictPort: true` — if the port is in use, Vite fails loudly instead of silently drifting to 5574.

Other scripts:

| Script | Purpose |
|---|---|
| `npm run build` | `tsc -b && vite build` — production bundle |
| `npm run preview` | Serve the built bundle |
| `npm run lint` | ESLint |
| `npm run e2e` | Playwright tests (headless) |
| `npm run e2e:ui` | Playwright UI mode |
| `npm run kill-dev` | Free port 5573 manually if anything lingers |

---

## Auth

Default seed admin (from [`api/src/db/seed.ts`](../api/src/db/seed.ts)) is `admin` / `APHLwca2024` on a **fresh** database. After first login the user is forced to change it.

For Playwright runs the admin password is hard-reset to `TestAdmin123!` by [`e2e/global-setup.ts`](./e2e/global-setup.ts) so tests are hermetic.

To get back to the seed password: delete `../api/data/workforce.db` and restart the API.

---

## Pages

| Path | Who sees | What |
|---|---|---|
| `/` | everyone | Survey — pick a domain and answer competency items |
| `/my-assessments` | everyone | History table of own assessments (Resume / View detail) |
| `/reports` | staff (scoped) / admin | National → Region → Facility → Department → Individual drill-down |
| `/reviews` | admin | Approve / reject completed submissions |
| `/assessments` | admin | Domain + item CRUD + CSV import |
| `/users` | admin | User CRUD + CSV import + temp password management |
| `/setup` | admin | Regions, facilities, departments, org roles, titles |
| `/docs` | everyone | In-app documentation (Getting Started + per-page guides) |

Drill-down report routes: `/reports/regions/:id`, `/reports/facilities/:id`, `/reports/departments/:id`, `/reports/users/:id`.

---

## Project layout

```
web/
├── src/
│   ├── pages/                     # Route components, one per page in the sidebar
│   ├── components/
│   │   ├── ui/                    # shadcn primitives + TablePagination, TableFillerRow
│   │   ├── admin-panel/           # Sidebar + navbar shell
│   │   ├── reports/               # Level components, legend, stacked-bar, breakdown table
│   │   ├── filters/               # Domain / Competency / Region / Facility selects
│   │   ├── my-assessments/        # (reserved — table-based view lives in pages/)
│   │   └── reviews/
│   ├── hooks/reports/             # TanStack Query hooks for each report level
│   ├── lib/
│   │   ├── api.ts                 # Tiny fetch wrapper (credentials: include, JSON)
│   │   └── reports/               # maturity constants, export-pdf, export-excel
│   ├── store/                     # Zustand slices (auth, reports-filters)
│   ├── types/                     # Shared API response types
│   ├── docs/                      # Markdown docs loaded via Vite `?raw`
│   ├── locales/                   # i18n JSON (en, pt, sw)
│   └── main.tsx                   # Router + providers
├── e2e/                           # Playwright specs + global-setup
├── public/
├── vite.config.ts                 # port: 5573, /api proxy, host: true
└── playwright.config.ts
```

---

## Reports data flow

1. User completes a survey on `/`. The SurveyJS JSON blob is POSTed to `/api/v1/survey/sessions/:id/complete`.
2. Backend extracts one row per subcompetency into `user_assessment_responses`, snapshotting the user's current `region_id` / `facility_id` / `department_id` so later transfers don't rewrite history.
3. Admin approves in `/reviews`. The session's `review_status` flips to `approved`.
4. `/reports/*` endpoints aggregate from `user_assessment_responses` with the **approved-only** filter on by default. Toggle it off to include pending / rejected submissions in the totals.

Maturity colour scale: `#DF203E` Beginner → `#A75BF7` Competent → `#7CB335` Proficient → `#59B4FD` Expert, with N/A as `#9CA3AF`.

---

## Table + pagination pattern

All data tables (Users, Reviews, Assessments, Setup, My Assessments) share:

- `<Table>` from shadcn with `h-full` on the wrapper, so the table claims its parent flex space.
- Sticky uppercase `text-xs` headers, row-click to edit, hover tint `rgba(70,130,180,0.08)`.
- `<TableFillerRow colSpan={N} show={rows>0} />` as the last row so the table visually reaches the pagination footer even when there's only one row.
- `<TablePagination>` with rows-per-page selector and first / prev / next / last buttons.

If you're building a new page with a list, follow [`UsersPage.tsx`](./src/pages/UsersPage.tsx) as the reference.

---

## End-to-end tests

```bash
cd ../api && npm run dev   # in one terminal
cd web && npm run e2e      # in another — Playwright auto-starts Vite, reuses if already up
```

`e2e/global-setup.ts` resets the admin password to `TestAdmin123!` before each run, so tests are deterministic even if you've changed the password during manual testing.

Current coverage:

- `Reports page loads without Maximum update depth error`
- `OpenLDR branding is gone from error pages`
- `Docs page renders Getting Started and lets you switch sections`
- `My assessments — Resume link takes you back into the survey`
- `My assessments — View detail opens the individual report without User not found`

---

## Port 5573

Fixed on purpose. Vite's default dance (5173 → 5174 → 5175 when ports are busy) causes stale browser tabs to talk to zombie servers, which burnt us repeatedly. `strictPort: true` + the `predev` port-killer makes "where is my app?" unambiguous.

If you need a different port for any reason, change `server.port` in [`vite.config.ts`](./vite.config.ts) AND [`playwright.config.ts`](./playwright.config.ts) AND the `kill-port` script argument in `package.json`. One source of truth is better than three drifting defaults.
