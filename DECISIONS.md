# Decisions

<!-- Rules: ~/.claude/doc-system.md. Every top-level bullet starts with (YYYY-MM-DD). -->
Durable business rules and architecture/design decisions. Detail lives in `docs/*.md`.

## Architecture

- (2026-09-16) **`BASE_PATH` is a build-time constant baked into the JS bundle, so one running
  instance serves exactly one base path.** `apps/web/src/main.tsx` prepends `VITE_BASE_URL` to every
  React Router path, and the same pattern runs through nav/menu components, the API base URL and the
  sqlite-wasm loader (`apps/web/src/components/sqlite-client-provider.tsx`). No nginx trick makes
  one build serve root and a subpath at once. Serving several base paths from one instance would
  need runtime base-path detection (e.g. from `window.location.pathname`), a real architecture change.
- (2026-09-16) **Never point two live processes at one DB file.** `apps/api/src/db/database.ts` uses
  `sql.js`: it loads the whole DB into memory at startup and overwrites the whole file on every
  write (`persistDb()`), with no cross-process locking. Each process would silently clobber the
  other's writes.
- (2026-09-16) **The nginx config is rendered at container start from env vars.** Templates and the
  render script live under `nginx/`. `BASE_PATH` picks root vs. subpath (limits above).
  `scripts/deploy.mjs` is the interactive deploy CLI: it writes `.env`, picks the compose overlay
  and runs `docker compose up -d --build`. The merge in `plans/2026-11-10-upstream-merge.md`
  rebases this onto upstream's layout.

## Repo / Workflow

- (2026-09-18) **`origin` (`APHL-Global-Health/workforce-competency`) is read-only for us; `main`
  tracks `fork` (`ericnjuki/aphl-wca2`).** A bare `git push` goes to `fork`, so seeing "fork/main"
  is expected. Changes reach `origin` only through a PR from `fork`, merged by someone with write
  access (upstream maintainer: Fredrick Mwasekaga).
- (2026-11-10) **Our project docs never reach upstream.** That covers `CLAUDE.md`, `DECISIONS.md`,
  `HANDOFF.md`, `TODO.md` and `plans/`. They live on `fork` only. A PR to `origin` is a branch cut
  from `origin/main` that carries only code commits (cherry-picked), so keep docs changes in
  docs-only commits, separate from code commits.
- (2026-11-10) **`docs/superpowers/` is upstream's plan/spec area, not part of our doc system.**
  Leave its files where upstream puts them (moving them would conflict on every merge). Our plans
  go in `plans/`.

## Infrastructure

- (2026-09-16, rev. 2026-11-10) **Prod is `analytics-svr`** (`nphlict@100.98.132.120` via
  Tailscale, LAN `172.16.0.151`). SSH needs `-A`, because the host's own `git pull` hops to GitHub
  with the operator's key. The repo is at `~/projects/aphl-wca2`: `wca-nginx` (host `:8888`) +
  `wca-api` (internal), `TLS_MODE=external`, `BASE_PATH=/wca`,
  `ROOT_REDIRECT_URL=https://apps.nphl.go.ke/wca`, deployed with
  `docker compose -f docker-compose.yml -f docker-compose.external.yml up -d --build`. It's a
  heavily shared host (~20 other apps; see `../aphl-metrics/docs/v2-discovery-inventory.md`).
- (2026-09-16) **UAT is `ericn@143.198.180.142 -p 20822`** (alias `aphl-ke-prod2`), repo at
  `~/projects/aphl-wca2`, Docker only (no node/npm on the host). Root-domain instance
  `wca.ken-info.org`, `TLS_MODE=external`, same overlay command as prod. Update: `git pull`, then
  rebuild. `.env` changes only if `CORS_ORIGINS`/`DOMAIN` change.
- (2026-09-16, rev. 2026-11-10) **The app's canonical prod URL is `apps.nphl.go.ke/wca`, and
  `wca.nphl.go.ke` only 301-redirects into it.** `wca.nphl.go.ke` resolves to the office NAT
  (`197.248.131.166`) and is routed by the on-prem Proxmox parent's nginx, which we can't
  access. It sends `/` → `172.16.0.151:8888` unchanged and `/api` → `:6868`, the stale old
  `aphl-wca` API. `apps.nphl.go.ke` is routed by `analytics-svr`'s own nginx
  (`/etc/nginx/conf.d/0-default.conf`, ours), whose `location ^~ /wca/ → 127.0.0.1:8888/wca/`
  forwards the prefix unchanged. Because of the base-path rule above, one `/wca` build plus a
  redirect is the only single-instance option, and the redirect also makes the stale `/api` route
  dead. Server 46 (the `*.nphl.go.ke` gateway) has no `wca`/`apps` vhost.
  Sibling paths on that vhost: `/labmapping2025`→3903, `/surveillance_dashboard`→3904,
  `/partners`→3905, `/metabase/`→3901, `/auth/`→5151, `/dashboard`→3902.
- (2026-09-16) **The old `aphl-wca` repo's containers on prod are dead leftovers:**
  `aphl-wca-aphl-api-1` (`:6868`) and `aphl-wca-postgresdb-1` (`:5434`, `postgres:14.5`). Back
  up the postgres data before removing them (see `TODO.md`).
- (2026-09-16) **More host and access detail lives in `../aphl-metrics/docs/`** (`architecture.md`
  § Hosts, `server-46.md`, `v2-discovery-inventory.md`). That repo's discovery passes are the most
  current server inventory.

## Gotchas

- (2026-09-16) **Every proxy hop in front of the API must relay the client's `X-Forwarded-Proto`, not
  set `$scheme`.** TLS for `apps.nphl.go.ke` terminates at the Proxmox parent, which talks plain
  HTTP to `analytics-svr:80`. A hop that sets `X-Forwarded-Proto $scheme` sends `http`, so Express
  (`trust proxy`) sees `req.secure=false`, and `express-session` **silently drops `Set-Cookie`**
  (`cookie.secure` is true). Symptom: login returns 200, then every authenticated call 401s, with
  no log line. Fix: `proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;` on
  `analytics-svr`'s nginx (done) and in the container's external template. Diagnose with
  `curl -i` and look for `set-cookie`. Check every hop in a chain you don't fully control.
- (2026-09-16) **`CORS_ORIGINS` must be the exact browser origin** (scheme + host, port only if it
  is really part of the origin, no path). `apps/api/src/middleware/cors.ts` matches exactly, and
  compose silently defaults to `http://localhost`. When it's wrong, pages load but every API call
  (login included) fails as CORS. The only server-side trace is
  `[error] CORS: origin '...' not allowed` in `docker compose logs api`. Env vars are read at
  container start, so restart `api` after changing it.
- (2026-09-16, rev. 2026-11-10) **Auto Mode blocks some prod commands even over the PowerShell SSH
  path.** Reading secret-looking files (`cat .env`) is blocked: read only the non-secret keys you
  need (`grep -E '^(BASE_PATH|…)=' .env`). Prod mutations (`.env` edits, `docker compose up`)
  pass thanks to the user's global allow rule
  `PowerShell(& "$env:WINDIR\System32\OpenSSH\ssh.exe" -A nphlict@*)` in `~/.claude/settings.json`.
  Claude can't edit that file itself.
