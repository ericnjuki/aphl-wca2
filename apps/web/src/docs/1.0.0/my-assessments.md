# My Assessments

Your personal history page. Lists every assessment you've ever started, whether in-progress, completed, or abandoned.

## What each card shows

| Badge             | Meaning                                                        |
|-------------------|----------------------------------------------------------------|
| `in_progress`     | You started this survey but haven't submitted it yet           |
| `completed`       | Submitted — awaiting admin review                              |
| `Pending review`  | Completed, admin hasn't decided yet                            |
| `Approved`        | Admin approved — counted in reports                            |
| `Rejected`        | Admin rejected with notes — not counted in reports             |
| `abandoned`       | You chose **Start over** on a previous draft                   |

The right side shows the **AVG** score (1.0–4.0) for completed assessments.

## Actions

- **Resume** (in-progress only) — takes you back to the Survey page, pre-selects the domain, and drops you right where you left off.
- **View detail** (completed only) — opens your individual report with strengths, gaps, a radar chart across competencies, and a full subcompetency-by-subcompetency table.

## Troubleshooting

**"Resume" still shows the domain picker** — if you're stuck at the domain selector after clicking Resume, refresh the page. The URL carries `?domain=<CODE>&resume=1` so a refresh re-triggers auto-resume.

**Multiple `completed` rows for the same domain** — that's by design. Each submission is a historical snapshot. Reports use the most recent approved one.
