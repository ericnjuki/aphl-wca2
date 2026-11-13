# Reviews

The Reviews queue is where reviewers approve or reject completed assessments before they count in reports. Who sees what:

- **Admins** see every submission.
- **District coordinators** (e.g. *Sub-county coordinators*) see submissions from facilities in their district.
- **Facility admins** see submissions from staff and other facility admins in their own facility.

Nobody can approve or reject their own submission: it appears in the queue, but only another reviewer can decide it. Other roles don't see this page.

## The queue

One row per `completed` + `pending` assessment, showing:

- **Person** — who submitted
- **Facility · Dept** — where they work (as of submission time)
- **Domain** — assessment name + code
- **Avg** — their 1–4 average across all answered subcompetencies
- **Completed** — submission timestamp

Use the search box in the nav bar to narrow by person, domain, or location.

## Deciding

Click a row (or its **Review** button) to open the submission: its answers per competency and subcompetency, with **Approve** and **Reject** at the bottom. The **Approve** and **Reject** buttons on the row decide without opening it. Either way:

- **Approve** — notes are optional. Response rows immediately flip to `approved` and appear in any approval-filtered report.
- **Reject** — notes are **required**. The response rows stay in the database but get excluded from approved-only aggregations.

Both actions invalidate the relevant query caches, so **Reports**, **My assessments** (the submitter's view), and the Reviews queue itself refresh immediately — no manual reload needed.

## Catching a stale submission

If you toggle **Approved only** OFF on the Reports page (admins, facility admins and staff), you'll see pending and rejected submissions counted alongside approved ones. Useful for pre-review previews or if you want to audit a rejected submission's impact.

## Rejecting sensibly

Rejection notes are preserved in the database. Good practices:

- State **what** was wrong ("marked Expert on every subcompetency", "inconsistent ratings")
- State **what's required next** ("please re-do after your Q2 training")

The person will see the `Rejected` badge on their **My assessments** card (notes are not currently surfaced to them — they'll need to ask).
