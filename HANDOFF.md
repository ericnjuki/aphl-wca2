# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-13_

## Last session

2026-11-13: role-model web, Users page committed (`5dd2aef`): role picker per caller, county/sub-county
placement selects, region → district cascade filtering facilities, facility-admin view (facility fixed, no
Status, no bulk import), placement column + role badges. Earlier: `12349a3` (roles, menu, landing, labels).
Web tests 69/69; `tsc` at baseline (62).

## In progress

`plans/2026-11-12-role-model.md` → Web items 3 (Reviews detail), 5 (Setup label strings), 6 (docs) remain.

## Next

1. **Reviews page**: detail view from `GET /admin/reviews/:id` (`{ assessment, subcompetencies }`,
   same shape as `/my-assessments/:id`); extract My Assessments' detail table into a shared
   component; approve/reject there; hide them when `assessment.user_id === me`.
2. Remaining hardcoded Region/District strings on Setup pages → `useOrgLabels`.
3. Docs `apps/web/src/docs/1.0.0/users.md`, `reports.md`; grep locales + docs for monitor/Partner.
4. tsc (diff vs baseline) + build + tests; report done, ask before a live Playwright pass.
5. At deploy: `ORG_LEVEL1_LABEL=County`, `ORG_LEVEL2_LABEL=Sub-county` in UAT/prod `.env`; existing
   `monitor` users need a new role (plan → Hard to reverse). Then email plan (TODO.md).

## Gotchas

- Web `tsc` has 62 pre-existing errors (unused shadcn components missing deps, recharts types):
  run `npx tsc --noEmit -p tsconfig.app.json` and diff against a clean-tree baseline (`git stash`).
- pt/sw `common.json` contain duplicate keys: never JSON round-trip them; insert text.
- Repo files are CRLF: scripted replacements must normalise `\r\n` (or use Edit).
- Git Bash mangles `/wca`-style args (docker `-e`, curl `-w`): `export MSYS_NO_PATHCONV=1`.
- PowerShell → ssh: send multi-line scripts base64-encoded (`echo <b64> | base64 -d | bash`).
