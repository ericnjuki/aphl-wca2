# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-13_

## Last session

2026-11-13: live Playwright pass of the role model, one login per role + an unassigned county user.
Menus, report landings, scope/403s, breadcrumbs, small-group suppression, reviews (scope, self-review
block in UI + API, approve, reject-needs-notes) and the Users page (facility admin locks, edit save,
admin role picker with Sub-county labels) all behave as planned. Three minor UI follow-ups found (TODO.md).

## In progress

`plans/2026-11-12-role-model.md`: code, docs and live pass done. Remaining: the three 2026-11-13 TODO
follow-ups (need user approval to fix), then deploy.

## Next

1. Get approval for, then fix, the three 2026-11-13 follow-ups in TODO.md (one-line national-query gate;
   no-access notices for forbidden report URLs and `/reviews`). Type check + tests, quick re-check.
2. At deploy: `ORG_LEVEL1_LABEL=County`, `ORG_LEVEL2_LABEL=Sub-county` in UAT/prod `.env`; existing
   `monitor` users need a new role (plan → Hard to reverse). Then email plan (TODO.md).

## Gotchas

- Local live testing: `apps/web` has no `.env`, so `VITE_API_URL` defaults to `http://localhost:3000`
  and sessions break (cross-site cookie). Start Vite with `MSYS_NO_PATHCONV=1 VITE_API_URL=/api/v1`.
  Use a scratch `DB_PATH` (local `data/workforce.db` is empty: admin only). The fixture seeding script is not
  kept; rebuild from `test/helpers.ts` patterns if needed.
- Web `tsc` has 62 pre-existing errors (unused shadcn components missing deps, recharts types):
  run `npx tsc --noEmit -p tsconfig.app.json` and diff against a clean-tree baseline (`git stash`).
- pt/sw `common.json` contain duplicate keys: never JSON round-trip them; insert text.
- Repo files are CRLF: scripted replacements must normalise `\r\n` (or use Edit).
- Git Bash mangles `/wca`-style args (docker `-e`, curl `-w`, `VITE_API_URL`): `export MSYS_NO_PATHCONV=1`.
- PowerShell → ssh: send multi-line scripts base64-encoded (`echo <b64> | base64 -d | bash`).
