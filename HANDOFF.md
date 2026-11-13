# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-13_

## Last session

2026-11-13: role-model API tests rewritten for the new roles (reports access matrix, survey,
users + facility-admin limits, reviews scoping, national/sub-county suppression). Fixed: deleting
a district with a sub-county coordinator assigned is now blocked (409), like regions.

## In progress

`plans/2026-11-12-role-model.md` → Tests. API suite: 19 failing / 234 passing, all in the workbook
suites `setup-plan-users`, `setup-import`, `setup-export` (they still use `monitor` rows and the
pre-`district_codes` Users columns). Everything else passes; `tsc` clean.
Helpers now have `createCounty`, `createSubcounty`, `assignDistricts`; `USERS_HEADER` and
`userSheetRow` include `district_codes`.

## Next

1. Fix the 3 workbook suites: `monitor` → `county` (one region code) / `subcounty`
   (`district_codes`); add workbook cases for role values and district codes (plan → Tests).
   Then `pnpm -F api test` all green.
2. Web section of the plan, then type/build/tests; report done and ask before a live test pass.
3. At deploy: set `ORG_LEVEL1_LABEL=County`, `ORG_LEVEL2_LABEL=Sub-county` in UAT/prod `.env`
   (compose passes them through; `deploy.mjs` keeps unknown keys). Existing `monitor` users need a
   new role (plan → Hard to reverse).
4. Email: separate plan after this (TODO.md).

## Gotchas

- Repo files are CRLF: scripted string replacements must convert `
` → `
` (or use Edit).
- Git Bash mangles `/wca`-style args (docker `-e`, curl `-w`): `export MSYS_NO_PATHCONV=1`.
- PowerShell → ssh: send multi-line scripts base64-encoded (`echo <b64> | base64 -d | bash`).
- `test/helpers.ts` `testApp()` mounts routers itself (no `/api/v1` prefix); reviews live under
  `/admin/reviews` via the admin router.
- Long `cat <<'EOF'` heredocs chained with `&&` in the Bash tool failed to parse; use Write.
