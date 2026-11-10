# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-10_

## Last session

Executing `plans/2026-11-10-upstream-merge.md` (status in-progress). Done: docs commit on `main`
(`7995304`, pushed); branch `merge/upstream-2026-11` with the merge commit `b761282` (Fred's
layout as base, our switches opt-in; on overlap his approach wins, per the user); typecheck,
build, API 215/215, web 57/57 tests pass; nginx render matrix passed for all four modes (root
default, root external, /wca external + redirect, /wca default), cookie relay verified.
Branch pushed to `fork`. Both servers were at `fdd29e2`; their `.env` needs no change.

## In progress

Plan steps 4–6: local Playwright pass at /wca (subagent), UAT deploy, prod deploy. See the
section below for where it stopped.

## Gotchas found this session

- Git Bash mangles `/wca` args to docker (`C:/Program Files/Git/wca`): `export MSYS_NO_PATHCONV=1`.
- PowerShell → ssh: pass multi-line scripts base64-encoded (`echo <b64> | base64 -d | bash`);
  piping stdin adds a BOM + CRLF, and inner double quotes get stripped.

## Next

1. Finish whatever of steps 5–7 is not marked done below; then merge the branch into `main`,
   push to `fork`, archive the plan, record the merged nginx design in DECISIONS → Architecture.
2. Ask the user about the TODO items that need a go-ahead.

## Stopping point

- (filled in as steps complete)
