# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-11_

## Last session

2026-11-12: scoped the role model rework with the user (Admin / National / County coordinator /
Sub-county coordinator / Facility admin / Staff, scoped reviews with an answers view, configurable
county/sub-county labels). Drafted `plans/2026-11-12-role-model.md`. Earlier (2026-11-11): prod test
data wiped, backup `~/backups/wca-api_data-prod-20261111-083646-prewipe.tgz` (prod + local `~/Downloads`).

## In progress

`plans/2026-11-12-role-model.md`: **draft**, awaiting the user's sign-off. No code written.

## Next

1. Get sign-off on the role-model plan, then implement it (fork-only; see plan).
0. Assessment DONE: `docs/2026-11-10-old-vs-new-db-assessment.md`. Pilot data dumped to UAT
   `~/backups/aphl-wca-postgres-backup-2026-11-10.sql.gz` (sha256 df28dce1…, row counts verified);
   old app fully removed from prod (containers, volume, image, networks, `~/projects/aphl-wca`) on the user's
   instruction. Dump copies (sha256 df28dce1…, chmod 600): UAT, server 46 `~/backups/`, local `~/Downloads`.
   Blank-page incident deferred (TODO).
3. Both servers have the branch `merge/upstream-2026-11` checked out (same commit as `main`).
   On the next deploy, `git checkout main && git pull` there first.
4. Login/cookie wasn't exercised on UAT/prod (admins no longer use the seeded password); it
   passed locally. If login breaks, see DECISIONS → Gotchas (X-Forwarded-Proto).
5. The user is reviewing the merge (`b761282`) and the files listed in DECISIONS → Architecture.

## Gotchas found this session

- Git Bash mangles `/wca`-style args (docker `-e`, curl `-w`): `export MSYS_NO_PATHCONV=1`.
- PowerShell → ssh: send multi-line scripts base64-encoded (`echo <b64> | base64 -d | bash`);
  piping stdin adds a BOM + CRLF, and inner double quotes get stripped.
