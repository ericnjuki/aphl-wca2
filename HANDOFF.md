# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-10_

## Last session

Executed the upstream merge end to end (`plans/archive/2026-11-10-upstream-merge.md`): Fred's
99 commits merged, our hosting switches ported onto his nginx layout, tests green (API 215,
web 57), nginx mode matrix + local Playwright pass at /wca all passed. **UAT and prod are live
on the merged code**; migrations 10–11 applied on both. DB backups taken first:
UAT `~/backups/wca-api_data-uat-20261110-131740.tgz`, prod
`~/backups/wca-api_data-prod-20261110-132047.tgz` (copy in local `~/Downloads`).

## In progress

Nothing.

## Next

0. Assessment DONE: `docs/2026-11-10-old-vs-new-db-assessment.md`. Pilot data dumped to UAT
   `~/backups/aphl-wca-postgres-backup-2026-11-10.sql.gz` (sha256 df28dce1…, row counts verified);
   old app fully removed from prod (containers, volume, image, networks, `~/projects/aphl-wca`) on the user's
   instruction. Dump copies (sha256 df28dce1…, chmod 600): UAT, server 46 `~/backups/`, local `~/Downloads`.
   Blank-page incident deferred (TODO).
1. **(Original brief, kept for reference) Read-only assessment, no changes.**
   - Old app on prod: `aphl-wca-aphl-api-1` (:6868) + `aphl-wca-postgresdb-1` (:5434,
     postgres:14.5). Is its data on a named volume or anonymous? Every table, column and row
     count; what assessment/user data exists; how auth works (users, password hashing,
     sessions/tokens). Find its source repo/image.
   - New app (aphl-wca2): its DB (sql.js/SQLite in the `aphl-wca2_api_data` volume), schema,
     migrations, auth.
   - Compare the two. The user believed upstream was only "enhancements and fixes" and asks
     whether Postgres was replaced wholesale. Known: our fork point `688d736` already used
     sql.js, so any switch predates today's merge. Find when it happened and who made it
     (git history of `apps/api/src/db/`, and the old repo).
   - Deliver a written report. Read-only on prod (`pg_dump`/queries are fine; take the dump
     to `~/Downloads/aphl-wca-postgres-backup-<date>.sql.gz` first).
2. Old-container removal: user said yes, but **only after** the assessment and the dump.
3. Both servers have the branch `merge/upstream-2026-11` checked out (same commit as `main`).
   On the next deploy, `git checkout main && git pull` there first.
4. Login/cookie wasn't exercised on UAT/prod (admins no longer use the seeded password); it
   passed locally. If login breaks, see DECISIONS → Gotchas (X-Forwarded-Proto).
5. The user is reviewing the merge (`b761282`) and the files listed in DECISIONS → Architecture.

## Gotchas found this session

- Git Bash mangles `/wca`-style args (docker `-e`, curl `-w`): `export MSYS_NO_PATHCONV=1`.
- PowerShell → ssh: send multi-line scripts base64-encoded (`echo <b64> | base64 -d | bash`);
  piping stdin adds a BOM + CRLF, and inner double quotes get stripped.
