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
`BASE_PATH` subpath-deployment feature (commit `aa5fefe`) and the upstream assessment-seeding merge are committed and pushed to `fork/main`, but **not yet redeployed to prod** — `analytics-svr`'s running `wca-nginx`/`wca-api` are still on old commit `feac461`.

A prod rollout plan exists at `plans/2026-09-16-wca-subpath-deploy.md` (single instance, `BASE_PATH=/wca`, redirect `wca.nphl.go.ke`'s root to `apps.nphl.go.ke/wca` from the same container) — **approved by the user in discussion, but not yet implemented.** See that plan file for full detail and rationale (a two-instance design was considered and rejected — see `DECISIONS.md` → Architecture for why one build can't serve two base paths).

## Open Threads
- **Not started**: add the optional `ROOT_REDIRECT_URL` nginx feature (plan step 2) — needs changes
  to `nginx/conf.d/templates/*.conf.template` and `nginx/docker-entrypoint.d/10-render-conf.sh`.
- **Not started**: redeploy `analytics-svr`'s `wca-nginx`/`wca-api` with `BASE_PATH=/wca` +
  `ROOT_REDIRECT_URL=https://apps.nphl.go.ke/wca`, then verify both `apps.nphl.go.ke/wca` and the
  `wca.nphl.go.ke` redirect live.
- **Not started**: back up `aphl-wca-postgresdb-1` (old leftover container, port 5434) to
  `~/Downloads/aphl-wca-postgres-backup-<date>.sql.gz` on this machine, then stop+remove it and
  `aphl-wca-aphl-api-1` (port 6868).

## Session Handoff — do this next
This session: created the doc trio, committed+pushed the `BASE_PATH` feature, merged in upstream's assessment-seeding feature, did prod recon on `analytics-svr` (found the existing deployment, the stale Proxmox `/api`→6868 route, and the pre-wired `apps.nphl.go.ke` `/wca/` nginx block), then — after the user pushed back on a two-instance design — redesigned to a single-instance approach with a same-container redirect, and wrote it up in `plans/2026-09-16-wca-subpath-deploy.md`. **Execution was explicitly paused before any prod changes were made** (no files changed on `analytics-svr`, no containers touched). Next session: implement the plan (add `ROOT_REDIRECT_URL`, redeploy, verify, then back up + retire the old containers) — SSH via `$env:WINDIR\System32\OpenSSH\ssh.exe -A nphlict@100.98.132.120` (Git Bash's ssh fails here, see `DECISIONS.md` → Infrastructure).
