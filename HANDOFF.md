# Handoff

<!-- Rules: ~/.claude/doc-system.md. Overwritten each session, never appended. ≤50 lines. -->
_Updated: 2026-11-10_

## Last session

Migrated the docs to doc-system v1 (`plans/archive/2026-11-10-docs-migration.md`). Investigated the
fork vs. upstream (`origin/main`, 99 commits ahead) and got sign-off on
`plans/2026-11-10-upstream-merge.md`. The user wants minimal involvement: run it end to end,
deploys included.

## In progress

Nothing. The merge plan is signed off but not started; no branch exists yet. Docs changes are
uncommitted on `main`.

## Next

1. Commit the docs changes on `main` as a docs-only commit (the user approved the migration; the
   no-docs-upstream rule is in DECISIONS → Repo / Workflow) and push to `fork`.
2. Execute `plans/2026-11-10-upstream-merge.md` from step 1, setting its status to `in-progress`
   as you start. Start Docker Desktop locally first (it wasn't running on 2026-11-10).
3. When it's deployed and verified, record the merged nginx design in DECISIONS → Architecture,
   archive the plan, and ask the user about the TODO items that need a go-ahead.
