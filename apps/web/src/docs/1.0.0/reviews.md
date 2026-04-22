# Reviews (admin)

The Reviews queue is where an admin approves or rejects completed assessments before they count in reports. **Admin-only** — staff users don't see this page.

## The queue

One row per `completed` + `pending` assessment, showing:

- **Person** — who submitted
- **Facility · Dept** — where they work (as of submission time)
- **Domain** — assessment name + code
- **Avg** — their 1–4 average across all answered subcompetencies
- **Completed** — submission timestamp

Use the search box in the nav bar to narrow by person, domain, or location.

## Deciding

Two buttons per row:

- **Approve** — notes are optional. Response rows immediately flip to `approved` and appear in any approval-filtered report.
- **Reject** — notes are **required**. The response rows stay in the database but get excluded from approved-only aggregations.

Both actions invalidate the relevant query caches, so **Reports**, **My assessments** (the submitter's view), and the Reviews queue itself refresh immediately — no manual reload needed.

## Catching a stale submission

If you toggle **Approved only** OFF on the Reports page, you'll see pending and rejected submissions counted alongside approved ones. Useful for pre-review previews or if you want to audit a rejected submission's impact.

## Rejecting sensibly

Rejection notes are preserved in the database. Good practices:

- State **what** was wrong ("marked Expert on every subcompetency", "inconsistent ratings")
- State **what's required next** ("please re-do after your Q2 training")

The person will see the `Rejected` badge on their **My assessments** card (notes are not currently surfaced to them — they'll need to ask).
