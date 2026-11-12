# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-12_

## Last session

2026-11-12 (3rd): role-model Backend step 8 done (labels config, public `GET /api/v1/config`,
display-text-only per user; DECISIONS). Backend section of the plan is now complete.

## In progress

`plans/2026-11-12-role-model.md`, Backend done (steps 1–9). Step 6 choices accepted "for now"
(2026-11-12): `facility_admin` needs a facility, staff facility stays optional, admin keeps its
optional placement, facility admins may also edit org role/title and cannot change their own role.
API suite: 67 failing / 151 passing. All failures are monitor-era suites plus `setup-export`
(expects the pre-`district_codes` columns and a `monitor` row); none come from new code.
New `test/config.test.ts` passes.

## Next

1. `pnpm -F api test`: rewrite the monitor suites and `setup-export.test.ts`, add the new role
   tests (plan → Tests).
2. Web section of the plan (labels: fetch `/config`), then type/build/tests; report done and ask
   before a live test pass.
3. At deploy: set `ORG_LEVEL1_LABEL=County`, `ORG_LEVEL2_LABEL=Sub-county` in UAT/prod `.env`
   (compose passes them through; `deploy.mjs` keeps unknown keys). Existing `monitor` users need a
   new role (plan → Hard to reverse).
4. Email: separate plan after this (TODO.md).

## Gotchas found this session

- Repo files are CRLF: scripted string replacements must convert `\n` → `\r\n` (or use Edit).
- Git Bash mangles `/wca`-style args (docker `-e`, curl `-w`): `export MSYS_NO_PATHCONV=1`.
- PowerShell → ssh: send multi-line scripts base64-encoded (`echo <b64> | base64 -d | bash`).
- `test/helpers.ts` `testApp()` mounts routers itself (no `/api/v1` prefix); add new routers there.
