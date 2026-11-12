# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-12_

## Last session

2026-11-12 (2nd): role-model Backend steps 4–7 and 9 done on `feat/role-model`; `pnpm -F api`
type-checks. Ended at the context limit before step 8 and the tests.

## In progress

`plans/2026-11-12-role-model.md`, Backend section. Done since the WIP commit:
- 4: national list suppression + remainder pseudo-row (`routes/reports.ts`).
- 5: `routes/reviews.ts` (mounted at `/admin/reviews`, same URLs): scoped by the submitter's
  CURRENT facility; out-of-scope → 404; own submission → 403; new `GET /admin/reviews/:id`.
- 6: users routes in `routes/admin.ts`: `validatePlacement` per role, `user_districts` writes,
  facility-admin limits (`manageDeny`). Choices not in the plan (user OK "for now", 2026-11-12):
  `facility_admin` needs a facility, staff facility stays optional, admin keeps its optional
  placement, facility admins may also edit org role/title and cannot change their own role.
- 7: workbook: `SYSTEM_ROLES` from `ROLES`, new optional `district_codes` column end to end.
- 9: `/auth/me` already returns districts via `withRegions`.
Stopped before: step 8 (labels env + `GET /api/v1/config`, workbook/API wording). API tests
NOT run yet; the monitor-based suites will fail until rewritten.

## Next

1. Backend 8 (labels config).
2. `pnpm -F api test`: rewrite the monitor suites and add the new role tests (plan → Tests).
3. Web section of the plan, then type/build/tests; report done and ask before a live test pass.
4. Email: separate plan after this (TODO.md).

## Gotchas found this session

- Repo files are CRLF: scripted string replacements must convert `\n` → `\r\n` (or use Edit).
- Git Bash mangles `/wca`-style args (docker `-e`, curl `-w`): `export MSYS_NO_PATHCONV=1`.
- PowerShell → ssh: send multi-line scripts base64-encoded (`echo <b64> | base64 -d | bash`).
