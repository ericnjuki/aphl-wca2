# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-13_

## Last session

2026-11-13: role-model web, first chunk committed (`12349a3`): `lib/roles.ts`, typed `AuthUser.role`
(+ `districts`/`district_ids`), menu per role, HomeRoute for non-takers, reports landing per role +
`NotAssignedNotice`, `canOpenLevel`/`useCanOpenLevel` stopping drill-downs and breadcrumbs, org labels
(`store/config.ts` → `useOrgLabels`, loaded in `main.tsx`), role names in en/pt/sw (`useRoleLabel`).
Web tests 61/61; `tsc` at baseline (62 pre-existing errors, see Gotchas).

## In progress

`plans/2026-11-12-role-model.md` → Web items 2, 3, 6 remain (1, 4, 5 done except label strings on
Users/Setup pages). Stopped at the context limit just before rewriting `pages/UsersPage.tsx`.

## Next

1. **Users page** (`UsersPage.tsx`, `lib/users/placement.ts` + test): role picker from
   `assignableRoles(caller)` with `useRoleLabel`; placement per role: county → one region select,
   subcounty → one district select (`GET /admin/districts`, returns `region_id`), facility roles →
   optional region → district cascade that only filters facilities (`GET /admin/facilities` returns
   `region_id`/`district_id`), national → none. `buildUserBody`: always explicit `region_ids` and
   `district_ids` (empty when unused), nulls for facility fields on national/county/subcounty.
   Facility-admin caller: un-gate `isAdmin` checks (`enabled: isAdmin` ~l.571, search, Add User, the
   "Admin access required" branch) via `USER_MANAGER_ROLES`; facility fixed to their own; hide the
   Status select (must send unchanged `is_enabled`); hide "Bulk import on Setup". Table column
   "Facility / Regions" shows region or district for coordinators; Role badge via `useRoleLabel`.
   All lookup GETs are open to any authenticated user (only writes are `requireAdmin`).
2. **Reviews page**: detail view from `GET /admin/reviews/:id` (`{ assessment, subcompetencies }`,
   same shape as `/my-assessments/:id`); extract My Assessments' detail table into a shared
   component; approve/reject there; hide them when `assessment.user_id === me`.
3. Remaining hardcoded Region/District strings on Setup pages → `useOrgLabels`.
4. Docs `apps/web/src/docs/1.0.0/users.md`, `reports.md`; grep locales + docs for monitor/Partner.
5. tsc (diff vs baseline) + build + tests; report done, ask before a live Playwright pass.
6. At deploy: `ORG_LEVEL1_LABEL=County`, `ORG_LEVEL2_LABEL=Sub-county` in UAT/prod `.env`; existing
   `monitor` users need a new role (plan → Hard to reverse). Then email plan (TODO.md).

## Gotchas

- Web `tsc` has 62 pre-existing errors (unused shadcn components missing deps, recharts types):
  run `npx tsc --noEmit -p tsconfig.app.json` and diff against a clean-tree baseline (`git stash`).
- pt/sw `common.json` contain duplicate keys: never JSON round-trip them; insert text.
- Repo files are CRLF: scripted replacements must normalise `\r\n` (or use Edit).
- Git Bash mangles `/wca`-style args (docker `-e`, curl `-w`): `export MSYS_NO_PATHCONV=1`.
- PowerShell → ssh: send multi-line scripts base64-encoded (`echo <b64> | base64 -d | bash`).
