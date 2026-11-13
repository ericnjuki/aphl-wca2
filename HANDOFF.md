# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-13_

## Last session

2026-11-13: role-model web, all code items done: Users page (`5dd2aef`: role picker per caller, county /
sub-county selects, region → district cascade filtering facilities, facility-admin view), review detail sheet
with shared `SubcompetencyDetailTable` and no self-review buttons (`944d119`), Setup wording via
`useOrgLabels` (`8aa1ac2`). Web tests 69/69, `tsc` at baseline (62), `vite build` OK.

## In progress

`plans/2026-11-12-role-model.md` → only Web item 6 (in-app docs) remains. Stopped at the context limit
before editing any doc.

## Next

0. **Reviews list (user, 2026-11-13):** add the quick Approve/Reject row buttons back next to the new
   Review button (`ReviewsPage.tsx`, they open the same notes dialog via `setDecision`). Hide them on
   the caller's own rows (`r.user_id === myId`); `stopPropagation` so they don't open the sheet.
1. **Docs** (`apps/web/src/docs/1.0.0/`): rewrite `users.md` "Partner (monitor) users" (l.19-55) for the six
   roles (placement per role, facility-admin limits, summary-only rules, self-review block); `reports.md`
   l.22-36 (landing per role, approved-only for summary roles); `setup.md` l.32, 52, 60 (`system_role`
   values, `region_codes`/`district_codes` rules: check `apps/api/src/routes/admin-setup.ts`). Locale
   JSON has no monitor/Partner hits left.
2. tsc (diff vs baseline) + build + tests; report done, ask before a live Playwright pass (one login per role).
3. At deploy: `ORG_LEVEL1_LABEL=County`, `ORG_LEVEL2_LABEL=Sub-county` in UAT/prod `.env`; existing
   `monitor` users need a new role (plan → Hard to reverse). Then email plan (TODO.md).

## Gotchas

- Web `tsc` has 62 pre-existing errors (unused shadcn components missing deps, recharts types):
  run `npx tsc --noEmit -p tsconfig.app.json` and diff against a clean-tree baseline (`git stash`).
- pt/sw `common.json` contain duplicate keys: never JSON round-trip them; insert text.
- Repo files are CRLF: scripted replacements must normalise `\r\n` (or use Edit).
- Git Bash mangles `/wca`-style args (docker `-e`, curl `-w`): `export MSYS_NO_PATHCONV=1`.
- PowerShell → ssh: send multi-line scripts base64-encoded (`echo <b64> | base64 -d | bash`).
