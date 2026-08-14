# LabWorkforce

A competency-assessment tool for laboratory workforces. Staff complete self-assessments against domain-specific frameworks (e.g. *Bioinformatics*, *Administrative Controls*), an admin reviews submissions, and results roll up from individuals through departments, facilities, regions and national level — with charts, PDF / Excel / CSV export, and an in-app documentation browser.

---

## Monorepo layout

This is a [Turborepo](https://turbo.build/) + pnpm workspace. Two apps under `apps/`:

| Package | Purpose | Stack |
|---|---|---|
| [`apps/api`](./apps/api) | Express REST API + SQLite (sql.js), sessions, auth | Express 5, TypeScript, ts-node, sql.js, express-session |
| [`apps/web`](./apps/web) | Browser UI — survey, reports, reviews, admin, docs | React 19, Vite, shadcn/ui, Tailwind v4, TanStack Query, Recharts, Playwright |

Full frontend details live in [`apps/web/README.md`](./apps/web/README.md).

---

## Prerequisites

- **Node.js 20+** (22 recommended)
- **pnpm 10+** — the repo pins `pnpm@10.15.1` via the `packageManager` field; use [Corepack](https://nodejs.org/api/corepack.html) or install pnpm globally:

  ```bash
  corepack enable
  # or
  npm install -g pnpm
  ```

That's it — no Docker, no Postgres, no external services. The API uses an on-disk SQLite file (`apps/api/data/workforce.db`) that's created automatically on first run.

---

## Setup

```bash
git clone <repo-url> workforce-competency
cd workforce-competency
pnpm install
```

The install pulls dependencies for both apps into a shared `pnpm-store` and pnpm symlinks them into each package's `node_modules`. **Do not** use `npm install` — it'll fight with the pnpm lockfile.

### First-time browser setup (for e2e tests)

```bash
pnpm --filter @workforce-competency/web exec playwright install chromium
```

Skip this if you don't plan to run tests.

---

## Running in development

### Both apps at once

```bash
pnpm dev
```

Turbo launches both in parallel. Default ports:

| Service | URL |
|---|---|
| API | http://localhost:3000 |
| Web | http://localhost:5573 |

The web proxies `/api/**` to the backend so the browser talks to its own origin (no CORS headaches, cookies just work). Open **http://localhost:5573** once both are up.

### One at a time

```bash
pnpm dev:api     # API only
pnpm dev:web     # Web only (requires API on :3000)
```

The web's `predev` hook frees port 5573 first so zombie Vite processes never block you. If something still looks stale, `pnpm kill-dev` clears the port manually.

---

## Default login

The API seeds an admin account on a fresh database:

- **Username** — `admin`
- **Password** — `APHLwca2024`

First login forces a password change. The seed only inserts if the user doesn't already exist — to reset, delete `apps/api/data/workforce.db` and restart the API.

For Playwright runs the admin password is hard-reset to `TestAdmin123!` before each test run, so tests are hermetic.

---

## Building for production

```bash
pnpm build
```

Turbo runs `tsc` on the API and `tsc -b && vite build` on the web. Outputs:

- `apps/api/dist/` — compiled JS, run with `pnpm --filter @workforce-competency/api start`
- `apps/web/dist/` — static bundle, serve with any static host or `pnpm --filter @workforce-competency/web preview`

For production (Docker, nginx, TLS, domain), see **[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)**. `pnpm run deploy` drives the whole thing interactively.

---

## Testing

End-to-end tests live in [`apps/web/e2e`](./apps/web/e2e). They:

1. Reset the admin password to `TestAdmin123!` via a direct SQLite write.
2. Launch Vite automatically if nothing is on :5573 (Playwright's `webServer`).
3. Expect the API to already be running — start it separately.

```bash
# Terminal A
pnpm dev:api

# Terminal B
pnpm e2e          # headless
pnpm e2e:ui       # interactive mode
```

Current coverage: reports page boots without the Zustand-v5 infinite-loop bug, Docs page renders markdown + switches sections, My Assessments Resume / View-detail links work, and the old OpenLDR branding is gone.

---

## Useful scripts (from the repo root)

| Command | What |
|---|---|
| `pnpm install` | Install the workspace |
| `pnpm dev` | Run API + web together (turbo) |
| `pnpm dev:api` / `dev:web` | Run one app |
| `pnpm build` | Build both apps |
| `pnpm typecheck` | `tsc --noEmit` across both packages |
| `pnpm lint` | ESLint (web; api is a noop for now) |
| `pnpm e2e` / `e2e:ui` | Playwright tests |
| `pnpm kill-dev` | Free port 5573 |
| `pnpm clean` | Remove `dist` + `node_modules` from everything |

---

## Architecture at a glance

```
┌──────────────────────┐     HTTP + session cookie     ┌──────────────────────┐
│  Browser (React)     │ ─────────────────────────────▶│  Express API         │
│  http://:5573        │ ◀──────────────────────────── │  http://:3000        │
│                      │         JSON responses         │                      │
│  Zustand (auth)      │                                │  requireAuth         │
│  TanStack Query      │                                │  requireAdmin        │
│  SurveyJS            │                                │  /reports, /reviews  │
│  Recharts            │                                │  /my-assessments     │
└──────────────────────┘                                │  /assessments, etc.  │
                                                       │                      │
                                                       │  sql.js (SQLite)     │
                                                       │  apps/api/data/*.db  │
                                                       └──────────────────────┘
```

Survey responses are captured at submission time as granular per-subcompetency rows (`user_assessment_responses`) with the user's facility / department / region snapshotted. Reports aggregate over those rows with an approved-only filter on by default; an admin approves via `/reviews`, and the response rows start counting toward the dashboards.

Maturity scale: **1** Beginner · **2** Competent · **3** Proficient · **4** Expert (plus **0** N/A). Colours match across charts, legend, badges and exports.

---

## Project state

Single-developer MVP — the core flows (survey → review → reports with drill-down to individuals) work end-to-end. The intended first audience is a supervisor demoing to stakeholders, so the UI is deliberately minimal and the in-app **Docs** section (sidebar under "Help") explains each page for non-technical users.

Known shortcuts and things we're OK with for now:

- No offline mode — assessments require network connectivity.
- No multi-tenant support — one deployment, one set of users.
- SQLite on disk — plenty for the current scale (single facility cluster) but you'd swap for Postgres if you ever ran this nationally.
- No CI / GitHub Actions yet — Playwright is local-only.
- Lint is wired to the web only; the api has a placeholder script.

If any of those bite you, open an issue or fix and PR.

---

## Licence

See [`apps/web/LICENSE`](./apps/web/LICENSE).
