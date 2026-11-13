# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-13_

## Last session

2026-11-13: role-model web finished: quick Approve/Reject row buttons back on Reviews (hidden on own rows,
`c299daf`), in-app docs rewritten for the six roles (users, reports, setup, reviews, getting-started,
`727d4f9`). Web tsc at baseline (62), web 69/69, API 256/256, `vite build` OK.

## In progress

`plans/2026-11-12-role-model.md`: all code and docs done. Live test pass deferred to next session by the user (2026-11-13).

## Next

1. **First task (user said "next sesh", 2026-11-13):** live Playwright pass, one login per role (admin, national, county, subcounty,
   facility_admin, staff): menu, report landing/limits, reviews scope + self-review block, Users page.
2. At deploy: `ORG_LEVEL1_LABEL=County`, `ORG_LEVEL2_LABEL=Sub-county` in UAT/prod `.env`; existing
   `monitor` users need a new role (plan → Hard to reverse). Then email plan (TODO.md).

## Gotchas

- Web `tsc` has 62 pre-existing errors (unused shadcn components missing deps, recharts types):
  run `npx tsc --noEmit -p tsconfig.app.json` and diff against a clean-tree baseline (`git stash`).
- pt/sw `common.json` contain duplicate keys: never JSON round-trip them; insert text.
- Repo files are CRLF: scripted replacements must normalise `\r\n` (or use Edit).
- Git Bash mangles `/wca`-style args (docker `-e`, curl `-w`): `export MSYS_NO_PATHCONV=1`.
- PowerShell → ssh: send multi-line scripts base64-encoded (`echo <b64> | base64 -d | bash`).
