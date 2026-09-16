# Handoff

Live status doc for picking up this project cold in a new session — not a changelog and not a
decisions log (durable rules go in `DECISIONS.md` instead, then get deleted from here).

**Maintenance rules — read before editing this file, every time:**
- Update this file as you work, not only at the start or end of a session. Any time you finish a
  step that changes what's true — a task completes, a plan changes, a blocker appears or clears —
  update the relevant section immediately, in the same turn. Waiting until "wrap-up" is the single
  most common way this file goes stale; treat every edit to project code as a trigger to check
  whether this file still describes reality.
- At the **start** of every session, before doing anything else: re-read this whole file against
  the actual current state of the repo (git status/log, running the app if needed) and delete or
  correct anything that's no longer accurate. Do not assume it's current just because it was
  written recently.
- At the **end** of every session, replace the *entire contents* of "Session Handoff — do this
  next" (not append to it) with: a short paragraph (one or two sentences — durable decisions
  belong in `DECISIONS.md`, not here) on what this session accomplished, then concrete instructions
  for what the next session should do. If the session ends mid-task, write an "In progress" item
  instead of a finished-work paragraph, naming the relevant plan file and the exact point
  implementation stopped.
- A completed item that had real decisions behind it must be captured in `DECISIONS.md` *before*
  it is deleted from here — deleting without moving the decision loses it permanently.
- Keep "Current State" and "Open Threads" limited to what's true *right now*. An item that's done
  gets deleted, not marked done and left in place — a growing list of checked-off items is itself
  a symptom of staleness.

## Current State
`apps.nphl.go.ke/wca` and the `wca.nphl.go.ke` → `apps.nphl.go.ke/wca` redirect are **live in prod
and browser-verified** as of 2026-09-16 — login works (after the `CORS_ORIGINS` fix below), the
redirect lands correctly, no known issues. `analytics-svr`'s `wca-nginx`/`wca-api` run commit
`fdd29e2` with `BASE_PATH=/wca`, `ROOT_REDIRECT_URL=https://apps.nphl.go.ke/wca`, and
`CORS_ORIGINS=https://apps.nphl.go.ke` in `.env`. UAT (`143.198.180.142:20822`,
`~/projects/aphl-wca2`, `wca.ken-info.org`) is also on `fdd29e2` (pulled + rebuilt this session from
9 commits behind), containers healthy.

## Open Threads
- **Not started**: back up `aphl-wca-postgresdb-1` (old leftover container, port 5434) to
  `~/Downloads/aphl-wca-postgres-backup-<date>.sql.gz` on this machine, then stop+remove it and
  `aphl-wca-aphl-api-1` (port 6868) — plan step 4, the only remaining step in
  `plans/2026-09-16-wca-subpath-deploy.md`.

## Session Handoff — do this next
This session did the first live browser test of `apps.nphl.go.ke/wca`: login failed with a CORS
error, traced via `docker compose logs api` on `analytics-svr` to a stale `CORS_ORIGINS=http://
localhost:8888` in prod `.env` (predates the `apps.nphl.go.ke` vhost) — fixed by setting it to the
real origin and restarting `wca-api`; confirmed working after. Also confirmed the Next.js
`/_next/` referer-routing block in `analytics-svr`'s shared nginx conf doesn't affect `/wca/`
(longest-prefix match, unrelated path). Separately, discovered UAT (`aphl-ke-prod2`,
`~/projects/aphl-wca2`) *does* have a deployment for this repo — `DECISIONS.md` was stale on that —
and brought it up to date (was 9 commits behind). See `DECISIONS.md` → Infrastructure for the
`CORS_ORIGINS` gotcha (durable rule for future deploys). Next session: the postgres backup + old
container retirement is the only remaining open item (see Open Threads).
