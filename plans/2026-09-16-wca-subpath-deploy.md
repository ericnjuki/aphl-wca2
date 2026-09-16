# Deploy to prod: single instance at apps.nphl.go.ke/wca, redirect wca.nphl.go.ke

## Context

`workforce-competency` (fork `aphl-wca2`) is confirmed unused in production, so we can redeploy
freely. Original ask: make the app reachable at `apps.nphl.go.ke/wca` *and* replace what's running
at `wca.nphl.go.ke`. A two-instance design (one root build, one `/wca`-build) was considered and
rejected — see "Rejected: two instances" below. The chosen design uses **one instance**, built with
`BASE_PATH=/wca`, plus a same-container redirect so the old domain still works.

## Findings from prod recon (analytics-svr, `nphlict@100.98.132.120`)

- SSH must go through the Windows OpenSSH client (`$env:WINDIR\System32\OpenSSH\ssh.exe -A ...`),
  not Git Bash's `ssh` — Git Bash's own client gets `Permission denied`, native client + agent
  forwarding works.
- This repo is already deployed at `~/projects/aphl-wca2` on old commit `feac461` (predates
  `BASE_PATH` and the upstream assessment-seeding merge). Running as `wca-nginx` (host port 8888,
  root mode) + `wca-api` (internal only).
- The parent-Proxmox conf (sent by the Proxmox manager, out of our access) proxies
  `wca.nphl.go.ke`'s `/` to `172.16.0.151:8888` (our container) with **no path rewriting** —
  whatever path the browser requests reaches our container unchanged. Its `/api` block points at
  port `6868`, which is a stale leftover from the old `aphl-wca` repo (`aphl-wca-aphl-api-1`), not
  our `wca-api` — currently the live site's API calls silently hit the wrong backend.
- `analytics-svr`'s own nginx (`/etc/nginx/conf.d/0-default.conf`, we do manage this one) already
  has a block pre-wired for this exact rollout:
  ```
  location ^~ /wca/ {
      proxy_pass http://127.0.0.1:8888/wca/;
      ...
  }
  ```
  It forwards the `/wca/` prefix through unchanged, already pointed at port 8888 — i.e. the same
  port the current root deployment already uses. No new port needed.
- Prod DB is effectively empty (`migrations`: 8 rows, `users`: 1 row, everything else incl.
  `assessments`/`sessions`/`facilities`: 0 rows) — nothing worth preserving/migrating.
- `apps/api/src/db/database.ts` uses `sql.js`, which loads the whole DB into memory once at boot
  and overwrites the whole file on every write — no real cross-process safety. This ruled out ever
  sharing one DB file between two live instances (moot now — one instance).

## Rejected: two instances (one root, one `/wca`)

Considered first, then dropped once the user asked to avoid running two instances and instead
asked whether a *single* instance could serve both hostnames. Investigated and found genuinely not
possible with the current build: `apps/web/src/main.tsx` bakes `VITE_BASE_URL` into every React
Router path string at build time (`path: baseUrl`, `` `${baseUrl}reports` ``, etc.), and the same
pattern repeats across nav/menu components, the API base URL, and the sqlite-wasm loader path.
**This is a build-time constant baked into the compiled JS bundle, not just a static-asset path
issue nginx tricks can route around.** A build produced with one `base` cannot correctly serve
routing/links for a different base path — so one running container can only ever be root-mode *or*
`/wca`-mode, never both, until the app is refactored to detect its base path at runtime instead of
baking it in at build time (a real architecture change, out of scope here — worth a `DECISIONS.md`
entry if ever revisited).

## Chosen design: single instance, `BASE_PATH=/wca`, redirect the old domain

1. **Redeploy the existing `wca-nginx`/`wca-api` on port 8888** (no new containers, no new ports)
   with `.env` changed to `BASE_PATH=/wca`. This makes `apps.nphl.go.ke/wca` work immediately
   through the nginx block that's already there.
2. **Add an optional `ROOT_REDIRECT_URL` env var** to the nginx image so `wca.nphl.go.ke`'s
   root-path passthrough (which will no longer match any `/wca/`-prefixed location) becomes a
   301 redirect instead of a 404:
   ```nginx
   location / {
       return 301 https://apps.nphl.go.ke/wca$request_uri;
   }
   ```
   This location never collides with the `/wca/`-prefixed ones (a bare `/` request doesn't match
   a `/wca/` prefix), so it's safe to render only when `BASE_PATH` is non-empty and
   `ROOT_REDIRECT_URL` is set — normal root-mode deployments (`BASE_PATH` unset) are unaffected.
   Implementation: render it conditionally in `nginx/docker-entrypoint.d/10-render-conf.sh` (e.g.
   a placeholder line in both `nginx/conf.d/templates/*.conf.template` files that the script fills
   in or strips based on whether `ROOT_REDIRECT_URL` is set). `$request_uri` preserves deep links
   (`wca.nphl.go.ke/reports/5` → `apps.nphl.go.ke/wca/reports/5`). Hardcode `https://` in the
   `return` — the container only ever sees plain HTTP internally (TLS terminates upstream), so
   `$scheme` would wrongly resolve to `http`.
3. **The `/api`→6868 bug fixes itself, no Proxmox coordination needed.** Once `wca.nphl.go.ke`
   never actually renders the app (redirects before any JS runs), nothing ever calls
   `wca.nphl.go.ke/api/...` again — so the stale Proxmox route to port 6868 becomes dead and
   harmless. No message to the Proxmox manager required for either issue.
4. **Retire the old `aphl-wca` leftovers** (`aphl-wca-aphl-api-1` on 6868, `aphl-wca-postgresdb-1`
   on 5434), confirmed unused: back up the postgres DB first (`pg_dump`/`pg_dumpall`, gzip, copy to
   this machine's `~/Downloads/aphl-wca-postgres-backup-<date>.sql.gz`), then stop + remove both
   containers, freeing ports 6868 and 5434.

## Verification (once implemented)

- `curl -s -o /dev/null -w '%{http_code}' http://localhost:8888/wca/` and `.../wca/api/v1/...` on
  `analytics-svr`.
- `curl -sI http://localhost:8888/` on `analytics-svr` — expect `301` with
  `Location: https://apps.nphl.go.ke/wca/`.
- Real domains in a browser: `https://apps.nphl.go.ke/wca/` loads and functions end-to-end (assets,
  login/session, API calls); `https://wca.nphl.go.ke/` (and a deep link like
  `https://wca.nphl.go.ke/reports`) redirects cleanly to the matching `apps.nphl.go.ke/wca/...` URL.
- `docker ps` shows `wca-nginx`/`wca-api` `Up`, and `aphl-wca-aphl-api-1`/`aphl-wca-postgresdb-1`
  gone, after the backup is confirmed saved locally.

## Status

Not yet implemented — plan only, paused before execution at the user's request. See `HANDOFF.md`
for exact next-step instructions.
