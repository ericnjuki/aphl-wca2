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

1. Both servers have the branch `merge/upstream-2026-11` checked out (same commit as `main`
   then). On the next deploy, `git checkout main && git pull` there first.
2. Login/cookie wasn't exercised on UAT/prod (admins no longer use the seeded password); it
   passed locally. If the user reports login trouble, see DECISIONS → Gotchas (X-Forwarded-Proto).
3. Ask the user about the TODO items needing a go-ahead (old aphl-wca containers; upstream PR).

## Gotchas found this session

- Git Bash mangles `/wca`-style args (docker `-e`, curl `-w`): `export MSYS_NO_PATHCONV=1`.
- PowerShell → ssh: send multi-line scripts base64-encoded (`echo <b64> | base64 -d | bash`);
  piping stdin adds a BOM + CRLF, and inner double quotes get stripped.
