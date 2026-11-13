# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-13_

## Last session

2026-11-13: role-model API tests finished. Workbook suites (setup-plan-users/import/export) moved
from `monitor` to county/subcounty/national/facility_admin with `district_codes`; API suite
256/256 green, `tsc` clean.

## In progress

`plans/2026-11-12-role-model.md` → Web section, not started (no web code changed yet). Start with
the plan's Web "Implementation notes" (typed role union + web `lib/roles.ts`), then items 1-6.
Session ended at the context limit after surveying the web code.

## Next

1. Web section of the plan (items 1-6), then web tests (placement, menu, landing), type/build/tests;
   report done and ask before a live test pass.
2. At deploy: set `ORG_LEVEL1_LABEL=County`, `ORG_LEVEL2_LABEL=Sub-county` in UAT/prod `.env`
   (compose passes them through; `deploy.mjs` keeps unknown keys). Existing `monitor` users need a
   new role (plan → Hard to reverse).
3. Email: separate plan after this (TODO.md).

## Gotchas

- Repo files are CRLF: scripted string replacements must convert `
` → `
` (or use Edit).
- Git Bash mangles `/wca`-style args (docker `-e`, curl `-w`): `export MSYS_NO_PATHCONV=1`.
- PowerShell → ssh: send multi-line scripts base64-encoded (`echo <b64> | base64 -d | bash`).
- `test/helpers.ts` `testApp()` mounts routers itself (no `/api/v1` prefix); reviews live under
  `/admin/reviews` via the admin router.
- Long `cat <<'EOF'` heredocs chained with `&&` in the Bash tool failed to parse; use Write.
