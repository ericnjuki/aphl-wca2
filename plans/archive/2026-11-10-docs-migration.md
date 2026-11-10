# Migrate project docs to doc-system v1

**Status:** done (archived 2026-11-10)

Applies `~/.claude/doc-system.md` via the `project-docs` skill (migrate mode). Docs only, no source
changes.

## Measured (2026-11-10)
- CLAUDE.md 14L (≤150), DECISIONS.md 141L (≤300), HANDOFF.md 73L (**over** ≤50). No TODO.md.
- Plans: `plans/2026-09-16-wca-subpath-deploy.md` (steps 1–3 live in prod, step 4 open, so its
  "Not yet implemented" status line is stale). `docs/superpowers/plans|specs/2026-06-10-survey-ux-tweaks*`
  were merged in `33b7b7a`, so they're done.
- Pending work found: HANDOFF "Open Threads" (postgres backup + retire old containers).
- Plan-path references: DECISIONS.md:103 (subpath plan; path unchanged), survey plan → spec link.

## Rename map (`git mv`)
| Old | New |
|---|---|
| `docs/superpowers/plans/2026-06-10-survey-ux-tweaks.md` | `plans/archive/2026-06-10-survey-ux-tweaks.md` |
| `docs/superpowers/specs/2026-06-10-survey-ux-tweaks-design.md` | `plans/archive/2026-06-10-survey-ux-tweaks-design.md` |
| `plans/2026-09-16-wca-subpath-deploy.md` | unchanged; status → `in-progress` (step 4 left) |

Both archived files get `**Status:** done (archived 2026-11-10)`; the plan's spec link is rewritten.
`docs/superpowers/` is then empty and removed. `docs/DEPLOYMENT.md` stays (reference doc).

## DECISIONS ledger (dates from `git blame`)
| Entry | Action |
|---|---|
| BASE_PATH is build-time | keep (2026-09-16), Architecture |
| sql.js single-writer | keep (2026-09-16), Architecture |
| Important Files (nginx templates, deploy.mjs) | keep (2026-09-16), folded into Architecture |
| `origin` read-only, `main` tracks `fork` | keep (2026-09-18), Infrastructure |
| Prod host `analytics-svr` | keep (2026-09-16, rev. 2026-11-10): host/IP/`-A` stay; the generic "SSH via Windows OpenSSH, not Git Bash" explanation is dropped (now in `~/.claude/CLAUDE.md`) |
| Claude tool choice (Bash vs PowerShell SSH) | **drop**: duplicates the global SSH rule |
| Auto Mode blocks prod reads/writes | keep, condensed (2026-09-16, rev. 2026-11-10), Gotchas: narrow secret reads; global ssh allow rule |
| UAT host | keep (2026-09-16), Infrastructure |
| Deployed at `~/projects/aphl-wca2` (wca-nginx/wca-api) | keep, merged into the prod-host entry |
| `wca.nphl.go.ke` via Proxmox, stale `/api`→6868 | keep (2026-09-16) |
| `apps.nphl.go.ke` vhost on analytics-svr | keep (2026-09-16) |
| Old `aphl-wca` leftover containers | fact kept short; the backup/remove action → **TODO** |
| X-Forwarded-Proto third hop | keep (2026-09-16), Gotchas, narration trimmed |
| CORS_ORIGINS exact origin | keep (2026-09-16), Gotchas, narration trimmed |

Header maintenance rules are replaced by the one-line policy pointer. Expected size: ~90 lines.

## TODO.md
- Now: (2026-09-16) back up `aphl-wca-postgresdb-1` to `~/Downloads/…`, then remove it and
  `aphl-wca-aphl-api-1`. Links the subpath plan, step 4.
- Later: empty.

## HANDOFF.md
Template, three sections: Last session = this migration; In progress = nothing; Next = TODO Now item.
The "First task: migrate" section is deleted. Current State facts already live in DECISIONS
(deploy commits/env are in git and DECISIONS), so the section goes.

## CLAUDE.md
- Add `@~/.claude/doc-system.md` + `<!-- doc-system: v1 -->` and the **Docs:** line.
- Keep: project description, project history, workflow (reworded per template: dated plan with
  `**Status:** draft`; the "commit the plan before code" clause goes, since tracked plans are
  committed with their work), testing, hard-to-reverse actions, shadcn rule, pnpm-run-by-user.
- Drop: git-status-at-start and commit-only-on-ask (global); the DECISIONS/HANDOFF-header pointer
  (replaced by the policy).

## Verify
`bash ~/.claude/scripts/check-docs.sh` prints nothing. Left uncommitted.

## Outcome (2026-11-10)
Executed with two deviations: `docs/superpowers/` was **left in place** as upstream's area (see
DECISIONS → Repo / Workflow), and the merge with upstream was split out into
`plans/2026-11-10-upstream-merge.md`. CLAUDE.md now says Claude runs all commands (user
instruction, 2026-11-10).
