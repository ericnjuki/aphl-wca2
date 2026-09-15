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
Uncommitted changes on `main` implement subpath deployment support (a `BASE_PATH` env var, e.g. `/wca`, letting the app mount under a path instead of only at the domain root): `vite.config.ts` build-time `base`, `sqlite-client-provider.tsx` sqlite-wasm loader path, `nginx/Dockerfile` build arg plumbing, `docker-compose.yml` `BASE_PATH`/`VITE_BASE_URL`/`VITE_API_URL` wiring, both nginx TLS templates (`location`/`alias` prefixed by `${BASE_PATH}`), `10-render-conf.sh` envsubst, `scripts/deploy.mjs` interactive "Base path" prompt, and `docs/DEPLOYMENT.md` documentation. Changes are internally consistent and appear complete; not yet reviewed for correctness/tested live, and not committed.

## Open Threads
- Subpath deployment feature (see Current State) is unreviewed and untested — needs a look at nginx `alias`/regex correctness and a live deploy test (e.g. `BASE_PATH=/wca`) before committing.

## Session Handoff — do this next
This session created `CLAUDE.md`, `DECISIONS.md`, and `HANDOFF.md` (plan-in-`/plans/` workflow, commit-only-on-request, shadcn/existing-conventions for UI), then reviewed the pending diffs and identified them as one coherent subpath-deployment feature (see Current State/Open Threads). Next session: confirm with the user whether they want a live test pass of `BASE_PATH` deployment before committing, per the plan-workflow/testing rules in `CLAUDE.md`.
