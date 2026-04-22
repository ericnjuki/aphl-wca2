# Getting Started

Welcome to **LabWorkforce** — a tool for running competency assessments across your lab workforce, reviewing completed submissions, and producing reports that roll up from individuals to regions.

## What it does

At a high level, LabWorkforce lets you:

1. **Define assessment domains** — groups of competencies with proficiency descriptors (Beginner → Expert), imported from CSV or created by hand.
2. **Collect self-assessments** — staff answer each competency on a 4-level scale (plus N/A) using the Survey page.
3. **Review submissions** — an admin approves or rejects each completed assessment; only approved submissions count toward reports by default.
4. **Analyse results** — drill down from National → Region → Facility → Department → Individual, with charts, stacked breakdowns, and PDF/Excel/CSV export.

## First-time setup (admins)

If the database is brand new, follow these steps in order:

1. **Setup** — add reference data:
   - Regions (geographic groupings)
   - Facilities (belong to a region)
   - Departments (linked to facilities)
   - Org roles and user titles
2. **Users** — create staff accounts and, **importantly**, assign each user a **Facility** and **Department**. Responses snapshot the user's facility/department at completion time — unassigned users' responses won't roll up into regional reports.
3. **Assessments** — define at least one assessment domain and import its competency items (CSV).
4. **Invite staff** — share their username + temporary password. They'll be prompted to set their own password on first login.

## Daily use (staff)

- Open the **Survey** page, pick a domain, answer each competency.
- If you get interrupted, close the tab. The in-progress session auto-saves and shows up on **My assessments** with a **Resume** button.
- Once you submit, the assessment waits for admin review.

## Daily use (admins)

- **Reviews** shows completed submissions awaiting your decision. Approve to include in reports, reject with notes to exclude.
- **Reports** shows aggregated maturity levels by region/facility/department/individual. Click any bar or row to drill down.

## Roles

| Role  | Can see                                                  |
|-------|----------------------------------------------------------|
| admin | Everything — all reports, reviews, user/setup management |
| staff | Own assessments, facility-scoped reports (no national)   |

## Tips

- Pagination lives at the bottom of every large table. Use **Rows per page** if you want denser or lighter views.
- Use the search box on Users and Reviews to narrow long lists.
- Toggle **Approved only** on the Reports filter bar to see pending/rejected submissions too — useful when reviewing before approval.
- Most pages work on both dark and light theme; use the sun/moon icon in the top-right.
