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
and browser-verified** as of 2026-09-16, including the forced first-login password-change flow —
login, session-cookie persistence, and change-password all confirmed working end-to-end (after the
`X-Forwarded-Proto` fix below), redirect lands correctly, no known issues. `analytics-svr`'s
`wca-nginx`/`wca-api` run commit `fdd29e2` with `BASE_PATH=/wca`,
`ROOT_REDIRECT_URL=https://apps.nphl.go.ke/wca`, and `CORS_ORIGINS=https://apps.nphl.go.ke` in
`.env`. Prod DB (`aphl-wca2_api_data` volume on `analytics-svr`) was wiped and re-seeded fresh
2026-09-16 (see below) — currently just the seeded `admin`/`APHLwca2024` user (`is_first_login:
true`) and the standard assessment catalog, no other data. UAT (`143.198.180.142:20822`,
`~/projects/aphl-wca2`, `wca.ken-info.org`) is also on `fdd29e2` (pulled + rebuilt from 9 commits
behind on 2026-09-16), containers healthy; UAT's own DB was **not** touched by this session's reset.

## Open Threads
- **Not started**: back up `aphl-wca-postgresdb-1` (old leftover container, port 5434) to
  `~/Downloads/aphl-wca-postgres-backup-<date>.sql.gz` on this machine, then stop+remove it and
  `aphl-wca-aphl-api-1` (port 6868) — plan step 4, the only remaining step in
  `plans/2026-09-16-wca-subpath-deploy.md`.

## Session Handoff — do this next
This session diagnosed and fixed a 401 on the forced first-login password-change flow on
`apps.nphl.go.ke/wca`: `Set-Cookie` was never reaching the browser because `analytics-svr`'s own
nginx (`/etc/nginx/conf.d/0-default.conf`) overwrote `X-Forwarded-Proto` with its own `$scheme`
(always `http`, since real TLS terminates one hop further out on the Proxmox parent host) —
Express's `trust proxy` resolved `req.secure` to `false`, and `express-session` silently dropped the
cookie. Fixed by relaying the real upstream header (`$http_x_forwarded_proto`) instead of
overwriting it, then reloaded nginx; verified via direct response-header inspection through the
public URL. See `DECISIONS.md` → Infrastructure for the durable rule (there's a third proxy hop
above `analytics-svr` we don't control, and it needs checking too for any future subpath deploy).
Because fixing the bug mid-diagnosis meant a test run actually completed a password change against
the live seeded admin account, the prod DB (`aphl-wca2_api_data` volume) was deliberately wiped and
the app was restarted to self-reseed to a clean first-deploy state — confirmed via container startup
logs (migrations + seed) and a final read-only login check that did not touch change-password.
Nothing else open from this session; next up is the Open Threads item above (postgres backup +
old-container retirement).
