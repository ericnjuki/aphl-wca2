# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-11_

## Last session

2026-11-12: role-model plan signed off (`plans/2026-11-12-role-model.md`); backend build started on
branch `feat/role-model` (WIP commit, **does not type-check yet**). Session ended at the context limit.

## In progress

`plans/2026-11-12-role-model.md`, Backend section. Done (WIP commit on `feat/role-model`):
- `lib/roles.ts` (role codes + groups), migration 12 (`user_districts`, monitor→county).
- `middleware/auth.ts`: `requireRole`, `requireAssessmentTaker` (`denyMonitor` removed; survey.ts uses it).
- `lib/org.ts`: `getUserDistricts`; `withRegions` also returns `districts`/`district_ids`.
- `lib/report-scope.ts` rewritten per role (+ `isSummaryOnly`, `districtIds`).
- `routes/reports.ts`: monitor checks → `isSummaryOnly`; subcounty never district-privacy-hidden.
Stopped before: Backend steps 4 (national per-county list suppression + remainder pseudo-row, not
done), 5 reviews router, 6 users router (still references `monitor`), 7 workbook, 8 labels `/config`.

## Next

1. Finish Backend 4–8, fix `pnpm -F api` type check, rewrite monitor tests + new role tests.
2. Web section of the plan, then type/build/tests; report done and ask before a live test pass.
3. Email: separate plan after this (TODO.md).

## Gotchas found this session

- Git Bash mangles `/wca`-style args (docker `-e`, curl `-w`): `export MSYS_NO_PATHCONV=1`.
- PowerShell → ssh: send multi-line scripts base64-encoded (`echo <b64> | base64 -d | bash`);
  piping stdin adds a BOM + CRLF, and inner double quotes get stripped.
