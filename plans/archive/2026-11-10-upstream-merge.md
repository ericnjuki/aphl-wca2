# Merge APHL upstream (`origin/main`) and port our hosting fixes onto its new nginx layout

**Status:** done (2026-11-10; UAT + prod on `f7580df`)

Docs migration done first: `plans/archive/2026-11-10-docs-migration.md`.

## Context
- Fork point `688d736` (2026-08-26). `origin/main` (`8bc9e14`) has 99 commits we lack, all by
  Fredrick Mwasekaga: districts, region monitors, workbook import (replaces CSV import), partner
  report privacy fixes, ending sessions for disabled users, and a new nginx/certbot HTTPS layer.
- We have 13 commits upstream lacks: `BASE_PATH` subpath, `TLS_MODE=external`, the
  `X-Forwarded-Proto` relay, `ROOT_REDIRECT_URL`, `scripts/deploy.mjs`, and docs.
- A trial `git merge-tree` reports conflicts in `docker-compose.yml`, `nginx/Dockerfile`,
  `.env.docker.example` and `pnpm-lock.yaml`, plus a rename/delete on
  `nginx/conf.d/templates/internal-tls.conf.template`. Everything in `apps/` merges cleanly.
- Upstream's nginx: `40-wca-config.sh` renders `templates/http.conf.template` (no cert yet) or
  `templates/https.conf.template` (cert exists), and both `include snippets/wca-app.conf`. A
  `certbot` service issues and renews certificates, and a background loop switches modes and
  reloads. None of our four hosting features exist there. The web side already reads
  `VITE_BASE_URL` everywhere, including upstream's new components; I scanned the new code and
  found no hard-coded root paths.

## Why prod is at `apps.nphl.go.ke/wca` (checked 2026-11-10)
From `plans/2026-09-16-wca-subpath-deploy.md`, DECISIONS → Infrastructure, and the live servers. No
chat transcripts from September survive.
- The ask (2026-09-15/16) was to make the app reachable at `apps.nphl.go.ke/wca` and to replace
  what ran at `wca.nphl.go.ke`.
- `wca.nphl.go.ke` resolves to `197.248.131.166` (office NAT), which goes to the on-prem
  Proxmox parent's nginx. We have no access to it. It sends `/` to `analytics-svr:8888` and `/api`
  to `:6868`, the old `aphl-wca` API. **Server 46 has no `wca` or `apps` vhost** (all 52
  enabled and 59 available `server_name`s checked), so it isn't involved.
- `apps.nphl.go.ke` (`197.248.131.161`) lands on `analytics-svr`'s own nginx, which we control,
  and it already had `location ^~ /wca/ → 127.0.0.1:8888/wca/` wired in.
- Serving both domains from one instance is impossible, because `BASE_PATH` is baked in at build
  time (DECISIONS → Architecture), and two instances on one sql.js DB is unsafe. So: one `/wca`
  build, with the old domain 301-redirecting into it. The redirect also makes the stale
  Proxmox `/api → 6868` route dead without needing the Proxmox admin.
- Live today: `wca.nphl.go.ke/reports` → 301 `apps.nphl.go.ke/wca/reports`; `/wca/` 200; UAT 200.
  Prod and UAT both run `fdd29e2` with `TLS_MODE=external`, `APP_PORT=8888` (prod adds
  `BASE_PATH=/wca` + `ROOT_REDIRECT_URL`). Compose is v5.5.1 on prod and v5.0.2 on UAT, so
  `!override` works. Neither `.env` uses the committed example `SESSION_SECRET`, so **no rotation
  is needed**; the merge just blanks it in the example file.

## Approach: take upstream's layout as the base and re-add our features to it
We take upstream's design and add ours as optional switches. Upstream's own behaviour (DOMAIN +
certbot, root path) must stay the default, unchanged, so the result is also fit to offer back
upstream as a PR.

### Port map
| Our feature | Where it lived (fork) | Where it goes (merged) |
|---|---|---|
| **Subpath `BASE_PATH`**: locations prefixed, `alias` not `root`, `proxy_pass …/api/` strips the prefix, SPA fallback to `${BASE_PATH}/index.html` | both `conf.d/templates/*.conf.template` | `snippets/wca-app.conf` becomes `snippets/wca-app.conf.template`, rendered by `40-wca-config.sh` with `envsubst '${BASE_PATH}'`. All five locations get the prefix, **including upstream's new `= /api/v1/admin/setup/import/apply` 600s-timeout location**, which becomes `= ${BASE_PATH}/api/v1/admin/setup/import/apply` → `proxy_pass http://api_upstream/api/v1/admin/setup/import/apply`. With `BASE_PATH` empty, it renders the same locations upstream has today. |
| **Build-time base**: `VITE_BASE_URL` arg, `VITE_API_URL=${BASE_PATH}/api/v1`, vite `base`, sqlite `locateFile` | `nginx/Dockerfile`, compose build args, `vite.config.ts`, `sqlite-client-provider.tsx` | Dockerfile: upstream's (node 22, nginx 1.30, CRLF strip) plus our `ARG/ENV VITE_BASE_URL`. Compose build args: ours. `vite.config.ts` and `sqlite-client-provider.tsx` auto-merge; I'll confirm our lines survive. |
| **`TLS_MODE=external`**: plain HTTP only, behind a proxy that terminates TLS | `external-tls.conf.template` + `docker-compose.external.yml` | New `templates/external.conf.template` (port 80, `server_name _`, includes the snippet). In `40-wca-config.sh`, `desired_mode()` returns `external` when `TLS_MODE=external`, so the certificate check and HTTPS switch never run. Default `TLS_MODE` empty = upstream's auto http/https. |
| **`X-Forwarded-Proto` relay** (the cookie fix: Express must see `https`) | `external-tls` template: `$http_x_forwarded_proto` | The shared snippet uses `proxy_set_header X-Forwarded-Proto $wca_forwarded_proto;`. Each site template defines it with a `map`: `http`/`https` → `$scheme` (upstream behaviour unchanged); `external` → `$http_x_forwarded_proto`, falling back to `$scheme` when the header is absent. |
| **`ROOT_REDIRECT_URL`** (`wca.nphl.go.ke/` → `apps.nphl.go.ke/wca`) | `ROOT_REDIRECT_BLOCK` placeholder + awk in `10-render-conf.sh` | The same placeholder goes in the snippet template; `40-wca-config.sh` emits `location = / { return 301 … }` only when both `BASE_PATH` and `ROOT_REDIRECT_URL` are set. |
| **Single host port (`APP_PORT`, 8888)** | `docker-compose.external.yml` | Upstream's base compose hard-binds `80:80` and `443:443`, and compose overlays *append* ports, so the overlay uses `ports: !override ["${APP_PORT:-8888}:80"]` (Compose ≥2.24; 2.29 locally; I'll check both servers). The certbot service idles when `LETSENCRYPT_EMAIL` is unset, so it's harmless in external mode. |
| **Internal-TLS overlay** | `docker-compose.internal-tls.yml`, `internal-tls.conf.template` | **Deleted.** Upstream's base compose + certbot service + `https.conf.template` do this better (auto-issue, renewal, aliases). `DOMAIN_WWW` is replaced by upstream's `DOMAIN_ALIASES`. |
| **`scripts/deploy.mjs`** (interactive CLI) | ours | Kept, updated: `internal` writes `DOMAIN`, `DOMAIN_ALIASES`, `LETSENCRYPT_EMAIL` and runs plain `docker compose up -d --build`; `external` writes `TLS_MODE=external`, `APP_PORT`, `BASE_PATH`, `ROOT_REDIRECT_URL` and uses the overlay. |
| **`.env.docker.example`** | ours | Upstream's file plus a section for `TLS_MODE`/`APP_PORT`/`BASE_PATH`/`ROOT_REDIRECT_URL`. **Our copy has a real-looking `SESSION_SECRET` committed** (from `4bcea00`); upstream has it blank, so we take blank. Prod and UAT use different secrets (checked 2026-11-10), so nothing needs rotating. |
| **`docs/DEPLOYMENT.md`** | ours | Rewritten for the merged modes. |
| **`pnpm-lock.yaml`** | conflict | Take upstream's, then `pnpm install` to re-add `@inquirer/prompts` (deploy.mjs) and regenerate. |

## Steps
1. Branch `merge/upstream-2026-11` from `main`; `git merge origin/main`; resolve as above.
2. `pnpm install`, `pnpm -w typecheck`/`build`, run upstream's tests (vitest + API tests).
3. Start Docker Desktop. Render-check every mode in the built nginx image with `nginx -t` and a
   `curl` matrix:
   - root + no domain (http)
   - root + `TLS_MODE=external`
   - `BASE_PATH=/wca` + external + `ROOT_REDIRECT_URL`
   - `BASE_PATH=/wca` + the 600s import-apply path
   For each, check `X-Forwarded-Proto` reaches the API and `Set-Cookie` is present when the
   request comes in with `X-Forwarded-Proto: https`.
4. Local Playwright pass at `/wca`: login, first-login password change, and the new upstream
   features (Setup workbook, districts, reports).
5. **UAT** (`143.198.180.142:20822`, root, external): back up the DB volume, push the branch to
   `fork`, check out the branch on UAT, rebuild with the overlay, then browser-verify.
6. **Prod** (`analytics-svr`, `/wca`, external): back up the `aphl-wca2_api_data` volume to this
   machine, deploy, then browser-verify `apps.nphl.go.ke/wca` (login, cookie, password change) and
   the `wca.nphl.go.ke` redirect.
7. Merge the branch into `main`, push to `fork`. Afterwards (optional, your call): PR the hosting
   switches to `origin`.

## Hard-to-reverse steps
- **DB migrations (steps 5–6).** Upstream adds forward-only schema migrations (districts, region
  monitors, …) that run on API start. Recovery: restore the volume backup taken just before, and
  redeploy `fdd29e2`. Prod data today is only the seeded admin + catalogue, so the risk is low,
  but the backup is still mandatory.
- **Workbook import replaces CSV import.** Any operator workflow that used CSVs stops working.
  This is upstream's decision; I'm noting it, not reversing it.
- **Prod deploy**: brief downtime during the rebuild. Rollback = `git checkout fdd29e2`, rebuild,
  restore the volume.
- **Prod/UAT `.env`**: after the merge, both keep their current keys. `TLS_MODE=external`
  still selects the external template and `DOMAIN=_` stays valid. Nothing in `.env` needs to
  change unless a check fails.

## Open questions
- None blocking. Signing off this plan covers pushing the branch to `fork` and both deploys; a PR
  to `origin` is separate and waits for your explicit go-ahead.
