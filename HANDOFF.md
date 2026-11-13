# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-13_

## Last session

2026-11-13 (2nd): fixed the three role-model UI follow-ups (78f8a39): national query gated to the
national level, 4xx not retried, "You don't have access" notice for forbidden report URLs and
`/reviews`. Live-checked with Playwright as county/staff/national/admin; web tests 72/72.

## In progress

`plans/2026-11-12-role-model.md`: all code, docs and live checks done. Only deploy remains.

## Next

1. Get the user's go-ahead, then deploy `feat/role-model` to UAT: set `ORG_LEVEL1_LABEL=County`,
   `ORG_LEVEL2_LABEL=Sub-county` in `.env`; existing `monitor` users need a new role (plan → Hard to
   reverse). Then prod. Mark the plan done and archive it.
2. Email plan (TODO.md).

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
