@~/.claude/doc-system.md
<!-- doc-system: v1 -->

# Workforce Competency — Engineering Standards

A web app for tracking workforce/employee competencies: a pnpm/turbo monorepo (`apps/web` React +
Vite, `apps/api` Express + sql.js), deployed with Docker Compose and nginx.

**Project history:** Existing project; Claude did not work on it from the start. Treat the
codebase, git history and existing docs as ground truth when anything is unclear or conflicts.
This repo is our fork of APHL's upstream (see DECISIONS → Repo / Workflow).

**Docs:** follows the global doc system (`~/.claude/doc-system.md`, imported above). Our docs stay
on `fork` and never go into upstream PRs.

- **Workflow: human-in-the-loop, no subagent pipeline.** For any non-trivial change: propose the
  approach and get explicit user approval before drafting a full plan. Draft the plan as a file in
  `plans/` (dated, `**Status:** draft`), then get explicit sign-off before writing any code. After
  implementation, check types/build, report done, and get explicit approval before starting a live
  test pass; don't launch one unprompted (unless the signed-off plan includes it).
- **Testing: once the user asks for a live test pass, actually run one.** Start the dev server and
  drive a real browser click-through (Playwright if available), covering the golden path, edge
  cases and regressions. Type checks verify code, not features.
- **Hard-to-reverse or hard-to-correct user-facing actions** (locking a value on first save, a
  permanent state transition, an undo-less delete, forward-only DB migrations on prod) must be
  called out in the plan, with how a user recovers, before sign-off.
- **No standalone design-system doc: follow existing conventions, mostly shadcn.** For UI work,
  match the patterns already in `apps/web`. If a genuinely new pattern is needed, flag it and
  confirm with the user.
- **Claude runs every command itself:** pnpm, docker, builds, tests, and deployments to UAT/prod.
  The user does not run commands; never hand one over. Plan sign-off and the rules above still
  apply.
